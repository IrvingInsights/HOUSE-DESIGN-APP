import React, { useEffect, useMemo, useState } from 'react';
import { ThreeScene, webglAvailable } from '../threeScene.jsx';
import { PlanView } from '../planView.jsx';
import {
  applyBimOperations, clamp, basementInfo, BASEMENT_LEVEL, FRAME_TYPES, resolveFrameType
} from '../../backend/bim-core.mjs';
import {
  seedSpec, getWallSections, deriveDesign, detectIssues, fmtMoney, fmtNum, COST_ROWS,
  buildTimeline, phaseDependencies, orderPhasesByDeps, validatePhaseOrder, DEFAULT_MODEL_LAYERS,
  floorCount, floorLabel, storeyInfo, upperPlateRect, utilitiesOf,
  WALL_SIDES, WALL_ASSEMBLIES, resolveWallSide, FOUNDATION_RUN_TYPES, FOUNDATION_RUN_PRESETS,
  ROOM_PRESETS, planNewRoomPlacements, roomPresetFromName
} from '../engine.js';
import '../styles.css';
import './shell.css';

// The Trail — the spine of the app. Shape comes FIRST (settle the footprint),
// then Rooms fill it, then everything the shell implies. One chapter open at a
// time; each opens with a plain-sentence greeting (the "foreman" voice).
// planContext puts the plan view in that chapter's editing mode (footprint
// edges for Shape, room dragging for Rooms, door/window gaps for Openings) —
// so each chapter looks and acts like what it's for.
const CHAPTERS = [
  { id: 'shape', label: 'Shape', view: 'plan', planContext: 'shell', greet: (d) => `Start with the outline — a plain rectangle or an L, T, or U. Set the size below, or drag any wall edge right on the plan. Right now it's ${fmtNum(d.floor)} sq ft.` },
  { id: 'rooms', label: 'Rooms', view: 'plan', planContext: 'rooms', greet: () => 'Lay the rooms out flat, from above. Drag a room to move it, grab a corner to resize — and use the floor pills (top left) to work each level, add one, or take one away.' },
  { id: 'foundation', label: 'Foundation', view: 'plan', planContext: 'foundation', greet: () => 'What the house sits on. Pick the main type below — and the foundation doesn’t have to match the rooms: drop extra footings and drag them under whatever they carry, even outside the walls.' },
  { id: 'shell', label: 'Shell', view: '3d', greet: (d) => `The shell stands ${fmtNum(d.storeys)} storey${d.storeys === 1 ? '' : 's'}. Pick the wall system and the frame that carries the roof — the timeline and every receipt follow along.` },
  { id: 'roof', label: 'Roof', view: '3d', greet: () => 'Choose how the roof sheds weather and sun — and how much daylight it lets in.' },
  { id: 'openings', label: 'Openings', view: 'plan', planContext: 'windows', greet: () => 'Place doors and windows where light and paths want them. Slide them along their wall.' },
  { id: 'systems', label: 'Systems', view: '3d', greet: () => 'Heat, water, power, waste — the working parts. Each shows its own receipts.' },
  { id: 'finishes', label: 'Finishes', view: '3d', greet: () => 'Materials and surfaces, inside and out — natural or conventional, wall by wall.' }
];

// Bumped on every shell change so Daniel can see at a glance which version
// his browser is showing (bottom of the Trail).
const UPDATE_STAMP = 'update 15 · Jul 14';

// ---- The Time Machine ------------------------------------------------------
// Short names for the timeline chips (full titles live on the phase card).
const PHASE_SHORT = {
  'site-prep': 'Site', foundation: 'Foundation', framing: 'Frame', walls: 'Walls',
  roofing: 'Roof', utilities: 'Pipes & wires', heater: 'Heater', plaster: 'Plaster',
  occupancy: 'Sign-off'
};

// What each phase makes VISIBLE in the 3D model as the scrubber passes it.
// `layers` keys merge into the scene's layer set; `cats` are element
// categories that appear. Anything not named here waits for Sign-off, which
// reveals everything (`all`).
const PHASE_REVEALS = {
  'site-prep': { layers: { pad: true }, cats: ['earthwork', 'site'] },
  foundation: { layers: { foundation: true }, cats: ['foundation'] },
  framing: { layers: { frame: true, upperFloors: true }, cats: ['floor', 'structure', 'loft', 'tower'] },
  walls: { layers: { wallNorth: true, wallSouth: true, wallEast: true, wallWest: true, openings: true }, cats: ['wall', 'partition'] },
  roofing: { layers: { roof: true }, cats: ['roof', 'chimney'] },
  utilities: { cats: ['water', 'power', 'waste'] },
  heater: { cats: ['thermal'] },
  plaster: { layers: { rooms: true, labels: true }, cats: ['storage'] },
  occupancy: { all: true }
};

// The bare-ground starting point: sky, grass, nothing built yet.
const BARE_GROUND_LAYERS = {
  ...DEFAULT_MODEL_LAYERS,
  frame: false, foundation: false,
  wallNorth: false, wallSouth: false, wallEast: false, wallWest: false,
  roof: false, upperFloors: false, rooms: false, openings: false,
  pad: false, labels: false
};

// The layer set for a scrub position: everything from every phase that has
// STARTED, cumulatively, in the current order. Element categories not yet
// revealed go into hiddenCats.
function scrubLayers(schedule, scrubWeek, spec) {
  const layers = { ...BARE_GROUND_LAYERS };
  const shownCats = new Set();
  let showAll = false;
  schedule.forEach((row) => {
    if (scrubWeek <= row.startWeek + 1e-6) return; // not started yet
    const reveal = PHASE_REVEALS[row.id];
    if (!reveal) return;
    if (reveal.all) showAll = true;
    Object.assign(layers, reveal.layers || {});
    (reveal.cats || []).forEach((cat) => shownCats.add(cat));
  });
  if (showAll) return { ...DEFAULT_MODEL_LAYERS };
  const allCats = new Set((spec.elements || []).map((el) => el.category || 'custom'));
  layers.hiddenCats = [...allCats].filter((cat) => !shownCats.has(cat));
  return layers;
}

// The design survives reloads and self-updates: every change lands in the
// browser's local storage (this machine only), and the app picks it back up
// on the next open. Losing an hour of design to a refresh is not a thing.
const STORE_KEY = 'rz.design.v1';
function loadStoredSpec() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.spec?.shell && Array.isArray(parsed.spec.rooms)) return parsed.spec;
  } catch { /* corrupt or blocked storage — start from the sample */ }
  return null;
}

// Keep a custom order valid as the phase list itself changes (the heater
// phase comes and goes with the heat source): drop ids that no longer exist,
// slot new phases in at their default position.
function reconcileOrder(stored, defaultIds) {
  if (!stored) return defaultIds;
  const kept = stored.filter((id) => defaultIds.includes(id));
  defaultIds.forEach((id, i) => {
    if (!kept.includes(id)) kept.splice(Math.min(i, kept.length), 0, id);
  });
  return kept;
}

const TYPE_LABEL = {
  living: 'Living', service: 'Service', sleeping: 'Sleeping', wet: 'Wet core',
  work: 'Work', plant: 'Growing', outdoor: 'Outdoor', site: 'Site'
};

export default function App() {
  const [spec, setSpec] = useState(() => loadStoredSpec() || structuredClone(seedSpec));
  const [selectedId, setSelectedId] = useState(null);
  const [activeChapter, setActiveChapter] = useState('shape');
  const [viewMode, setViewMode] = useState('plan'); // 'plan' (top-down) | '3d'
  const [trailOpen, setTrailOpen] = useState(true);
  const [viewRequest, setViewRequest] = useState({ mode: 'iso', n: 1 });
  const [askText, setAskText] = useState('');
  const [askEcho, setAskEcho] = useState(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [activeFloor, setActiveFloor] = useState(1); // 1=ground, 2/3=upper, BASEMENT_LEVEL=basement
  // The Time Machine: open/closed, playhead in weeks, playing, Daniel's custom
  // phase order (null = the builder's order), the tapped phase, and the last
  // accept/refuse message.
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [scrub, setScrub] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phaseOrder, setPhaseOrder] = useState(null);
  const [focusPhaseId, setFocusPhaseId] = useState(null);
  const [timelineMsg, setTimelineMsg] = useState(null);

  const webglOK = useMemo(() => webglAvailable(), []);
  const wallSections = useMemo(() => getWallSections(spec), [spec]);
  const derived = useMemo(() => deriveDesign(spec, wallSections), [spec, wallSections]);
  const flags = useMemo(() => detectIssues(spec).filter((i) => i.severity !== 'pass'), [spec]);

  // Timeline data: phases adapt to the design, hard dependencies come from
  // the construction, the default order honors them, and the schedule
  // receipt-checks whatever order is current.
  const phases = useMemo(() => buildTimeline(spec, derived), [spec, derived]);
  const deps = useMemo(() => phaseDependencies(spec, phases), [spec, phases]);
  const defaultOrderIds = useMemo(() => orderPhasesByDeps(phases, deps).map((p) => p.id), [phases, deps]);
  const orderIds = useMemo(() => reconcileOrder(phaseOrder, defaultOrderIds), [phaseOrder, defaultOrderIds]);
  const schedule = useMemo(() => validatePhaseOrder(phases, orderIds, deps).schedule, [phases, orderIds, deps]);
  const totalWeeks = schedule.length ? schedule[schedule.length - 1].endWeek : 0;

  // The 3D reveal only changes when the scrubber crosses a phase boundary —
  // the scene rebuilds per PHASE, not per tick.
  const revealSig = schedule.filter((row) => scrub > row.startWeek + 1e-6).map((row) => row.id).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const timelineLayers = useMemo(() => scrubLayers(schedule, scrub, spec), [revealSig, spec]);

  // Playback: the whole build plays in about 12 seconds regardless of length.
  useEffect(() => {
    if (!timelineOpen || !playing || totalWeeks <= 0) return undefined;
    const step = totalWeeks / 120;
    const timer = setInterval(() => {
      setScrub((s) => {
        const next = s + step;
        if (next >= totalWeeks) { setPlaying(false); return totalWeeks; }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [timelineOpen, playing, totalWeeks]);

  const openTimeline = () => {
    setTimelineOpen(true); setViewMode('3d'); setScrub(0); setPlaying(true);
    setSelectedId(null); setBudgetOpen(false); setFocusPhaseId(null); setTimelineMsg(null);
  };
  const closeTimeline = () => { setTimelineOpen(false); setPlaying(false); setFocusPhaseId(null); };

  // A drag proposes a new order; the dependency checker judges it in plain
  // English. Refused moves never land — the reason shows instead.
  const proposeOrder = (movedId, toIndex) => {
    const without = orderIds.filter((id) => id !== movedId);
    without.splice(clamp(toIndex, 0, without.length), 0, movedId);
    const verdict = validatePhaseOrder(phases, without, deps);
    const movedTitle = phases.find((p) => p.id === movedId)?.title || 'That phase';
    if (!verdict.ok) {
      setTimelineMsg({ tone: 'no', text: verdict.problems[0].text });
      return;
    }
    setPhaseOrder(without);
    const movedRow = verdict.schedule.find((row) => row.id === movedId);
    const proof = movedRow?.checks?.length ? ` ${movedRow.checks[0].text}` : '';
    setTimelineMsg({ tone: 'ok', text: `Re-planned: ${movedTitle} now runs weeks ${movedRow.startWeek}–${movedRow.endWeek}.${proof}` });
  };

  const selectedRoom = spec.rooms.find((r) => r.id === selectedId) || null;
  const chapter = CHAPTERS.find((c) => c.id === activeChapter) || CHAPTERS[0];

  // --- direct editing: apply ops CLIENT-SIDE, no server round-trip ----------
  const findObj = (id) => spec.rooms.find((r) => r.id === id) || (spec.elements || []).find((e) => e.id === id);
  const applyOps = (operations) => {
    const report = applyBimOperations(spec, { operations });
    if (report?.spec) setSpec(report.spec);
  };
  const moveObject = (id, x, y) => { const o = findObj(id); if (o) applyOps([{ type: 'move_object', targetId: id, name: o.name, x, y }]); };
  const resizeObject = (id, x, y, w, d) => {
    const o = findObj(id); if (!o) return;
    applyOps([
      { type: 'resize_object', targetId: id, name: o.name, w, d, h: Number(o.h) || 0.22 },
      { type: 'move_object', targetId: id, name: o.name, x, y }
    ]);
  };
  const resizeShell = (w, d) => applyOps([
    { type: 'set_shell', field: 'widthFt', value: String(clamp(Number(w), 12, 96)) },
    { type: 'set_shell', field: 'depthFt', value: String(clamp(Number(d), 12, 80)) }
  ]);
  const moveEdge = (edgeIndex, offsetFt) => applyOps([{ type: 'move_wall_edge', field: `e${edgeIndex}`, value: String(offsetFt) }]);
  // Shape presets: rectilinear outlines built from the current size. 'rect'
  // clears back to a plain rectangle; corners land on half-foot marks.
  const setShape = (kind) => {
    if (kind === 'rect') { applyOps([{ type: 'set_footprint', value: 'rect' }]); return; }
    const W = Number(spec.shell.widthFt) || 36;
    const D = Number(spec.shell.depthFt) || 28;
    const s = (v) => Math.round(v * 2) / 2;
    const SHAPES = {
      l: [[0, 0], [W, 0], [W, s(D * 0.55)], [s(W * 0.6), s(D * 0.55)], [s(W * 0.6), D], [0, D]],
      t: [[0, 0], [W, 0], [W, s(D * 0.5)], [s(W * 0.75), s(D * 0.5)], [s(W * 0.75), D], [s(W * 0.25), D], [s(W * 0.25), s(D * 0.5)], [0, s(D * 0.5)]],
      u: [[0, 0], [W, 0], [W, D], [s(W * 0.7), D], [s(W * 0.7), s(D * 0.45)], [s(W * 0.3), s(D * 0.45)], [s(W * 0.3), D], [0, D]]
    };
    if (SHAPES[kind]) applyOps([{ type: 'set_footprint', value: JSON.stringify(SHAPES[kind]) }]);
  };
  const moveOpening = (index, along) => {
    const op = spec.openings?.[index]; if (!op || op.wall === 'roof') return;
    const field = op.wall === 'north' || op.wall === 'south' ? 'x' : 'y';
    applyOps([{ type: 'update_object', targetId: `opening-${index}`, field, value: along }]);
  };

  // --- floors: add/remove a storey, walk levels in the plan -----------------
  const floors = floorCount(spec);
  const hasBasement = basementInfo(spec.shell).present;
  const addFloor = () => {
    const next = Math.min(3, floors + 1);
    const ops = [{ type: 'set_shell', field: 'storeys', value: String(next) }];
    // The new storey gets an extent plate — resize it on its floor to put the
    // storey over only part of the building.
    if (!upperPlateRect(spec, next)) {
      ops.push({
        type: 'add_element', name: `Storey ${next} extent`, category: 'floor',
        x: 0, y: 0, z: storeyInfo(spec.shell).baseWallFt * (next - 1),
        w: Number(spec.shell.widthFt), d: Number(spec.shell.depthFt), h: 0.4, level: next
      });
    }
    applyOps(ops);
    setActiveFloor(next);
  };
  const removeFloor = () => {
    if (floors <= 1) return;
    // One dispatch: storeys down, that level's extent plates gone, its rooms
    // brought to the ground floor — removing a floor never deletes rooms.
    const ops = [{ type: 'set_shell', field: 'storeys', value: String(floors - 1) }];
    (spec.elements || []).filter((el) => el.category === 'floor' && Number(el.level || 1) === floors)
      .forEach((plate) => ops.push({ type: 'remove_object', targetId: plate.id, name: plate.name }));
    (spec.rooms || []).filter((room) => Number(room.level || 1) === floors)
      .forEach((room) => ops.push({ type: 'update_object', targetId: room.id, name: room.name, field: 'level', value: '1' }));
    applyOps(ops);
    setActiveFloor((f) => (f === BASEMENT_LEVEL ? f : Math.min(f, floors - 1)));
  };

  // --- foundation: the main type + free-roaming footing runs ----------------
  const chooseFoundation = (value) => {
    // 'basement' is a foundation choice that IS a storey — one source of truth
    // (shell.basementHeightFt drives both), same as the classic app.
    if (value === 'basement') {
      if (!hasBasement) applyOps([{ type: 'set_shell', field: 'basementHeightFt', value: '8' }]);
      return;
    }
    const ops = [{ type: 'set_utility', field: 'foundationType', value }];
    if (hasBasement) ops.unshift({ type: 'set_shell', field: 'basementHeightFt', value: '0' });
    applyOps(ops);
    if (hasBasement && activeFloor === BASEMENT_LEVEL) setActiveFloor(1);
  };
  const setUtilityField = (field, value) => applyOps([{ type: 'set_utility', field, value: String(value) }]);
  const setShellField = (field, value) => applyOps([{ type: 'set_shell', field, value: String(value) }]);
  const placeSlabPad = () => {
    // One shape, bigger than the house by default: 2 ft of apron all around.
    // Drag and stretch it from there — under a porch, a carport, anywhere.
    applyOps([{
      type: 'add_element', name: 'Slab shape', category: 'foundation', construction: 'slabpad',
      x: -2, y: -2, w: Number(spec.shell.widthFt) + 4, d: Number(spec.shell.depthFt) + 4, h: 0.35, level: 1
    }]);
  };
  const placeFoundationRun = (preset) => {
    // Land beside the house (never at 0,0 — that's "unset" to the op layer),
    // staggered so repeated drops don't pile up; then drag it into place.
    const existing = (spec.elements || []).filter((el) => el.category === 'foundation').length;
    applyOps([{
      type: 'add_element', name: preset.name, category: 'foundation', construction: preset.construction,
      x: 2 + (existing % 2) * (preset.w + 2), y: Number(spec.shell.depthFt) + 3 + Math.floor(existing / 2) * 3.5,
      w: preset.w, d: preset.d, h: preset.h, level: 1
    }]);
  };
  const removeElement = (el) => {
    applyOps([{ type: 'remove_object', targetId: el.id, name: el.name }]);
    if (selectedId === el.id) setSelectedId(null);
  };

  // --- rooms: add from a preset, rename, remove ------------------------------
  const [roomNote, setRoomNote] = useState(null);
  const addRoomPreset = (preset) => {
    const level = activeFloor === BASEMENT_LEVEL ? BASEMENT_LEVEL : activeFloor;
    const plan = planNewRoomPlacements(spec, [preset], level);
    if (!plan.ops.length) return;
    applyOps(plan.ops);
    setRoomNote(plan.grew
      ? `Added the ${plan.names[0]} and grew the house to ${plan.newW} × ${plan.newD} ft to fit it — your other rooms stayed put.`
      : `Added the ${plan.names[0]}${level !== 1 ? ` on the ${floorLabel(spec, level).toLowerCase()}` : ''}.`);
  };
  const removeObject = (obj) => {
    applyOps([{ type: 'remove_object', targetId: obj.id, name: obj.name }]);
    if (selectedId === obj.id) setSelectedId(null);
  };
  const duplicateRoom = (room) => {
    const level = Number(room.level || 1);
    const plan = planNewRoomPlacements(spec, [{ name: room.name, type: room.type, w: Number(room.w), d: Number(room.d) }], level);
    if (plan.ops.length) applyOps(plan.ops);
  };
  const moveRoomToFloor = (room, level) => {
    applyOps([{ type: 'update_object', targetId: room.id, name: room.name, field: 'level', value: String(level) }]);
    if (activeChapter === 'rooms') setActiveFloor(level);
  };

  // autosave the design to this browser (debounced — never per keystroke)
  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ spec, savedAt: Date.now() })); } catch { /* storage full/blocked — in-memory still works */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [spec]);
  const startFresh = () => {
    if (!window.confirm('Start over with the sample design? Your current design will be cleared.')) return;
    try { localStorage.removeItem(STORE_KEY); } catch { /* fine */ }
    setSpec(structuredClone(seedSpec));
    setSelectedId(null);
    setPhaseOrder(null);
  };

  // --- self-update: the app notices new versions and applies them itself -----
  const [update, setUpdate] = useState(null); // {behind, latest} | 'applying' | {error}
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch('/api/update/check', { cache: 'no-store' });
        const j = await r.json();
        if (alive && j.behind > 0) setUpdate((cur) => (cur === 'applying' ? cur : j));
      } catch { /* engine busy/offline — try again next round */ }
    };
    check();
    const timer = setInterval(check, 5 * 60 * 1000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);
  const applyUpdateNow = async () => {
    setUpdate('applying');
    try {
      const r = await fetch('/api/update/apply', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) { setUpdate({ error: j.error || 'update failed' }); return; }
      if (j.restarting) {
        // the engine restarts itself on new code — wait for it, then reload
        for (let i = 0; i < 40; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          try { const ping = await fetch('/api/update/check', { cache: 'no-store' }); if (ping.ok) break; } catch { /* still restarting */ }
        }
      }
      window.location.reload();
    } catch {
      // apply killed the engine before answering — same story: wait, reload
      for (let i = 0; i < 40; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try { const ping = await fetch('/api/update/check', { cache: 'no-store' }); if (ping.ok) break; } catch { /* still restarting */ }
      }
      window.location.reload();
    }
  };

  // --- right-click menu on the plan ------------------------------------------
  const [ctxMenu, setCtxMenu] = useState(null); // { id, x, y }
  const openContext = (id, x, y) => { setSelectedId(id); setCtxMenu({ id, x, y }); };
  useEffect(() => {
    if (!ctxMenu) return undefined;
    const close = () => setCtxMenu(null);
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onEsc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', onEsc); };
  }, [ctxMenu]);
  const renameObject = (obj, name) => {
    if (name.trim() && name.trim() !== obj.name) applyOps([{ type: 'update_object', targetId: obj.id, name: obj.name, field: 'name', value: name.trim() }]);
  };

  // Delete/Backspace removes the selected room or element in plan mode — but
  // NEVER while typing in a field or with text highlighted (the classic app
  // once ate highlighted text this way).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (timelineOpen || !selectedId) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (String(window.getSelection?.() || '').length > 0) return;
      const obj = spec.rooms.find((r) => r.id === selectedId) || (spec.elements || []).find((el) => el.id === selectedId);
      if (!obj) return;
      e.preventDefault();
      removeObject(obj);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // --- structure: whole-house wall system + frame ----------------------------
  // ONE dispatch for all four sides — four separate calls would race on the
  // same base spec and only the last would land (a bug this app has had).
  const setAllWalls = (value) => applyOps(WALL_SIDES.map((side) => ({ type: 'set_wall_side', wall: side, field: 'assembly', value })));
  const setFrame = (value) => applyOps([{ type: 'set_frame', value }]);

  // switching chapters nudges you to the view that chapter is best done in
  const goChapter = (c) => { setActiveChapter(c.id); if (c.view) setViewMode(c.view === 'plan' ? 'plan' : '3d'); };

  return (
    <div className="rz-root">
      {/* SURFACE 1 — the Model / Plan, center stage and full-bleed */}
      <div className="rz-model">
        {viewMode === 'plan' ? (
          <PlanView
            spec={spec}
            selectedRoom={selectedId}
            onSelect={setSelectedId}
            onMove={moveObject}
            onResize={resizeObject}
            onResizeShell={resizeShell}
            onMoveEdge={moveEdge}
            onMoveOpening={moveOpening}
            context={chapter.planContext || null}
            onContext={timelineOpen ? null : openContext}
            activeFloor={activeChapter === 'rooms' ? activeFloor : 1}
          />
        ) : (
          <ThreeScene
            spec={spec}
            selectedRoom={selectedId}
            layers={timelineOpen ? timelineLayers : undefined}
            viewRequest={viewRequest}
            onSelectRoom={timelineOpen ? () => {} : setSelectedId}
            onMoveEnd={(id, x, y) => {
              if (typeof id !== 'string') return;
              if (id.startsWith('opening-')) moveOpening(Number(id.replace('opening-', '')), x);
              else moveObject(id, x, y);
            }}
            onResizeEnd={(id, w, d) => { const o = findObj(id); if (o) applyOps([{ type: 'resize_object', targetId: id, name: o.name, w, d, h: Number(o.h) || 0.22 }]); }}
            onFallbackNav={() => {}}
          />
        )}
      </div>

      {/* SURFACE 5b — one-line status strip (whole-house facts) */}
      <div className="rz-status">
        <span className="rz-status-item"><b>{fmtNum(derived.floor)}</b> sq ft</span>
        <span className="rz-dot" />
        <button
          type="button"
          className="rz-status-item rz-status-btn"
          title="Tap to see where every dollar comes from"
          onClick={() => setBudgetOpen((v) => !v)}
        ><b>{fmtMoney(derived.total)}</b> rough ▾</button>
        <span className="rz-dot" />
        <span className="rz-status-item"><b>{Math.round(derived.carbonKg / 1000)}</b> t CO₂e</span>
        <span className="rz-dot" />
        {flags.length === 0
          ? <span className="rz-status-item rz-clear">all clear</span>
          : <span className="rz-status-item rz-flag">{flags.length} to look at</span>}
      </div>

      {/* floor pills — the layout controller works one level at a time */}
      {!timelineOpen && viewMode === 'plan' && activeChapter === 'rooms' && (
        <div className="rz-floors">
          {hasBasement && (
            <button className={activeFloor === BASEMENT_LEVEL ? 'on' : ''} onClick={() => setActiveFloor(BASEMENT_LEVEL)}>Basement</button>
          )}
          {Array.from({ length: floors }, (_, i) => i + 1).map((f) => (
            <button key={f} className={activeFloor === f ? 'on' : ''} onClick={() => setActiveFloor(f)}>{floorLabel(spec, f)}</button>
          ))}
          {floors < 3 && (
            <button className="rz-floors-add" title="Add a storey — it gets an extent plate you can resize on its floor" onClick={addFloor}>+ floor</button>
          )}
          {floors > 1 && activeFloor === floors && (
            <button className="rz-floors-del" title="Remove this floor — its rooms move to the ground floor, nothing is deleted" onClick={removeFloor}>remove</button>
          )}
        </div>
      )}

      {/* Plan / 3D toggle + (3D only) view angles — the Time Machine owns the
          view while it's open */}
      {!timelineOpen && <div className="rz-views">
        <button className={viewMode === 'plan' ? 'on' : ''} onClick={() => setViewMode('plan')}>Plan</button>
        <button className={viewMode === '3d' ? 'on' : ''} onClick={() => setViewMode('3d')}>3D</button>
        {viewMode === '3d' && webglOK && <span className="rz-views-sep" />}
        {viewMode === '3d' && webglOK && [['iso', 'Corner'], ['top', 'Top'], ['front', 'Front'], ['side', 'Side']].map(([mode, label]) => (
          <button key={mode} onClick={() => setViewRequest({ mode, n: Date.now() })}>{label}</button>
        ))}
      </div>}

      {/* SURFACE 2 — the Trail (chapters + foreman greeting) */}
      <aside className={`rz-trail ${trailOpen ? 'open' : 'closed'}`}>
        <button className="rz-trail-toggle" onClick={() => setTrailOpen((v) => !v)} title={trailOpen ? 'Collapse' : 'Expand'}>
          {trailOpen ? '‹' : '›'}
        </button>
        {trailOpen && (
          <>
            <div className="rz-greeting">{chapter.greet(derived)}</div>
            {activeChapter === 'shape' && (
              <ShapeControls
                key={`${spec.shell.widthFt}x${spec.shell.depthFt}`}
                widthFt={spec.shell.widthFt}
                depthFt={spec.shell.depthFt}
                isRect={!spec.shell.footprint}
                corners={Array.isArray(spec.shell.footprint) ? spec.shell.footprint.length : 4}
                onCommit={resizeShell}
                onShape={setShape}
              />
            )}
            {activeChapter === 'rooms' && (
              <div className="rz-found">
                <div className="rz-found-head">Add a room{activeFloor !== 1 ? ` — ${floorLabel(spec, activeFloor).toLowerCase()}` : ''}</div>
                <div className="rz-found-palette rz-rooms-palette">
                  {ROOM_PRESETS.map((preset) => (
                    <button key={preset.name} type="button" title={`${preset.w} × ${preset.d} ft to start — drag and resize it after`} onClick={() => addRoomPreset(preset)}>
                      <b>{preset.name}</b>
                      <small>{preset.w} × {preset.d} ft</small>
                    </button>
                  ))}
                </div>
                <CustomRoomAdd onAdd={(preset) => addRoomPreset(preset)} />
                {roomNote && <div className="rz-shape-note">{roomNote}</div>}
                <div className="rz-shape-note">Tap a room on the plan to rename or remove it (or press Delete). Right-click for more.</div>
              </div>
            )}
            {activeChapter === 'foundation' && (
              <FoundationControls
                spec={spec}
                selectedId={selectedId}
                onChoose={chooseFoundation}
                onUtility={setUtilityField}
                onShell={setShellField}
                onPlaceRun={placeFoundationRun}
                onPlacePad={placeSlabPad}
                onRemoveRun={removeElement}
                onSelectRun={setSelectedId}
              />
            )}
            {activeChapter === 'shell' && (
              <StructureControls
                spec={spec}
                onAllWalls={setAllWalls}
                onFrame={setFrame}
                onShell={setShellField}
              />
            )}
            <nav className="rz-chapters">
              {CHAPTERS.map((c, i) => (
                <button
                  key={c.id}
                  className={`rz-chapter ${c.id === activeChapter ? 'active' : ''}`}
                  onClick={() => goChapter(c)}
                >
                  <span className="rz-chapter-num">{i + 1}</span>
                  <span className="rz-chapter-label">{c.label}</span>
                </button>
              ))}
            </nav>
            <button className="rz-build-btn" onClick={timelineOpen ? closeTimeline : openTimeline}>
              {timelineOpen ? '× Back to designing' : '▶ Watch it build'}
            </button>
            <div className="rz-stamp">
              <button className="rz-fresh" title="Clear this design and start from the sample" onClick={startFresh}>start fresh</button>
              {UPDATE_STAMP}
            </div>
          </>
        )}
      </aside>

      {/* SURFACE 4a — the Budget sheet: the first live Sheet. Every line opens
          to its math; the math is emitted by the engine itself. */}
      {budgetOpen && (
        <BudgetSheet derived={derived} onClose={() => setBudgetOpen(false)} />
      )}

      {/* SURFACE 3 — the Card (tap any part → vitals, receipts) */}
      {selectedRoom && (
        <RoomCard
          room={selectedRoom}
          derived={derived}
          onRename={(name) => renameObject(selectedRoom, name)}
          onRemove={() => removeObject(selectedRoom)}
          onClose={() => setSelectedId(null)}
        />
      )}
      {selectedId && !selectedRoom && (() => {
        const el = (spec.elements || []).find((e) => e.id === selectedId);
        return (
          <div className="rz-card">
            <div className="rz-card-head">
              {el
                ? <NameField value={el.name} onCommit={(name) => renameObject(el, name)} />
                : <h2>{prettyId(selectedId)}</h2>}
              <button className="rz-x" onClick={() => setSelectedId(null)}>×</button>
            </div>
            <p className="rz-muted">Drag it in the plan to move it; grab a corner to resize.</p>
            {el && (
              <button className="rz-remove" onClick={() => removeObject(el)}>Remove {el.name}</button>
            )}
          </div>
        );
      })()}

      {/* self-update chip — the app fetches its own newer versions */}
      {update && (
        <div className="rz-update">
          {update === 'applying' ? (
            <span className="rz-update-busy">Updating… the app will refresh itself in a moment.</span>
          ) : update.error ? (
            <span className="rz-update-err">Couldn’t update by itself ({update.error}) — the start.bat window can do it: close it and open it again.</span>
          ) : (
            <>
              <span>A newer version is ready{update.latest ? ` — “${update.latest}”` : ''}.</span>
              <button onClick={applyUpdateNow}>Update now</button>
              <button className="rz-update-later" onClick={() => setUpdate(null)}>Later</button>
            </>
          )}
        </div>
      )}

      {/* right-click menu — quick actions on whatever was tapped */}
      {ctxMenu && (() => {
        const room = spec.rooms.find((r) => r.id === ctxMenu.id);
        const el = room ? null : (spec.elements || []).find((e) => e.id === ctxMenu.id);
        const obj = room || el;
        if (!obj) return null;
        const level = Number(obj.level || 1);
        // Floors on offer: existing ones, one new floor above (up to 3), and
        // the basement when there is one — never the floor it's already on.
        const floorChoices = room ? [
          ...(hasBasement ? [BASEMENT_LEVEL] : []),
          ...Array.from({ length: Math.min(3, floors + 1) }, (_, i) => i + 1)
        ].filter((f) => f !== level) : [];
        const style = {
          left: Math.min(ctxMenu.x, window.innerWidth - 230),
          top: Math.min(ctxMenu.y, window.innerHeight - (150 + floorChoices.length * 30))
        };
        const startRename = () => {
          setCtxMenu(null);
          setTimeout(() => { const f = document.querySelector('.rz-card-name'); f?.focus(); f?.select(); }, 60);
        };
        return (
          <div className="rz-ctx" style={style} onPointerDown={(e) => e.stopPropagation()}>
            <div className="rz-ctx-title">{obj.name}</div>
            <button onClick={startRename}>Rename…</button>
            {room && <button onClick={() => { duplicateRoom(room); setCtxMenu(null); }}>Duplicate</button>}
            {floorChoices.map((f) => (
              <button key={f} onClick={() => { moveRoomToFloor(room, f); setCtxMenu(null); }}>
                Move to {floorLabel(spec, f).toLowerCase().replace(' floor', '')}{f > floors ? ' (new floor)' : ''}
              </button>
            ))}
            <button className="rz-ctx-danger" onClick={() => { removeObject(obj); setCtxMenu(null); }}>
              Remove {room ? 'room' : 'it'}
            </button>
          </div>
        );
      })()}

      {/* SURFACE 4 — the Time Machine: scrub to watch the house assemble,
          drag phases to re-plan, every rule explained in plain English */}
      {timelineOpen && (
        <TimelineStrip
          schedule={schedule}
          totalWeeks={totalWeeks}
          scrub={scrub}
          playing={playing}
          message={timelineMsg}
          isCustomOrder={!!phaseOrder}
          focusPhaseId={focusPhaseId}
          onScrub={(w) => { setPlaying(false); setScrub(w); }}
          onPlayPause={() => {
            if (!playing && scrub >= totalWeeks - 1e-6) setScrub(0);
            setPlaying((v) => !v);
          }}
          onFocusPhase={(id) => setFocusPhaseId((cur) => (cur === id ? null : id))}
          onMovePhase={proposeOrder}
          onResetOrder={() => { setPhaseOrder(null); setTimelineMsg({ tone: 'ok', text: 'Back to the builder’s order.' }); }}
          onClose={closeTimeline}
        />
      )}
      {timelineOpen && focusPhaseId && (
        <PhaseCard
          row={schedule.find((r) => r.id === focusPhaseId)}
          derived={derived}
          onClose={() => setFocusPhaseId(null)}
        />
      )}

      {/* SURFACE 4b — the Ask bar (a shortcut, never the only way) */}
      {!timelineOpen && <form
        className="rz-ask"
        onSubmit={(e) => { e.preventDefault(); if (askText.trim()) { setAskEcho(askText.trim()); setAskText(''); } }}
      >
        {askEcho && (
          <div className="rz-ask-echo">
            Heard: “{askEcho}”. Talking-to-change is coming — for now, drag rooms in Plan and grab their corners to resize.
          </div>
        )}
        <input
          value={askText}
          onChange={(e) => setAskText(e.target.value)}
          placeholder="Tell me what to change…  (or just drag it in the plan)"
        />
        <button type="submit" aria-label="Send">→</button>
      </form>}
    </div>
  );
}

// The Time Machine strip: play/scrub across the whole build, phase chips laid
// out in build order (width = duration), drag a chip to re-plan. A refused
// drag SHOWS ITS REASON — the strip never just snaps back silently.
function TimelineStrip({ schedule, totalWeeks, scrub, playing, message, isCustomOrder, focusPhaseId, onScrub, onPlayPause, onFocusPhase, onMovePhase, onResetOrder, onClose }) {
  const [dragId, setDragId] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const current = schedule.find((row) => scrub > row.startWeek + 1e-6 && scrub < row.endWeek - 1e-6)
    || schedule.find((row) => Math.abs(scrub - row.startWeek) <= 1e-6 && scrub < totalWeeks);
  const done = scrub >= totalWeeks - 1e-6;
  const headline = done
    ? `Week ${totalWeeks} — the house is finished.`
    : scrub <= 1e-6
      ? `Bare ground. About ${Math.ceil(totalWeeks)} weeks of work ahead — press play.`
      : current
        ? `Week ${Math.max(1, Math.ceil(scrub))} of ${Math.ceil(totalWeeks)} — ${current.title} underway`
        : `Week ${Math.max(1, Math.ceil(scrub))} of ${Math.ceil(totalWeeks)}`;
  const finishDrag = (toIdx) => {
    if (dragId != null && toIdx != null) onMovePhase(dragId, toIdx);
    setDragId(null); setDragOverIdx(null);
  };
  return (
    <div className="rz-timeline">
      <div className="rz-tl-top">
        <button className="rz-tl-play" onClick={onPlayPause} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="rz-tl-headline">{headline}</span>
        <span className="rz-tl-spacer" />
        {isCustomOrder && <button className="rz-tl-reset" onClick={onResetOrder}>Builder’s order</button>}
        <button className="rz-x" onClick={onClose}>×</button>
      </div>
      <input
        className="rz-tl-scrub"
        type="range"
        min="0"
        max={totalWeeks}
        step="0.1"
        value={scrub}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="Scrub through the build"
      />
      <div className="rz-tl-chips">
        {schedule.map((row, idx) => {
          const state = scrub >= row.endWeek - 1e-6 ? 'done' : scrub > row.startWeek + 1e-6 ? 'now' : 'todo';
          const broken = row.checks.some((check) => !check.ok);
          return (
            <button
              key={row.id}
              type="button"
              draggable
              className={`rz-chip ${state} ${focusPhaseId === row.id ? 'focus' : ''} ${dragOverIdx === idx ? 'dropmark' : ''}`}
              style={{ flexGrow: Math.max(1, Number(row.weeks) || 1) }}
              title={`${row.title} — weeks ${row.startWeek}–${row.endWeek}. Drag to re-plan, tap for details.`}
              onClick={() => onFocusPhase(row.id)}
              onDragStart={() => setDragId(row.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDragLeave={() => setDragOverIdx((cur) => (cur === idx ? null : cur))}
              onDrop={(e) => { e.preventDefault(); finishDrag(idx); }}
              onDragEnd={() => { setDragId(null); setDragOverIdx(null); }}
            >
              <span className="rz-chip-label">{PHASE_SHORT[row.id] || row.title}</span>
              {row.inspector && <span className="rz-chip-badge" title="Inspector visits at the end of this phase">✓</span>}
              {broken && <span className="rz-chip-warn" title="A rule is broken at this position — tap for the reason">!</span>}
            </button>
          );
        })}
      </div>
      {message && <div className={`rz-tl-msg ${message.tone}`}>{message.text}</div>}
      {!message && <div className="rz-tl-msg hint">Drag a phase to re-plan the build. Hard rules (what carries what, what must stay dry or cure) hold — everything else is your call.</div>}
    </div>
  );
}

// One phase, opened: when it runs, what it costs, who inspects, and every
// dependency receipt — the plain-English math of why it sits where it sits.
function PhaseCard({ row, derived, onClose }) {
  const [expanded, setExpanded] = useState(false);
  if (!row) return null;
  const cost = Math.round((Number(row.costPct) || 0) * derived.total);
  return (
    <div className="rz-card rz-phase-card">
      <div className="rz-card-head">
        <h2>{row.title}</h2>
        <button className="rz-x" onClick={onClose}>×</button>
      </div>
      <div className="rz-vitals">
        <Vital label="When" value={`weeks ${row.startWeek}–${row.endWeek}`} />
        <Vital label="Takes" value={`${row.weeks} week${row.weeks === 1 ? '' : 's'}`} />
        <Vital label="Rough cost" value={cost > 0 ? `≈ ${fmtMoney(cost)}` : '—'} />
        <Vital label="Inspection" value={row.inspector ? 'yes, at the end' : 'none'} />
      </div>
      {row.checks.length > 0 && (
        <div className="rz-phase-checks">
          {row.id === 'occupancy'
            ? <div className={`rz-check ${row.checks.every((c) => c.ok) ? 'ok' : 'bad'}`}>
                {row.checks.every((c) => c.ok)
                  ? 'Everything is built before the inspector arrives. OK.'
                  : row.checks.find((c) => !c.ok).text}
              </div>
            : row.checks.map((check, i) => (
              <div key={i} className={`rz-check ${check.ok ? 'ok' : 'bad'}`}>{check.text}</div>
            ))}
        </div>
      )}
      <button className="rz-more" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'less' : 'more…'}
      </button>
      {expanded && (
        <div className="rz-more-body rz-phase-more">
          <p className="rz-muted"><b>Materials:</b> {row.materials}</p>
          <p className="rz-muted"><b>Tools:</b> {row.tools}</p>
          <p className="rz-muted"><b>Safety:</b> {row.safety}</p>
          <p className="rz-muted"><b>Weather:</b> {row.weather}</p>
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, derived, onRename, onRemove, onClose }) {
  const [expanded, setExpanded] = useState(false);
  const area = Math.round((Number(room.w) || 0) * (Number(room.d) || 0));
  const sharePct = derived.floor > 0 ? Math.round((area / derived.floor) * 100) : 0;
  return (
    <div className="rz-card">
      <div className="rz-card-head">
        <NameField value={room.name} onCommit={onRename} />
        <button className="rz-x" onClick={onClose}>×</button>
      </div>

      <div className="rz-vitals">
        <Vital label="Size" value={`${round1(room.w)} × ${round1(room.d)} ft`} />
        <Vital label="Area" value={`${fmtNum(area)} sq ft`} />
        <Vital label="Use" value={TYPE_LABEL[room.type] || room.type || '—'} />
        <Vital label="Floor" value={room.floor || '—'} />
      </div>

      {/* a first receipt: where this area sits in the whole house */}
      <div className="rz-receipt">
        <span className="rz-receipt-key">Share of floor</span>
        <span className="rz-receipt-val">{area} ÷ {fmtNum(derived.floor)} sq ft = <b>{sharePct}%</b></span>
      </div>

      <button className="rz-more" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'less' : 'more…'}
      </button>
      {expanded && (
        <div className="rz-more-body">
          <p className="rz-muted">
            Drag this room in the Plan view to move it; grab a corner to resize. Tap the name
            above to rename it.
          </p>
        </div>
      )}
      <button className="rz-remove" onClick={onRemove}>Remove this room</button>
    </div>
  );
}

// Any room, by name: type "hallway" (or anything else) and add it. Known
// names come in at a sensible shape — a hallway starts long and narrow; an
// unrecognized name starts 10 × 10. The name you type is the name it gets.
function CustomRoomAdd({ onAdd }) {
  const [name, setName] = useState('');
  const add = () => {
    const preset = roomPresetFromName(name);
    if (!preset) return;
    onAdd(preset);
    setName('');
  };
  return (
    <div className="rz-room-custom">
      <input
        value={name}
        placeholder="Or name your own… (hallway, foyer, music room)"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
      />
      <button type="button" disabled={!name.trim()} onClick={add}>Add</button>
    </div>
  );
}

// The card title IS the rename control: tap, type, Enter or click away.
function NameField({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <input
      className="rz-card-name"
      value={draft}
      title="Tap to rename"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
    />
  );
}

// One receipt line, math written out: "1,280 sf of wall face × $16/sf = $20,480".
function ReceiptLine({ line }) {
  const rateUnit = line.unit ? line.unit.split(' ')[0] : '';
  const math = line.qty != null && line.rate != null
    ? `${fmtNum(line.qty)} ${line.unit} × ${line.each ? `$${line.rate} each` : `$${line.rate}/${rateUnit}`} = `
    : '';
  const negative = line.amount < 0;
  return (
    <div className="rz-rline">
      <div className="rz-rline-main">
        <span className="rz-rline-label">{line.label}</span>
        <span className={`rz-rline-amount ${negative ? 'neg' : ''}`}>
          {negative ? `−${fmtMoney(Math.abs(line.amount))}` : fmtMoney(line.amount)}
        </span>
      </div>
      {(math || line.note) && (
        <div className="rz-rline-math">{math && <span>{math}{fmtMoney(Math.abs(line.amount))}</span>}{math && line.note ? ' — ' : ''}{line.note}</div>
      )}
    </div>
  );
}

// The Budget sheet — where every dollar shows its work. Rows come from the
// engine's own receipts (built inside deriveDesign), so what you read here IS
// the math that produced the total, not a retelling of it.
function BudgetSheet({ derived, onClose }) {
  const [openKey, setOpenKey] = useState(null);
  const rows = COST_ROWS
    .map((row) => ({ ...row, amount: derived.cost[row.key] || 0, lines: derived.receipts.systems[row.key] || [] }))
    .filter((row) => row.amount > 0 || row.lines.length > 0)
    .sort((a, b) => b.amount - a.amount);
  const maxAmount = Math.max(1, ...rows.map((row) => row.amount));
  return (
    <div className="rz-budget">
      <div className="rz-budget-head">
        <h2>Where the money goes</h2>
        <button className="rz-x" onClick={onClose}>×</button>
      </div>
      <div className="rz-budget-rows">
        {rows.map((row) => (
          <div key={row.key} className={`rz-brow ${openKey === row.key ? 'open' : ''}`}>
            <button type="button" className="rz-brow-head" onClick={() => setOpenKey(openKey === row.key ? null : row.key)}>
              <span className="rz-brow-label">{row.label}</span>
              <span className="rz-brow-bar"><span style={{ width: `${Math.round((row.amount / maxAmount) * 100)}%` }} /></span>
              <span className="rz-brow-amount">{fmtMoney(row.amount)}</span>
            </button>
            {openKey === row.key && (
              <div className="rz-brow-body">
                {row.lines.length === 0
                  ? <div className="rz-rline-math">Nothing on this line yet.</div>
                  : row.lines.map((line, i) => <ReceiptLine key={i} line={line} />)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="rz-budget-foot">
        <div className="rz-bfoot-row"><span>Everything, bought new</span><b>{fmtMoney(derived.totalBeforeSweat)}</b></div>
        {derived.receipts.sweat.map((line, i) => (
          <div key={i} className="rz-bfoot-row rz-bfoot-sweat"><span>{line.label}</span><b>−{fmtMoney(Math.abs(line.amount))}</b></div>
        ))}
        <div className="rz-bfoot-row rz-bfoot-total"><span>Rough total</span><b>{fmtMoney(derived.total)}</b></div>
        <div className="rz-budget-note">
          Planning figures with placeholder rates — for comparing choices, not for quoting.
          Every line above shows the exact math the total is made of.
        </div>
      </div>
    </div>
  );
}

// Shape chapter's plain controls: pick an outline, then the size in numbers.
// Presets are starting points — every edge stays draggable on the plan after.
function ShapeControls({ widthFt, depthFt, isRect, corners, onCommit, onShape }) {
  const [w, setW] = useState(String(Math.round(widthFt * 10) / 10));
  const [d, setD] = useState(String(Math.round(depthFt * 10) / 10));
  const commit = () => {
    const nw = Number(w); const nd = Number(d);
    if (Number.isFinite(nw) && Number.isFinite(nd) && (nw !== widthFt || nd !== depthFt)) onCommit(nw, nd);
  };
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  return (
    <div className="rz-shape">
      <div className="rz-shape-presets">
        {[['rect', 'Rectangle'], ['l', 'L'], ['t', 'T'], ['u', 'U']].map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className={kind === 'rect' && isRect ? 'on' : ''}
            onClick={() => onShape(kind)}
            title={kind === 'rect' ? 'Plain rectangle' : `${label}-shaped outline — a starting point you can drag`}
          >{label}</button>
        ))}
      </div>
      {!isRect && <div className="rz-shape-note">custom outline · {corners} corners — drag any edge on the plan</div>}
      <div className="rz-shape-size">
        <label className="rz-shape-field">
          <span>Width</span>
          <input type="number" min="12" max="96" step="1" value={w} onChange={(e) => setW(e.target.value)} onBlur={commit} onKeyDown={onKey} />
          <em>ft</em>
        </label>
        <span className="rz-shape-x">×</span>
        <label className="rz-shape-field">
          <span>Depth</span>
          <input type="number" min="12" max="80" step="1" value={d} onChange={(e) => setD(e.target.value)} onBlur={commit} onKeyDown={onKey} />
          <em>ft</em>
        </label>
      </div>
    </div>
  );
}

// A number field that commits ONCE on blur/Enter — typing digits must never
// dispatch per keystroke (clamps would fight the digits).
function NumInput({ value, min, max, step = 1, unit = 'ft', onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n !== Number(value)) onCommit(clamp(n, min, max));
  };
  return (
    <span className="rz-num">
      <input
        type="number" min={min} max={max} step={step} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
      />
      <em>{unit}</em>
    </span>
  );
}

// Foundation chapter: the main type the house sits on, plus footing runs that
// live on their own layout — under a heavy interior wall, a porch, a future
// addition, inside or outside the rooms.
function FoundationControls({ spec, selectedId, onChoose, onUtility, onShell, onPlaceRun, onPlacePad, onRemoveRun, onSelectRun }) {
  const u = utilitiesOf(spec);
  const basement = basementInfo(spec.shell);
  const typeVal = basement.present ? 'basement' : u.foundationType;
  const runs = (spec.elements || []).filter((el) => el.category === 'foundation');
  const runCost = (el) => {
    const t = FOUNDATION_RUN_TYPES[el.construction] || FOUNDATION_RUN_TYPES.rubble;
    if (t.perSf) return Math.round((Number(el.w) * Number(el.d) || 0) * t.costSf);
    const lf = Math.max(Number(el.w) || 0, Number(el.d) || 0);
    return Math.round(lf * (t.costLf + t.stemCostLfFt * (Number(el.h) || 0)));
  };
  const runMeasure = (el) => (FOUNDATION_RUN_TYPES[el.construction]?.perSf
    ? `${Math.round(Number(el.w) * Number(el.d) || 0)} sf`
    : `${Math.round(Math.max(Number(el.w) || 0, Number(el.d) || 0))} ft`);
  return (
    <div className="rz-found">
      <label className="rz-field">
        <span>Main foundation</span>
        <select value={typeVal} onChange={(e) => onChoose(e.target.value)}>
          <option value="rubble">🌿 Rubble trench — drained gravel, the least concrete</option>
          <option value="stemwall">Stem wall — concrete wall on a footing</option>
          <option value="slab">Insulated slab — simple, the most concrete</option>
          <option value="basement">Basement — a full storey below grade</option>
        </select>
      </label>
      {typeVal === 'stemwall' && (
        <label className="rz-field rz-field-num">
          <span>Stem wall height</span>
          <NumInput value={u.stemwallHeightFt ?? 1.5} min={0.5} max={6} step={0.25} onCommit={(v) => onUtility('stemwallHeightFt', v)} />
        </label>
      )}
      {typeVal === 'basement' && (
        <label className="rz-field rz-field-num">
          <span>Basement depth</span>
          <NumInput value={basement.heightFt} min={6} max={12} step={0.5} onCommit={(v) => onShell('basementHeightFt', v)} />
        </label>
      )}
      <div className="rz-found-head">The foundation's own layout</div>
      <button type="button" className="rz-pad-btn" title={FOUNDATION_RUN_TYPES.slabpad.note} onClick={onPlacePad}>
        <b>Slab — one shape, any size</b>
        <small>drops 2 ft bigger than the house · ${FOUNDATION_RUN_TYPES.slabpad.costSf}/sf{typeVal === 'slab' ? ' · becomes THE slab' : ''}</small>
      </button>
      <div className="rz-found-palette">
        {FOUNDATION_RUN_PRESETS.map((preset) => {
          const t = FOUNDATION_RUN_TYPES[preset.construction];
          return (
            <button key={preset.construction} type="button" title={t.note} onClick={() => onPlaceRun(preset)}>
              <b>{t.label}</b>
              <small>${Math.round(t.costLf + t.stemCostLfFt * preset.h)}/ft</small>
            </button>
          );
        })}
      </div>
      {runs.length > 0 && (
        <div className="rz-found-list">
          {runs.map((el) => (
            <div key={el.id} className={`rz-found-row ${selectedId === el.id ? 'sel' : ''}`}>
              <button type="button" className="rz-found-pick" onClick={() => onSelectRun(el.id)}>
                {(FOUNDATION_RUN_TYPES[el.construction] || FOUNDATION_RUN_TYPES.rubble).label}
                <small>{runMeasure(el)} · {fmtMoney(runCost(el))}{FOUNDATION_RUN_TYPES[el.construction]?.perSf && typeVal === 'slab' ? ' — this IS the slab line' : ''}</small>
              </button>
              <button type="button" className="rz-x" title="Remove this footing" onClick={() => onRemoveRun(el)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="rz-shape-note">Drop one, then drag and stretch it on the plan — bigger than the house, under a porch, anywhere. Strips price by the foot, slab shapes by the square foot; with a slab foundation your drawn shape IS the slab, priced once.</div>
    </div>
  );
}

// Shell chapter: the structure in three plain choices — what the walls are,
// what carries the roof, how tall the walls run. The timeline's build order
// and every receipt follow these.
function StructureControls({ spec, onAllWalls, onFrame, onShell }) {
  const resolved = WALL_SIDES.map((side) => resolveWallSide(spec, side));
  const wallKeys = new Set(resolved.map((r) => r.assemblyKey));
  const wallVal = wallKeys.size === 1 ? [...wallKeys][0] : '__mixed';
  const frameVal = resolveFrameType(spec, 1);
  return (
    <div className="rz-found">
      <label className="rz-field">
        <span>Walls (all sides)</span>
        <select value={wallVal} onChange={(e) => { if (e.target.value !== '__mixed') onAllWalls(e.target.value); }}>
          {wallVal === '__mixed' && <option value="__mixed">Mixed — sides differ</option>}
          {Object.values(WALL_ASSEMBLIES).map((a) => (
            <option key={a.key} value={a.key}>{a.green ? '🌿 ' : ''}{a.label} — R{a.rValue}</option>
          ))}
        </select>
      </label>
      <label className="rz-field">
        <span>Frame — what carries the roof</span>
        <select value={frameVal} onChange={(e) => onFrame(e.target.value)}>
          {Object.entries(FRAME_TYPES).map(([key, f]) => (
            <option key={key} value={key}>{f.green ? '🌿 ' : ''}{f.label}</option>
          ))}
        </select>
      </label>
      <label className="rz-field rz-field-num">
        <span>Wall height</span>
        <NumInput value={Number(spec.shell.wallHeightFt) || 10} min={7} max={40} step={0.5} onCommit={(v) => onShell('wallHeightFt', v)} />
      </label>
      <div className="rz-shape-note">Whole-house choices — with load-bearing walls the timeline walls first, then roofs; with a frame it roofs before straw walls go in. Wall-by-wall control comes with the tap-a-wall card.</div>
    </div>
  );
}

function Vital({ label, value }) {
  return (
    <div className="rz-vital">
      <div className="rz-vital-label">{label}</div>
      <div className="rz-vital-value">{value}</div>
    </div>
  );
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const prettyId = (id) => String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
