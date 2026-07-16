import React, { useEffect, useMemo, useState } from 'react';
import { ThreeScene, webglAvailable } from '../threeScene.jsx';
import { PlanView } from '../planView.jsx';
import {
  applyBimOperations, clamp, basementInfo, BASEMENT_LEVEL, FRAME_TYPES, resolveFrameType, CLADDING_TYPES,
  INSULATION_TYPES, resolveInsulation, OPENING_TYPES,
  FLOORING_TYPES, SUBFLOOR_TYPES, resolveFlooring, resolveSubfloor, RECLAIMED_DEFAULTS, storeyHeightFt
} from '../../backend/bim-core.mjs';
import {
  seedSpec, getWallSections, deriveDesign, detectIssues, fmtMoney, fmtNum, COST_ROWS,
  buildTimeline, phaseDependencies, orderPhasesByDeps, validatePhaseOrder, DEFAULT_MODEL_LAYERS,
  floorCount, floorLabel, storeyInfo, upperPlateRect, utilitiesOf, resolveOverhangs,
  WALL_SIDES, WALL_SIDE_LABELS, WALL_ASSEMBLIES, resolveWallSide, FOUNDATION_RUN_TYPES, FOUNDATION_RUN_PRESETS,
  ROOM_PRESETS, planNewRoomPlacements, roomPresetFromName,
  resolveDrainage, DRAINAGE_DISCHARGE, roofRunoffGallons
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
  { id: 'shape', label: 'Shape', view: 'plan', planContext: 'shell', greet: (d) => `Shape the whole building — a plain rectangle or an L, T, or U — or pick any room or element from the dropdown to size just that one. Right now the house is ${fmtNum(d.floor)} sq ft.` },
  { id: 'rooms', label: 'Rooms', view: 'plan', planContext: 'rooms', greet: () => 'Lay the rooms out flat, from above. Use the Floor selector (top left) to add a floor or switch between them — each floor keeps its own rooms and its own outline. Drag a room to move it, a corner to resize.' },
  { id: 'foundation', label: 'Foundation', view: 'plan', planContext: 'foundation', greet: () => 'What the house sits on. Pick the main type below — and the foundation doesn’t have to match the rooms: drop extra footings and drag them under whatever they carry, even outside the walls.' },
  { id: 'shell', label: 'Shell', view: '3d', greet: (d) => `The shell stands ${fmtNum(d.storeys)} storey${d.storeys === 1 ? '' : 's'}. Pick the wall system and the frame that carries the roof — the timeline and every receipt follow along.` },
  { id: 'roof', label: 'Roof', view: '3d', greet: () => 'Choose how the roof sheds weather and sun. Pick the shape, how steep it runs, what insulates it, and how far it reaches past the walls.' },
  { id: 'openings', label: 'Openings', view: 'plan', planContext: 'windows', greet: () => 'Place doors and windows where light and paths want them. Slide them along their wall.' },
  { id: 'systems', label: 'Systems', view: '3d', greet: () => 'Heat, water, power, waste — the working parts. Each shows its own receipts.' },
  { id: 'finishes', label: 'Finishes', view: '3d', greet: () => 'Materials and surfaces, inside and out — natural or conventional, wall by wall.' }
];

// Bumped on every shell change so Daniel can see at a glance which version
// his browser is showing (bottom of the Trail).
const UPDATE_STAMP = 'update 50 · Jul 15';

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

// Saved designs — a keepsake shelf so "start fresh" never has to throw work
// away. Each entry is a named snapshot kept in this browser; the design you're
// actively editing stays live in STORE_KEY. All local, no server — same as the
// working design.
const DESIGNS_KEY = 'rz.designs.v1';
function loadDesigns() {
  try {
    const raw = localStorage.getItem(DESIGNS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((d) => d && d.spec && d.spec.shell) : [];
  } catch { return []; }
}
function persistDesigns(list) {
  try { localStorage.setItem(DESIGNS_KEY, JSON.stringify(list)); } catch { /* storage full/blocked — in-memory still works */ }
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
  const [viewRequest, setViewRequest] = useState({ mode: 'iso', n: 1 });
  const [designs, setDesigns] = useState(loadDesigns); // the keepsake shelf
  const [designsOpen, setDesignsOpen] = useState(false);
  const [heading, setHeading] = useState(0); // camera compass heading (radians) for the overlay compass
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
  // Undo/redo: stacks of past/future spec snapshots. Clipboard: a copied
  // room or element, for cut/copy/paste.
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [clipboard, setClipboard] = useState(null);

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
  // Every change goes through commitSpec so it lands on the undo stack (capped
  // at 80) and clears the redo future. Undo/redo just swap snapshots.
  const commitSpec = (nextSpec) => {
    setUndoStack((st) => [...st, spec].slice(-80));
    setRedoStack([]);
    setSpec(nextSpec);
  };
  const applyOps = (operations) => {
    const report = applyBimOperations(spec, { operations });
    if (report?.spec) commitSpec(report.spec);
  };
  const undo = () => {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((r) => [...r, spec].slice(-80));
    setSpec(prev);
    setSelectedId((id) => (prev.rooms.some((x) => x.id === id) || (prev.elements || []).some((x) => x.id === id) ? id : null));
  };
  const redo = () => {
    if (!redoStack.length) return;
    const nxt = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((u) => [...u, spec].slice(-80));
    setSpec(nxt);
  };
  const moveObject = (id, x, y) => {
    const o = findObj(id); if (!o) return;
    // Moving a storey's extent plate carries its rooms along by the same delta,
    // so the whole floor shifts as one (and the covers-rooms rule doesn't snap
    // the plate back to where the rooms were left behind).
    if (o.category === 'floor' && Number(o.level || 1) >= 2) {
      const dx = Number(x) - (Number(o.x) || 0);
      const dy = Number(y) - (Number(o.y) || 0);
      const ops = [{ type: 'move_object', targetId: id, name: o.name, x, y }];
      (spec.rooms || []).filter((r) => Number(r.level || 1) === Number(o.level || 1)).forEach((r) => {
        ops.push({ type: 'move_object', targetId: r.id, name: r.name, x: (Number(r.x) || 0) + dx, y: (Number(r.y) || 0) + dy });
      });
      applyOps(ops);
      return;
    }
    applyOps([{ type: 'move_object', targetId: id, name: o.name, x, y }]);
  };
  const resizeObject = (id, x, y, w, d) => {
    const o = findObj(id); if (!o) return;
    // Dragging an upper storey's extent plate smaller: pull its rooms in to fit
    // so the plate keeps the size dragged instead of snapping back out to cover
    // them (same rule as the numeric resizeFloor).
    if (o.category === 'floor' && Number(o.level || 1) >= 2) {
      const ops = [
        { type: 'resize_object', targetId: id, name: o.name, w, d, h: Number(o.h) || 0.4 },
        { type: 'move_object', targetId: id, name: o.name, x, y }
      ];
      (spec.rooms || []).filter((r) => Number(r.level || 1) === Number(o.level || 1)).forEach((r) => {
        const nw = Math.min(Number(r.w), w);
        const nd = Math.min(Number(r.d), d);
        const nx = clamp(Number(r.x), x, x + w - nw);
        const ny = clamp(Number(r.y), y, y + d - nd);
        if (nw !== Number(r.w) || nd !== Number(r.d)) ops.push({ type: 'resize_object', targetId: r.id, name: r.name, w: nw, d: nd, h: Number(r.h) || 0.22 });
        if (nx !== Number(r.x) || ny !== Number(r.y)) ops.push({ type: 'move_object', targetId: r.id, name: r.name, x: nx, y: ny });
      });
      applyOps(ops);
      return;
    }
    // Resizing an INDOOR room past the walls grows the house to fit instead of
    // snapping the room back to the footprint — stretching a room enlarges the
    // building, the same as adding one does. (Outdoor rooms can already exceed
    // the footprint; other elements aren't shell-bound.)
    const isRoom = (spec.rooms || []).some((r) => r.id === id);
    const outdoor = ['outdoor', 'site', 'garden', 'animal', 'landscape', 'plant', 'water', 'earthwork'].includes(o.type);
    const ops = [
      { type: 'resize_object', targetId: id, name: o.name, w, d, h: Number(o.h) || 0.22 },
      { type: 'move_object', targetId: id, name: o.name, x, y }
    ];
    if (isRoom && !outdoor) {
      const needW = Math.ceil(Number(x) + Number(w));
      const needD = Math.ceil(Number(y) + Number(d));
      if (needW > Number(spec.shell.widthFt)) ops.unshift({ type: 'set_shell', field: 'widthFt', value: String(clamp(needW, 12, 96)) });
      if (needD > Number(spec.shell.depthFt)) ops.unshift({ type: 'set_shell', field: 'depthFt', value: String(clamp(needD, 12, 80)) });
    }
    applyOps(ops);
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
  // Openings: drop a door/window on a wall (centered on that wall to start),
  // or pull one out. Position and width are then tuned by dragging on the plan.
  const addOpening = (wall, type, level = 1, extras = {}) => {
    const profile = OPENING_TYPES[type] || OPENING_TYPES.window;
    const isRoof = wall === 'roof' || profile.roof;
    const wallLen = wall === 'north' || wall === 'south' ? Number(spec.shell.widthFt) : Number(spec.shell.depthFt);
    const widthFt = profile.defaultW || 3;
    const positionFt = isRoof ? Number(spec.shell.widthFt) / 2 : Math.max(0.5, wallLen / 2 - widthFt / 2);
    applyOps([{ type: 'add_opening', wall: isRoof ? 'roof' : wall, openingType: type, widthFt, positionFt, level: isRoof ? 1 : level, ...extras }]);
  };
  // A dormer is a 2nd-floor+ window carried by a dormer of the chosen style.
  const addDormer = (wall, style, level) => addOpening(wall, 'window', Math.max(2, level), { dormerStyle: style });
  const removeOpening = (index) => applyOps([{ type: 'remove_object', targetId: `opening-${index}` }]);
  const sizeOpening = (index, widthFt) => {
    const op = spec.openings?.[index]; if (!op) return;
    applyOps([{ type: 'update_object', targetId: `opening-${index}`, field: 'widthFt', value: clamp(Number(widthFt), 1, 24) }]);
  };
  // Set any single field on a placed opening (shade eyebrow depth, tilt, dormer).
  const setOpeningField = (index, field, value) => applyOps([{ type: 'update_object', targetId: `opening-${index}`, field, value }]);
  // Size any single object (room or element) — width × depth, position kept.
  const sizeObject = (obj, w, d) => applyOps([{ type: 'resize_object', targetId: obj.id, name: obj.name, w, d, h: Number(obj.h) || 0.22 }]);

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
  // Size a floor's footprint by the numbers — reliable where a corner-drag is
  // fiddly. Ground floor IS the shell; an upper floor is its extent plate. Any
  // rooms on an upper floor are pulled in to fit the new outline, so the plate
  // keeps the size you set instead of snapping back out to cover them.
  const resizeFloor = (level, w, d) => {
    const W = clamp(Number(w), 8, 96);
    const D = clamp(Number(d), 8, 80);
    if (level === 1) { resizeShell(W, D); return; }
    const plate = (spec.elements || []).find((e) => e.category === 'floor' && Number(e.level || 1) === level);
    if (!plate) return;
    const px = Number(plate.x) || 0;
    const py = Number(plate.y) || 0;
    const ops = [{ type: 'resize_object', targetId: plate.id, name: plate.name, w: W, d: D, h: Number(plate.h) || 0.4 }];
    (spec.rooms || []).filter((r) => Number(r.level || 1) === level).forEach((r) => {
      const nw = Math.min(Number(r.w), W);
      const nd = Math.min(Number(r.d), D);
      const nx = clamp(Number(r.x), px, px + W - nw);
      const ny = clamp(Number(r.y), py, py + D - nd);
      if (nw !== Number(r.w) || nd !== Number(r.d)) ops.push({ type: 'resize_object', targetId: r.id, name: r.name, w: nw, d: nd, h: Number(r.h) || 0.22 });
      if (nx !== Number(r.x) || ny !== Number(r.y)) ops.push({ type: 'move_object', targetId: r.id, name: r.name, x: nx, y: ny });
    });
    applyOps(ops);
  };
  // One height knob per floor. The ground floor's height is the wall height
  // (drives the roof); each upper storey carries its OWN height so a 10' ground
  // under a 9' second and an 8' third all stack correctly.
  const setFloorHeight = (level, ft) => {
    const v = clamp(Number(ft), 7, 16);
    if (level === 1) setShellField('wallHeightFt', v);
    else applyOps([{ type: 'set_storey_height', level, value: v }]);
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
  // A separate slab pad for an OUTSIDE space — carport, patio, walkway. It's
  // its own foundation (a 'slabpad' element), sized to the use and dropped
  // beside the house to drag into place.
  const placeOutdoorPad = (pad) => {
    const runs = (spec.elements || []).filter((el) => el.category === 'foundation');
    const same = runs.filter((el) => el.name === pad.name || el.name.startsWith(`${pad.name} `)).length;
    const name = same === 0 ? pad.name : `${pad.name} ${same + 1}`;
    applyOps([{
      type: 'add_element', name, category: 'foundation', construction: 'slabpad',
      x: Number(spec.shell.widthFt) + 3, y: 2 + runs.length * 3, w: pad.w, d: pad.d, h: 0.35, level: 1
    }]);
  };
  // Set a run's size numerically — no dragging needed. For a strip run the
  // number IS its length (the long axis, thin dimension kept); a pad takes
  // width × depth.
  const sizeRun = (el, w, d) => applyOps([{ type: 'resize_object', targetId: el.id, name: el.name, w, d, h: Number(el.h) || 0.35 }]);
  const placeFoundationRun = (preset) => {
    // Land beside the house (never at 0,0 — that's "unset" to the op layer),
    // staggered so repeated drops don't pile up; then drag it into place. Each
    // run gets a UNIQUE name (…2, …3) so they're distinct in the list and can't
    // be confused for one another.
    const runs = (spec.elements || []).filter((el) => el.category === 'foundation');
    const sameKind = runs.filter((el) => el.construction === preset.construction).length;
    const name = sameKind === 0 ? preset.name : `${preset.name} ${sameKind + 1}`;
    applyOps([{
      type: 'add_element', name, category: 'foundation', construction: preset.construction,
      x: 2 + (runs.length % 2) * (preset.w + 2), y: Number(spec.shell.depthFt) + 3 + Math.floor(runs.length / 2) * 3.5,
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

  // --- cut / copy / paste of the selected room or element --------------------
  const selectedObj = () => spec.rooms.find((r) => r.id === selectedId)
    || (spec.elements || []).find((e) => e.id === selectedId) || null;
  const isRoom = (o) => o && spec.rooms.some((r) => r.id === o.id);
  const copySelection = () => { const o = selectedObj(); if (o) setClipboard({ isRoom: isRoom(o), obj: structuredClone(o) }); };
  const cutSelection = () => { const o = selectedObj(); if (o) { setClipboard({ isRoom: isRoom(o), obj: structuredClone(o) }); removeObject(o); } };
  const pasteClipboard = () => {
    if (!clipboard) return;
    const o = clipboard.obj;
    if (clipboard.isRoom) {
      // place cleanly via the room packer (free spot, auto-unique name)
      const plan = planNewRoomPlacements(spec, [{ name: o.name, type: o.type, w: Number(o.w), d: Number(o.d) }], activeFloor === BASEMENT_LEVEL ? BASEMENT_LEVEL : activeFloor);
      if (plan.ops.length) applyOps(plan.ops);
    } else {
      // drop a copy a little down-and-right of the original (ids are unique;
      // same name is fine now that ops resolve by id)
      applyOps([{
        type: 'add_element', name: `${o.name} copy`, category: o.category, construction: o.construction || '',
        x: Number(o.x) + 2, y: Number(o.y) + 2, z: Number(o.z) || 0,
        w: Number(o.w), d: Number(o.d), h: Number(o.h) || 1, level: Number(o.level) || 1,
        roofType: o.roofType || ''
      }]);
    }
  };

  // Compass heading: poll the live camera on a timer (NOT the render loop —
  // a timer keeps ticking even when requestAnimationFrame is throttled, so the
  // compass never freezes). Heading = azimuth around Y; north is world −z.
  useEffect(() => {
    if (viewMode !== '3d' || timelineOpen) return undefined;
    const id = setInterval(() => {
      const v = typeof window !== 'undefined' ? window.__nbView : null;
      if (!v?.camera || !v?.controls) return;
      const c = v.camera.position, t = v.controls.target;
      const h = Math.atan2(c.x - t.x, c.z - t.z);
      setHeading((prev) => (Math.abs(prev - h) > 0.008 ? h : prev));
    }, 90);
    return () => clearInterval(id);
  }, [viewMode, timelineOpen]);

  // autosave the design to this browser (debounced — never per keystroke)
  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ spec, savedAt: Date.now() })); } catch { /* storage full/blocked — in-memory still works */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [spec]);
  // Save the design you're editing to the keepsake shelf — a new entry, or an
  // update to the one with the same name. Returns the saved snapshot.
  const saveCurrentDesign = (rawName) => {
    const name = (rawName || spec.projectName || 'My design').trim() || 'My design';
    const snapshot = { id: `d${Date.now()}`, name, spec: structuredClone(spec), savedAt: Date.now() };
    setDesigns((prev) => {
      const next = [snapshot, ...prev.filter((d) => d.name !== name)];
      persistDesigns(next);
      return next;
    });
    return snapshot;
  };
  const handleSaveDesign = () => {
    const name = window.prompt('Name this design so you can find it again:', spec.projectName || 'My design');
    if (name === null) return; // backed out
    const saved = saveCurrentDesign(name);
    setDesignsOpen(true);
    setSaveFlash(saved.name);
    setTimeout(() => setSaveFlash(null), 2200);
  };
  const openDesign = (id) => {
    const d = designs.find((x) => x.id === id);
    if (!d) return;
    commitSpec(structuredClone(d.spec)); // undoable — Ctrl+Z returns to what you had
    setSelectedId(null);
    setPhaseOrder(null);
  };
  const deleteDesign = (id) => {
    if (!window.confirm('Delete this saved design? This can’t be undone.')) return;
    setDesigns((prev) => { const next = prev.filter((d) => d.id !== id); persistDesigns(next); return next; });
  };
  const [saveFlash, setSaveFlash] = useState(null);
  // "Start a new design" — the current one is safe: save it to the shelf first
  // if you want it, and either way Ctrl+Z brings it right back.
  const startFresh = () => {
    if (!window.confirm('Start a new design?\n\nTip: click “Save this design” first if you want to keep this one. (You can also press Ctrl+Z to bring it back.)')) return;
    try { localStorage.removeItem(STORE_KEY); } catch { /* fine */ }
    commitSpec(structuredClone(seedSpec)); // undoable — Ctrl+Z brings the design back
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

  // Keyboard: undo/redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z), cut/copy/paste
  // (Ctrl+X/C/V) of the selected object, and Delete/Backspace to remove it.
  // NEVER hijack while typing in a field or with text highlighted — the field's
  // own undo and the browser's own copy/paste must keep working there.
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const hasTextSel = String(window.getSelection?.() || '').length > 0;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z' && !e.shiftKey) { if (typing) return; e.preventDefault(); undo(); return; }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { if (typing) return; e.preventDefault(); redo(); return; }

      if (typing || hasTextSel || timelineOpen) return;

      if (mod && key === 'c') { if (selectedId) { e.preventDefault(); copySelection(); } return; }
      if (mod && key === 'x') { if (selectedId) { e.preventDefault(); cutSelection(); } return; }
      if (mod && key === 'v') { if (clipboard) { e.preventDefault(); pasteClipboard(); } return; }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const obj = spec.rooms.find((r) => r.id === selectedId) || (spec.elements || []).find((el) => el.id === selectedId);
        if (!obj) return;
        e.preventDefault();
        removeObject(obj);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // --- structure: whole-house wall system + frame ----------------------------
  // ONE dispatch for all four sides — four separate calls would race on the
  // same base spec and only the last would land (a bug this app has had).
  const setAllWalls = (value) => applyOps(WALL_SIDES.map((side) => ({ type: 'set_wall_side', wall: side, field: 'assembly', value })));
  const setFrame = (value) => applyOps([{ type: 'set_frame', value }]);
  const setWallSide = (side, field, value) => applyOps([{ type: 'set_wall_side', wall: side, field, value }]);
  // --- finishes: floor, exterior cladding, reclaimed materials ---------------
  const setFlooring = (value) => applyOps([{ type: 'set_flooring', value }]);
  const setSubfloor = (value) => applyOps([{ type: 'set_flooring', field: 'subfloor', value }]);
  const setAllCladding = (value) => applyOps(WALL_SIDES.map((side) => ({ type: 'set_wall_side', wall: side, field: 'cladding', value })));
  const setReclaimed = (system, on) => applyOps([{ type: 'set_reclaimed', system, value: on }]);

  // --- roof: shape, pitch, insulation, overhang, shed direction --------------
  const setRoofType = (value) => {
    // Switching TO a shed with level eaves needs a fall or it won't drain — so
    // set up a high-south / low-north profile (the solar classic) in one go.
    if (value === 'shed') {
      const wh = Number(spec.shell.wallHeightFt) || 10;
      const sH = Number(spec.shell.southWallHeightFt) || wh;
      const nH = Number(spec.shell.northWallHeightFt) || wh;
      if (Math.abs(sH - nH) < 0.5) {
        applyOps([{ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: Math.max(7, wh + 2), northWallHeightFt: Math.max(2, wh) }]);
        return;
      }
    }
    applyOps([{ type: 'set_shell', field: 'roofType', value }]);
  };
  const setRoofPitch = (value) => applyOps([{ type: 'set_shell', field: 'roofPitch', value: String(value) }]);
  const setRoofInsulation = (value) => applyOps([{ type: 'set_utility', field: 'roofInsulation', value }]);
  const setOverhang = (wall, value) => applyOps([{ type: 'set_overhang', wall, value: String(clamp(Number(value) || 0, 0, 12)) }]);
  const setShedFall = (drainTo, fallFt) => {
    const wh = Number(spec.shell.wallHeightFt) || 10;
    const hi = Math.max(7, Number(spec.shell.southWallHeightFt) || wh, Number(spec.shell.northWallHeightFt) || wh);
    const lo = Math.max(2, hi - Math.max(0.5, Number(fallFt) || 2));
    applyOps([{ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: drainTo === 'north' ? hi : lo, northWallHeightFt: drainTo === 'north' ? lo : hi }]);
  };
  const setGutters = (value) => applyOps([{ type: 'set_shell', field: 'gutters', value }]);
  const setDischarge = (value) => applyOps([{ type: 'set_shell', field: 'discharge', value }]);

  // switching chapters nudges you to the view that chapter is best done in
  const goChapter = (c) => { setActiveChapter(c.id); if (c.view) setViewMode(c.view === 'plan' ? 'plan' : '3d'); };

  // In the Shape chapter, if a room/element is the shape target, the plan lets
  // you see and drag it (rooms context); otherwise it edits the building
  // footprint (shell context).
  const targetIsObject = selectedId && (spec.rooms.some((r) => r.id === selectedId) || (spec.elements || []).some((e) => e.id === selectedId));
  const planContext = activeChapter === 'shape' && targetIsObject ? 'rooms' : (chapter.planContext || null);

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
            context={planContext}
            onContext={timelineOpen ? null : openContext}
            activeFloor={activeChapter === 'rooms' || activeChapter === 'openings' ? activeFloor : 1}
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
            showCompass
            onFallbackNav={() => {}}
          />
        )}
        {/* compass — always know which way you're looking; north tracks the
            camera so the south face (the solar face) is never a guess */}
        {viewMode === '3d' && !timelineOpen && <Compass heading={heading} />}
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


      {/* undo / redo — top-left, always available (Ctrl+Z / Ctrl+Y) */}
      {!timelineOpen && (
        <div className="rz-history">
          <button disabled={!undoStack.length} title="Undo (Ctrl+Z)" onClick={undo}>↶</button>
          <button disabled={!redoStack.length} title="Redo (Ctrl+Y)" onClick={redo}>↷</button>
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
      <aside className="rz-trail">
          <div className="rz-trail-body">
            <nav className="rz-chapters rz-chapters-top">
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
            {activeChapter === 'shape' && (
              <ShapeControls
                spec={spec}
                floors={floors}
                onShapeBuilding={setShape}
                onSizeBuilding={resizeShell}
                onAddFloor={addFloor}
                onRemoveFloor={removeFloor}
                onResizeFloor={resizeFloor}
                onFloorHeight={setFloorHeight}
              />
            )}
            {activeChapter === 'rooms' && (
              <div className="rz-found">
                {floors > 1 && (
                  <FloorBar spec={spec} floors={floors} activeFloor={activeFloor} hasBasement={hasBasement} onSelect={setActiveFloor} onAdd={addFloor} onRemove={removeFloor} />
                )}
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
            {activeChapter === 'openings' && (
              <>
                {floors > 1 && (
                  <FloorBar spec={spec} floors={floors} activeFloor={activeFloor} hasBasement={hasBasement} onSelect={setActiveFloor} onAdd={addFloor} onRemove={removeFloor} />
                )}
                <OpeningsControls
                  spec={spec}
                  selectedId={selectedId}
                  level={activeFloor}
                  onAdd={addOpening}
                  onAddDormer={addDormer}
                  onRemove={removeOpening}
                  onSize={sizeOpening}
                  onSetField={setOpeningField}
                  onSelect={(index) => setSelectedId(`opening-${index}`)}
                />
              </>
            )}
            {activeChapter === 'systems' && (
              <SystemsControls spec={spec} derived={derived} onUtility={setUtilityField} />
            )}
            {activeChapter === 'finishes' && (
              <FinishesControls
                spec={spec}
                derived={derived}
                onFlooring={setFlooring}
                onSubfloor={setSubfloor}
                onCladding={setAllCladding}
                onReclaimed={setReclaimed}
              />
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
                onPlaceOutdoorPad={placeOutdoorPad}
                onSizeRun={sizeRun}
                onRemoveRun={removeElement}
                onSelectRun={setSelectedId}
              />
            )}
            {activeChapter === 'shell' && (
              <StructureControls
                spec={spec}
                floors={floors}
                onAllWalls={setAllWalls}
                onFrame={setFrame}
                onShell={setShellField}
                onWallSide={setWallSide}
                onSelectWall={(side) => { setSelectedId(`wall-${side}`); setViewMode('3d'); }}
                onAddFloor={addFloor}
                onRemoveFloor={removeFloor}
                onLayoutFloors={() => { setActiveChapter('rooms'); setViewMode('plan'); }}
              />
            )}
            {activeChapter === 'roof' && (
              <RoofControls
                spec={spec}
                derived={derived}
                onRoofType={setRoofType}
                onPitch={setRoofPitch}
                onInsulation={setRoofInsulation}
                onOverhang={setOverhang}
                onShedFall={setShedFall}
                onGutters={setGutters}
                onDischarge={setDischarge}
              />
            )}
            <button className="rz-build-btn" onClick={timelineOpen ? closeTimeline : openTimeline}>
              {timelineOpen ? '× Back to designing' : '▶ Watch it build'}
            </button>

            {/* Saved designs — keep the current model even when starting new */}
            <div className="rz-designs">
              <div className="rz-designs-bar">
                <button className="rz-designs-toggle" onClick={() => setDesignsOpen((v) => !v)} title="Your saved designs">
                  {designsOpen ? '▾' : '▸'} My designs{designs.length ? ` (${designs.length})` : ''}
                </button>
                <button className="rz-designs-new" title="Start a brand-new design (your current one is safe — save it first or press Ctrl+Z)" onClick={startFresh}>+ New</button>
              </div>
              {designsOpen && (
                <div className="rz-designs-panel">
                  <button className="rz-designs-save" onClick={handleSaveDesign}>💾 Save this design</button>
                  {saveFlash && <div className="rz-designs-flash">Saved “{saveFlash}” — it’s on the shelf below.</div>}
                  {designs.length === 0
                    ? <div className="rz-shape-note">Nothing saved yet. “Save this design” keeps a copy here, so you can start a new one and come back to this whenever you like.</div>
                    : designs.map((d) => (
                      <div key={d.id} className="rz-designs-item">
                        <button className="rz-designs-open" title="Open this design" onClick={() => openDesign(d.id)}>
                          <b>{d.name}</b>
                          <small>{new Date(d.savedAt).toLocaleDateString()}</small>
                        </button>
                        <button className="rz-designs-del" title="Delete this saved design" onClick={() => deleteDesign(d.id)}>×</button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="rz-stamp">{UPDATE_STAMP}</div>
          </div>
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
          onResize={(w, d) => resizeObject(selectedRoom.id, Number(selectedRoom.x) || 0, Number(selectedRoom.y) || 0, w, d)}
          onRemove={() => removeObject(selectedRoom)}
          onClose={() => setSelectedId(null)}
        />
      )}
      {selectedId && !selectedRoom && (() => {
        const wallSide = WALL_SIDES.find((side) => selectedId === `wall-${side}`);
        if (wallSide) {
          return <WallCard side={wallSide} spec={spec} onWallSide={setWallSide} onClose={() => setSelectedId(null)} />;
        }
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

function RoomCard({ room, derived, onRename, onResize, onRemove, onClose }) {
  const [expanded, setExpanded] = useState(false);
  const w = Math.round((Number(room.w) || 0) * 10) / 10;
  const d = Math.round((Number(room.d) || 0) * 10) / 10;
  const area = Math.round((Number(room.w) || 0) * (Number(room.d) || 0));
  const sharePct = derived.floor > 0 ? Math.round((area / derived.floor) * 100) : 0;
  return (
    <div className="rz-card">
      <div className="rz-card-head">
        <NameField value={room.name} onCommit={onRename} />
        <button className="rz-x" onClick={onClose}>×</button>
      </div>

      {/* size it right here — the number way; or drag a corner on the plan */}
      <div className="rz-run-size rz-card-size">
        <label>Width<NumInput value={w} min={2} max={96} step={0.5} unit="" onCommit={(v) => onResize(v, d)} /></label>
        <span className="rz-run-x">×</span>
        <label>Depth<NumInput value={d} min={2} max={80} step={0.5} unit="ft" onCommit={(v) => onResize(w, v)} /></label>
        <span className="rz-run-area">{fmtNum(area)} sf</span>
      </div>

      <div className="rz-vitals">
        <Vital label="Use" value={TYPE_LABEL[room.type] || room.type || '—'} />
        <Vital label="Area" value={`${fmtNum(area)} sq ft`} />
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
// The Shape controls, target-selectable. Pick WHAT you're shaping — the whole
// building or any single room/element — from the dropdown. The building gets
// the outline presets (Rectangle / L / T / U) and its size; a room or element
// gets its own width × depth. One general control instead of building-only.
function ShapeControls({ spec, floors, onShapeBuilding, onSizeBuilding, onAddFloor, onRemoveFloor, onResizeFloor, onFloorHeight }) {
  const isRect = !spec.shell.footprint;
  const corners = Array.isArray(spec.shell.footprint) ? spec.shell.footprint.length : 4;
  const bW = Math.round((Number(spec.shell.widthFt) || 36) * 10) / 10;
  const bD = Math.round((Number(spec.shell.depthFt) || 28) * 10) / 10;
  return (
    <div className="rz-shape">
      <div className="rz-found-head">Outline</div>
      <div className="rz-shape-presets">
        {[['rect', 'Rectangle'], ['l', 'L'], ['t', 'T'], ['u', 'U']].map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className={kind === 'rect' && isRect ? 'on' : ''}
            onClick={() => onShapeBuilding(kind)}
            title={kind === 'rect' ? 'Plain rectangle' : `${label}-shaped outline — a starting point you can drag`}
          >{label}</button>
        ))}
      </div>
      {!isRect && <div className="rz-shape-note">custom outline · {corners} corners — drag any edge on the plan</div>}

      {/* Every floor — ground included — sizes the same way in the Floors list
          below (the ground floor's width & depth ARE the building footprint). */}
      <StoreysControl spec={spec} floors={floors} onAddFloor={onAddFloor} onRemoveFloor={onRemoveFloor} onResizeFloor={onResizeFloor} onFloorHeight={onFloorHeight} />

      <div className="rz-shape-note">To size one room, tap it in the Rooms chapter. To size an element, tap it or use its own chapter.</div>
    </div>
  );
}

// Floor selector — lives INSIDE the left bar (at the top of the Rooms and
// Openings chapters), so the wide bar never covers it. Pick a floor to lay it
// out; add or remove the top one right here.
function FloorBar({ spec, floors, activeFloor, hasBasement, onSelect, onAdd, onRemove }) {
  return (
    <div className="rz-floorbar">
      <span className="rz-floorbar-lead">Floor</span>
      <div className="rz-floorbar-btns">
        {hasBasement && (
          <button type="button" className={activeFloor === BASEMENT_LEVEL ? 'on' : ''} onClick={() => onSelect(BASEMENT_LEVEL)}>Basement</button>
        )}
        {Array.from({ length: floors }, (_, i) => i + 1).map((f) => (
          <button type="button" key={f} className={activeFloor === f ? 'on' : ''} onClick={() => onSelect(f)}>{floorLabel(spec, f)}</button>
        ))}
        {floors < 3 && (
          <button type="button" className="rz-floorbar-add" title="Add a floor on top" onClick={onAdd}>+ floor</button>
        )}
        {floors > 1 && activeFloor === floors && activeFloor !== BASEMENT_LEVEL && (
          <button type="button" className="rz-floorbar-del" title="Remove this floor — its rooms come down a floor" onClick={onRemove}>− floor</button>
        )}
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

// Storeys — how the building STACKS, shown in the Shape chapter next to the
// footprint. Add/remove a storey, and give each upper storey its own extent
// (it can set back, smaller than the floor below) and the shared upper-floor
// height. Sizing is by the numbers here, on purpose: the plan stays free for
// laying out rooms (the extent plate is a non-interactive outline there), so
// storey-sizing and room-work never fight over the same drag.
function StoreysControl({ spec, floors, onAddFloor, onRemoveFloor, onResizeFloor, onFloorHeight }) {
  const uppers = [];
  for (let lvl = 2; lvl <= floors; lvl += 1) uppers.push(lvl);
  // ground floor W×D is the building footprint (resizeFloor(1) → resizeShell)
  const gW = Math.round((Number(spec.shell.widthFt) || 36) * 10) / 10;
  const gD = Math.round((Number(spec.shell.depthFt) || 28) * 10) / 10;
  const gH = Math.round(storeyHeightFt(spec.shell, 1) * 10) / 10;
  return (
    <div className="rz-storeys-block">
      <div className="rz-found-head" style={{ marginTop: 10 }}>Floors</div>
      <div className="rz-field">
        <div className="rz-storeys">
          <button type="button" disabled={floors <= 1} onClick={onRemoveFloor} title="Remove the top floor — its rooms come down a floor">−</button>
          <b>{floors} floor{floors === 1 ? '' : 's'}</b>
          <button type="button" disabled={floors >= 3} onClick={onAddFloor} title="Add a floor on top">+</button>
        </div>
      </div>
      {/* Ground floor — the same width / depth / height row as every other
          floor (its W×D is the building footprint). */}
      <div className="rz-storey-row">
        <span className="rz-storey-name">Ground</span>
        <div className="rz-run-size">
          <label>W<NumInput value={gW} min={12} max={96} step={0.5} unit="" onCommit={(v) => onResizeFloor(1, v, gD)} /></label>
          <span className="rz-run-x">×</span>
          <label>D<NumInput value={gD} min={12} max={80} step={0.5} unit="" onCommit={(v) => onResizeFloor(1, gW, v)} /></label>
          <label className="rz-storey-h">H<NumInput value={gH} min={7} max={16} step={0.5} unit="ft" onCommit={(v) => onFloorHeight(1, v)} /></label>
        </div>
      </div>
      {uppers.map((lvl) => {
        const plate = (spec.elements || []).find((e) => e.category === 'floor' && Number(e.level || 1) === lvl);
        const w = Math.round((Number(plate?.w) || Number(spec.shell.widthFt)) * 10) / 10;
        const d = Math.round((Number(plate?.d) || Number(spec.shell.depthFt)) * 10) / 10;
        const h = Math.round(storeyHeightFt(spec.shell, lvl) * 10) / 10;
        return (
          <div key={lvl} className="rz-storey-row">
            <span className="rz-storey-name">{floorLabel(spec, lvl)}</span>
            <div className="rz-run-size">
              <label>W<NumInput value={w} min={8} max={96} step={0.5} unit="" onCommit={(v) => onResizeFloor(lvl, v, d)} /></label>
              <span className="rz-run-x">×</span>
              <label>D<NumInput value={d} min={8} max={80} step={0.5} unit="" onCommit={(v) => onResizeFloor(lvl, w, v)} /></label>
              <label className="rz-storey-h">H<NumInput value={h} min={7} max={16} step={0.5} unit="ft" onCommit={(v) => onFloorHeight(lvl, v)} /></label>
            </div>
          </div>
        );
      })}
      <div className="rz-shape-note">
        {floors > 1
          ? 'Each floor has its own width, depth, and height — an upper storey can set back and the roof steps down over the rest. Or open a floor in Rooms and drag its outline to move it.'
          : 'Add a floor and it gets its own outline and height; set it back from the ground floor here, or drag it on the plan in Rooms.'}
      </div>
    </div>
  );
}

// Openings chapter: drop doors and windows on a wall, then slide them on the
// plan. Every opening type the engine knows is one tap; skylights land on the
// roof. Openings carry the floor picked in the Floor selector — a 2nd-floor
// window goes in the upper wall, and a dormer opens the roof to meet it.
const OPENING_GROUPS = [
  { head: 'Windows', keys: ['window', 'picture', 'awning', 'clerestory', 'bay', 'raked', 'tilted'] },
  { head: 'Doors', keys: ['door', 'french', 'slider', 'dutch', 'barn'] },
  { head: 'Roof', keys: ['skylight'] }
];
const DORMER_STYLES = [['gable', 'Gable dormer', 'peaked doghouse'], ['shed', 'Shed dormer', 'single slope']];
function OpeningsControls({ spec, selectedId, level = 1, onAdd, onAddDormer, onRemove, onSize, onSetField, onSelect }) {
  const [wall, setWall] = useState('south');
  const openings = spec.openings || [];
  const onThisFloor = (o) => o.wall === 'roof' ? level === 1 : Number(o.level || 1) === level;
  const floorWord = level === 1 ? 'ground floor' : floorLabel(spec, level).toLowerCase();
  return (
    <div className="rz-found">
      {level > 1 && <div className="rz-shape-note" style={{ marginBottom: 6 }}>Placing on the <b>{floorWord}</b> — switch floors with the Floor selector (top left). A window here goes in the upper wall; if the roof covers that wall it opens a dormer to meet it.</div>}
      <label className="rz-field">
        <span>Add to which wall</span>
        <select value={wall} onChange={(e) => setWall(e.target.value)}>
          {WALL_SIDES.map((side) => <option key={side} value={side}>{WALL_SIDE_LABELS[side]}{side === 'south' ? ' — the sunny face' : ''}</option>)}
        </select>
      </label>
      {OPENING_GROUPS.map((group) => (
        <div key={group.head} className="rz-open-group">
          <div className="rz-found-head">{group.head}</div>
          <div className="rz-found-palette rz-open-palette">
            {group.keys.map((key) => (
              <button key={key} type="button" title={`${OPENING_TYPES[key].defaultW}′ to start — drag it along the wall after`} onClick={() => onAdd(wall, key, level)}>
                <b>{OPENING_TYPES[key].label}</b>
                <small>{group.head === 'Roof' ? 'on the roof' : `${WALL_SIDE_LABELS[wall].toLowerCase()} wall · ${floorWord}`}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
      {level > 1 && (
        <div className="rz-open-group">
          <div className="rz-found-head">Dormers</div>
          <div className="rz-found-palette rz-open-palette">
            {DORMER_STYLES.map(([style, lab, note]) => (
              <button key={style} type="button" title={`A ${style} dormer with a window, on the ${WALL_SIDE_LABELS[wall].toLowerCase()} wall`} onClick={() => onAddDormer(wall, style, level)}>
                <b>{lab}</b>
                <small>{note} · {floorWord}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {openings.some(onThisFloor) && (
        <div className="rz-open-list">
          <div className="rz-found-head">On the {floorWord}</div>
          {openings.map((o, i) => ({ o, i })).filter(({ o }) => onThisFloor(o)).map(({ o, i }) => {
            const prof = OPENING_TYPES[o.type] || OPENING_TYPES.window;
            const sel = String(selectedId || '') === `opening-${i}`;
            const isUpperWall = o.wall !== 'roof' && Number(o.level || 1) > 1;
            return (
              <div key={i}>
                <div className={`rz-run-row${sel ? ' on' : ''}`}>
                  <button type="button" className="rz-run-name" onClick={() => onSelect(sel ? -1 : i)}>
                    {o.label || prof.label} <small>{o.wall}</small>
                  </button>
                  <label className="rz-field rz-field-num rz-run-size">
                    <NumInput value={Math.round((Number(o.widthFt) || prof.defaultW) * 10) / 10} min={1} max={24} step={0.5} unit="" onCommit={(v) => onSize(i, v)} />
                  </label>
                  <button type="button" className="rz-remove" title="Remove this opening" onClick={() => onRemove(i)}>✕</button>
                </div>
                {sel && o.wall !== 'roof' && (
                  <div className="rz-open-detail">
                    <label className="rz-field rz-field-num">
                      <span>Shade eyebrow (overhang)</span>
                      <NumInput value={Number(o.shadeFt) || 0} min={0} max={6} step={0.5} unit="ft" onCommit={(v) => onSetField(i, 'shadeFt', v)} />
                    </label>
                    {isUpperWall && (
                      <label className="rz-field">
                        <span>Dormer</span>
                        <select value={o.dormerStyle || ''} onChange={(e) => onSetField(i, 'dormerStyle', e.target.value)}>
                          <option value="">Auto — only if the roof buries it</option>
                          <option value="gable">Gable dormer (peaked)</option>
                          <option value="shed">Shed dormer (single slope)</option>
                        </select>
                      </label>
                    )}
                    {(o.type === 'tilted' || Number(o.tiltDeg) > 0) && (
                      <label className="rz-field rz-field-num">
                        <span>Glass tilt</span>
                        <NumInput value={Number(o.tiltDeg) || 25} min={5} max={60} step={5} unit="°" onCommit={(v) => onSetField(i, 'tiltDeg', v)} />
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="rz-shape-note">Tap an opening to size it, add a shade eyebrow, or turn it into a dormer. Slide it along its wall by dragging on the plan.</div>
    </div>
  );
}

// Systems chapter: the working parts — water, waste, power, heat. Plain choices
// that drive the receipts and the council checks; DIY toggles turn labor into
// sweat equity. (Mirrors the classic app's system pages, one dispatch each.)
function SystemsControls({ spec, derived, onUtility }) {
  const u = utilitiesOf(spec);
  const gpd = Math.round(Number(derived?.septicGpd) || 0);
  return (
    <div className="rz-found">
      <label className="rz-field">
        <span>Water — where it comes from</span>
        <select value={u.waterSource} onChange={(e) => onUtility('waterSource', e.target.value)}>
          <option value="well">Drilled well — reliable, needs a pump</option>
          <option value="spring">Spring — cheap if the land has one</option>
          <option value="catchment">🌿 Rain catchment — roof + rain</option>
          <option value="town">Town main — simplest</option>
        </select>
      </label>
      <label className="rz-field rz-field-num">
        <span>Storage tank</span>
        <NumInput value={Number(u.tankGal) || 0} min={0} max={50000} step={100} unit="gal" onCommit={(v) => onUtility('tankGal', v)} />
      </label>

      <label className="rz-field">
        <span>Waste — where used water goes</span>
        <select value={u.wasteMethod} onChange={(e) => onUtility('wasteMethod', e.target.value)}>
          <option value="septic">Septic + leach field — conventional</option>
          <option value="composting">🌿 Composting toilet + greywater</option>
          <option value="reedbed">Reed bed / constructed wetland</option>
        </select>
      </label>
      {u.wasteMethod === 'septic' && (
        <label className="rz-field rz-field-num">
          <span>Well → septic</span>
          <NumInput value={Number(u.wellSepticFt) || 120} min={0} max={2000} step={5} unit="ft" onCommit={(v) => onUtility('wellSepticFt', v)} />
        </label>
      )}

      <label className="rz-field">
        <span>Power — where electricity comes from</span>
        <select value={u.powerMode} onChange={(e) => onUtility('powerMode', e.target.value)}>
          <option value="offgrid">Off-grid — panels + battery, independent</option>
          <option value="hybrid">Grid + solar — panels, grid as backup</option>
          <option value="gridtie">Grid only — simplest, no battery</option>
        </select>
      </label>

      <label className="rz-field">
        <span>Heat — how you stay warm</span>
        <select value={u.heatSource} onChange={(e) => onUtility('heatSource', e.target.value)}>
          <option value="rocket_mass">🌿 Rocket mass heater — wood, very DIY</option>
          <option value="masonry">Masonry heater — wood, slow radiant</option>
          <option value="wood_stove">Wood stove — simple, familiar</option>
          <option value="minisplit">Electric mini-split — no wood, draws power</option>
        </select>
      </label>
      <label className="rz-nowall">
        <input type="checkbox" checked={Boolean(u.diyHeat)} onChange={(e) => onUtility('diyHeat', e.target.checked)} />
        <span>I'll build the heater myself (sweat equity)</span>
      </label>
      <div className="rz-shape-note">Design flow ≈ {gpd} gal/day. A septic field must sit at least 100 ft from a well; composting sidesteps most of that. Each choice updates the receipts.</div>
    </div>
  );
}

// Finishes chapter: the surfaces you touch and see — the floor underfoot, the
// cladding the weather hits, and whether the materials are new or salvaged.
// Whole-house choices here; a single wall's face is tuned in Shell (wall by
// wall) and a single room's floor by tapping it. Every pick moves the receipts.
const RECLAIMED_ITEMS = [
  { key: 'frame', label: 'Timber frame', note: 'salvaged beams & posts' },
  { key: 'walls', label: 'Wall materials', note: 'reclaimed cladding / infill' },
  { key: 'windows', label: 'Windows & doors', note: 'salvaged units' },
  { key: 'roof', label: 'Roofing', note: 'reclaimed metal / tile' }
];
function FinishesControls({ spec, derived, onFlooring, onSubfloor, onCladding, onReclaimed }) {
  const flooringKey = resolveFlooring(spec);
  const subfloorKey = resolveSubfloor(spec);
  const claddingKey = spec.walls?.south?.cladding || 'render';
  const reclaimed = { ...RECLAIMED_DEFAULTS, ...(spec.reclaimed || {}) };
  const claddingVals = WALL_SIDES.map((side) => spec.walls?.[side]?.cladding || 'render');
  const claddingMixed = new Set(claddingVals).size > 1;
  return (
    <div className="rz-found">
      <div className="rz-found-head">The floor underfoot</div>
      <label className="rz-field">
        <span>Finished floor</span>
        <select value={flooringKey} onChange={(e) => onFlooring(e.target.value)}>
          {Object.entries(FLOORING_TYPES).map(([key, f]) => (
            <option key={key} value={key}>{f.green ? '🌿 ' : ''}{f.label}</option>
          ))}
        </select>
      </label>
      <label className="rz-field">
        <span>Deck under it</span>
        <select value={subfloorKey} onChange={(e) => onSubfloor(e.target.value)}>
          {Object.entries(SUBFLOOR_TYPES).map(([key, s]) => (
            <option key={key} value={key}>{s.label}</option>
          ))}
        </select>
      </label>
      <label className="rz-nowall">
        <input type="checkbox" checked={Boolean(reclaimed.flooring)} onChange={(e) => onReclaimed('flooring', e.target.checked)} />
        <span>Reclaimed / salvaged floor (cuts cost &amp; carbon)</span>
      </label>
      <div className="rz-shape-note">{FLOORING_TYPES[flooringKey]?.note} Covers the {fmtNum(derived?.heatedFloor || 0)} sf heated floor — {fmtMoney(derived?.cost?.flooring || 0)} for deck + finish. A single room can differ (tap its floor).</div>

      <div className="rz-found-head" style={{ marginTop: 12 }}>What the weather hits — cladding</div>
      <label className="rz-field">
        <span>Exterior cladding (all walls)</span>
        <select value={claddingMixed ? '' : claddingKey} onChange={(e) => onCladding(e.target.value)}>
          {claddingMixed && <option value="">— mixed, pick to set all —</option>}
          {Object.values(CLADDING_TYPES).map((c) => (
            <option key={c.key} value={c.key}>{c.green ? '🌿 ' : ''}{c.label}</option>
          ))}
        </select>
      </label>
      <div className="rz-shape-note">Sets every wall's outer face at once. To give one wall its own look, tap it in the Shell chapter (wall by wall).</div>

      <div className="rz-found-head" style={{ marginTop: 12 }}>New or salvaged</div>
      {RECLAIMED_ITEMS.map((item) => (
        <label key={item.key} className="rz-nowall">
          <input type="checkbox" checked={Boolean(reclaimed[item.key])} onChange={(e) => onReclaimed(item.key, e.target.checked)} />
          <span>{item.label} — reclaimed <small style={{ color: 'var(--moss, #868a7c)' }}>({item.note})</small></span>
        </label>
      ))}
      <div className="rz-shape-note">Salvaged materials lean the budget and the carbon down — the receipts and the footprint follow each toggle.</div>
    </div>
  );
}

// Foundation chapter: the main type the house sits on, plus footing runs that
// live on their own layout — under a heavy interior wall, a porch, a future
// addition, inside or outside the rooms.
// Outdoor slab pads — a separate foundation under a space that isn't the house.
const OUTDOOR_PADS = [
  { name: 'Carport pad', w: 20, d: 12 },
  { name: 'Patio pad', w: 14, d: 12 },
  { name: 'Porch pad', w: 16, d: 8 },
  { name: 'Walkway', w: 3, d: 20 }
];
function FoundationControls({ spec, selectedId, onChoose, onUtility, onShell, onPlaceRun, onPlacePad, onPlaceOutdoorPad, onSizeRun, onRemoveRun, onSelectRun }) {
  const u = utilitiesOf(spec);
  const basement = basementInfo(spec.shell);
  const typeVal = basement.present ? 'basement' : u.foundationType;
  const runs = (spec.elements || []).filter((el) => el.category === 'foundation');
  const isPad = (el) => Boolean(FOUNDATION_RUN_TYPES[el.construction]?.perSf);
  const runCost = (el) => {
    const t = FOUNDATION_RUN_TYPES[el.construction] || FOUNDATION_RUN_TYPES.rubble;
    if (t.perSf) return Math.round((Number(el.w) * Number(el.d) || 0) * t.costSf);
    const lf = Math.max(Number(el.w) || 0, Number(el.d) || 0);
    return Math.round(lf * (t.costLf + t.stemCostLfFt * (Number(el.h) || 0)));
  };
  // Set a strip run's LENGTH along its long axis, keeping its thin side.
  const setRunLength = (el, len) => {
    const alongW = (Number(el.w) || 0) >= (Number(el.d) || 0);
    onSizeRun(el, alongW ? len : Number(el.w), alongW ? Number(el.d) : len);
  };
  const runLength = (el) => Math.round(Math.max(Number(el.w) || 0, Number(el.d) || 0) * 10) / 10;
  return (
    <div className="rz-found">
      <label className="rz-field">
        <span>Main foundation (under the house)</span>
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

      <div className="rz-found-head">Pads for outside spaces</div>
      <div className="rz-found-palette">
        {OUTDOOR_PADS.map((pad) => (
          <button key={pad.name} type="button" title={`A ${pad.w}×${pad.d} ft slab pad — resize it below or on the plan`} onClick={() => onPlaceOutdoorPad(pad)}>
            <b>{pad.name}</b>
            <small>{pad.w} × {pad.d} ft · ${FOUNDATION_RUN_TYPES.slabpad.costSf}/sf</small>
          </button>
        ))}
      </div>
      <button type="button" className="rz-pad-btn" title={FOUNDATION_RUN_TYPES.slabpad.note} onClick={onPlacePad}>
        <b>Slab — one shape, any size</b>
        <small>drops 2 ft bigger than the house{typeVal === 'slab' ? ' · becomes THE slab' : ''}</small>
      </button>

      <div className="rz-found-head">Footings under specific walls</div>
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
            <div key={el.id} className={`rz-found-run ${selectedId === el.id ? 'sel' : ''}`}>
              <div className="rz-found-run-top">
                <button type="button" className="rz-found-pick" onClick={() => onSelectRun(el.id)}>
                  {el.name}<small>{fmtMoney(runCost(el))}{isPad(el) && typeVal === 'slab' ? ' — this IS the slab' : ''}</small>
                </button>
                <button type="button" className="rz-x" title="Remove this" onClick={() => onRemoveRun(el)}>×</button>
              </div>
              {isPad(el) ? (
                <div className="rz-run-size">
                  <label>W<NumInput value={Math.round(Number(el.w) * 10) / 10} min={2} max={120} step={0.5} unit="ft" onCommit={(v) => onSizeRun(el, v, Number(el.d))} /></label>
                  <span className="rz-run-x">×</span>
                  <label>D<NumInput value={Math.round(Number(el.d) * 10) / 10} min={2} max={120} step={0.5} unit="ft" onCommit={(v) => onSizeRun(el, Number(el.w), v)} /></label>
                  <span className="rz-run-area">{Math.round(Number(el.w) * Number(el.d))} sf</span>
                </div>
              ) : (
                <div className="rz-run-size">
                  <label>Total length<NumInput value={runLength(el)} min={1} max={200} step={0.5} unit="ft" onCommit={(v) => setRunLength(el, v)} /></label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="rz-shape-note">Set the size right here, or drag and stretch each pad/run on the plan. Footings price by the foot; pads by the square foot; with a slab main foundation, a pad over the house becomes the slab (priced once).</div>
    </div>
  );
}

// Shell chapter: the structure in three plain choices — what the walls are,
// what carries the roof, how tall the walls run. The timeline's build order
// and every receipt follow these.
function StructureControls({ spec, floors, onAllWalls, onFrame, onShell, onWallSide, onSelectWall, onAddFloor, onRemoveFloor, onLayoutFloors }) {
  const resolved = WALL_SIDES.map((side) => resolveWallSide(spec, side));
  const wallKeys = new Set(resolved.map((r) => r.assemblyKey));
  const wallVal = wallKeys.size === 1 ? [...wallKeys][0] : '__mixed';
  const frameVal = resolveFrameType(spec, 1);
  const heights = new Set(resolved.map((r) => Math.round(r.heightFt * 10)));
  const shed = (spec.shell.roofType || 'gable') === 'shed';
  return (
    <div className="rz-found">
      <div className="rz-shape-note" style={{ marginTop: 0 }}>
        {floors > 1 ? `${floors} storeys` : 'One storey'} — storeys, their setbacks, and heights live in the <b>Shape</b> chapter. This page is the walls, frame, and roof structure.
      </div>

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
        <span>Frame — what holds the roof up</span>
        <select value={frameVal} onChange={(e) => onFrame(e.target.value)}>
          {Object.entries(FRAME_TYPES).map(([key, f]) => (
            <option key={key} value={key}>{f.green ? '🌿 ' : ''}{f.label}</option>
          ))}
        </select>
      </label>
      <div className="rz-shape-note">
        {frameVal === 'load-bearing'
          ? 'Load-bearing: the walls themselves hold up the roof — no separate posts. The usual choice for straw bale, cob, and cordwood.'
          : `${FRAME_TYPES[frameVal]?.note || ''} The timber posts and beams stand inside the walls, which wrap around them.`}
      </div>
      <label className="rz-field rz-field-num">
        <span>Wall height (all){heights.size > 1 ? ' · sides differ' : ''}</span>
        <NumInput value={Number(spec.shell.wallHeightFt) || 10} min={7} max={40} step={0.5} onCommit={(v) => onShell('wallHeightFt', v)} />
      </label>
      {/* not all walls are the same height: a 2-ft greenhouse kneewall on the
          south, a tall north wall a shed falls from — each side has its own */}
      <details className="rz-perwall">
        <summary>Wall by wall — height &amp; construction ▸</summary>
        {WALL_SIDES.map((side, i) => (
          <div key={side} className="rz-perwall-row">
            <button type="button" className="rz-perwall-name" title="See this wall in 3D" onClick={() => onSelectWall(side)}>
              {side[0].toUpperCase() + side.slice(1)}
            </button>
            <select
              className="rz-perwall-sys"
              title={`What the ${side} wall is built of`}
              value={resolved[i].assemblyKey}
              onChange={(e) => onWallSide(side, 'assembly', e.target.value)}
            >
              {Object.values(WALL_ASSEMBLIES).map((a) => (
                <option key={a.key} value={a.key}>{a.green ? '🌿 ' : ''}{a.label}</option>
              ))}
            </select>
            <NumInput value={Math.round(resolved[i].heightFt * 10) / 10} min={2} max={40} step={0.5} onCommit={(v) => onWallSide(side, 'heightFt', v)} />
          </div>
        ))}
        <div className="rz-shape-note">
          {shed ? 'On a shed roof the south and north heights set which way it falls.' : 'Down to a 2 ft kneewall.'} Setting the all-walls choices above puts every side back in step. Tap a wall in 3D for its full card.
        </div>
      </details>
      <div className="rz-shape-note">Whole-house choices — with load-bearing walls the timeline walls first, then roofs; with a frame it roofs before straw walls go in. Or tap any wall in 3D to set just that one.</div>
    </div>
  );
}

// Tap a wall in 3D → its own card: THIS wall's height and system.
function WallCard({ side, spec, onWallSide, onClose }) {
  const r = resolveWallSide(spec, side);
  const label = side[0].toUpperCase() + side.slice(1);
  return (
    <div className="rz-card">
      <div className="rz-card-head">
        <h2>{label} wall</h2>
        <button className="rz-x" onClick={onClose}>×</button>
      </div>
      <div className="rz-vitals">
        <Vital label="System" value={r.assembly.label} />
        <Vital label="Thickness" value={`${round1(r.thicknessFt)} ft`} />
      </div>
      <label className="rz-field rz-field-num">
        <span>Height (this wall)</span>
        <NumInput value={Math.round(r.heightFt * 10) / 10} min={2} max={40} step={0.5} onCommit={(v) => onWallSide(side, 'heightFt', v)} />
      </label>
      <label className="rz-field">
        <span>Wall system (this wall)</span>
        <select value={r.assemblyKey} onChange={(e) => onWallSide(side, 'assembly', e.target.value)}>
          {Object.values(WALL_ASSEMBLIES).map((a) => (
            <option key={a.key} value={a.key}>{a.green ? '🌿 ' : ''}{a.label} — R{a.rValue}</option>
          ))}
        </select>
      </label>
      <label className="rz-field">
        <span>Weather face (this wall)</span>
        <select value={r.cladding || 'render'} onChange={(e) => onWallSide(side, 'cladding', e.target.value)}>
          {Object.values(CLADDING_TYPES).map((c) => (
            <option key={c.key} value={c.key}>{c.green ? '🌿 ' : ''}{c.label}</option>
          ))}
        </select>
      </label>
      {/* greenhouse face: slanted glazing on this wall, carried by the frame */}
      <label className="rz-nowall">
        <input type="checkbox" checked={Boolean(r.sunGlazing)} onChange={(e) => onWallSide(side, 'sunGlazing', e.target.checked)} />
        <span>Sun glazing — slanted greenhouse glass on this wall</span>
      </label>
      {r.sunGlazing && (
        <label className="rz-field rz-field-num">
          <span>Glass tilt (from vertical)</span>
          <NumInput value={Math.round(Number(r.sunGlazingTiltDeg ?? 30))} min={0} max={45} step={5} unit="°" onCommit={(v) => onWallSide(side, 'sunGlazingTiltDeg', v)} />
        </label>
      )}
      <label className="rz-nowall">
        <input type="checkbox" checked={Boolean(r.omitted)} onChange={(e) => onWallSide(side, 'omitted', e.target.checked)} />
        <span>No wall on this side (opens to an attached space)</span>
      </label>
      <p className="rz-muted" style={{ marginTop: 8 }}>Just this wall — the other three keep their own height, system, and face. Slanted glazing on the south face makes a greenhouse; a full glass wall is the “Glazed” wall system above.</p>
    </div>
  );
}

// Roof chapter: shape, steepness, what insulates it, how far it overhangs —
// and, for a shed, which way it falls. Everything the engine already models.
const ROOF_SHAPES = [
  { key: 'gable', label: 'Gable', note: 'A ridge down the middle, two slopes.' },
  { key: 'shed', label: 'Shed', note: 'One slope — high wall falling to a low one.' },
  { key: 'hip', label: 'Hip', note: 'Slopes on all four sides to a ridge.' },
  { key: 'flat', label: 'Flat', note: 'Near-level with a slight drainage fall.' }
];
function RoofControls({ spec, derived, onRoofType, onPitch, onInsulation, onOverhang, onShedFall, onGutters, onDischarge }) {
  const roofType = spec.shell.roofType || 'gable';
  const pitch = Number(spec.shell.roofPitch || 0.32);
  const insulKey = resolveInsulation(utilitiesOf(spec).roofInsulation, 'cellulose');
  const overhangs = resolveOverhangs(spec.shell);
  const [perSide, setPerSide] = useState(overhangs.split);
  const sH = Number(spec.shell.southWallHeightFt || spec.shell.wallHeightFt || 10);
  const nH = Number(spec.shell.northWallHeightFt || spec.shell.wallHeightFt || 10);
  const fallNow = Math.round(Math.abs(sH - nH) * 2) / 2;
  const drainsNow = fallNow < 0.25 ? '' : (sH >= nH ? 'north' : 'south');
  return (
    <div className="rz-found">
      <label className="rz-field">
        <span>Shape</span>
        <select value={roofType} onChange={(e) => onRoofType(e.target.value)}>
          {ROOF_SHAPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <div className="rz-shape-note">{ROOF_SHAPES.find((s) => s.key === roofType)?.note}</div>

      {roofType === 'shed' ? (
        <>
          <label className="rz-field">
            <span>Which way it falls</span>
            <select value={drainsNow} onChange={(e) => onShedFall(e.target.value, Math.max(2, fallNow))}>
              {drainsNow === '' && <option value="">Level — pick a direction</option>}
              <option value="north">Falls north — high south wall (solar classic)</option>
              <option value="south">Falls south — high north wall</option>
            </select>
          </label>
          <label className="rz-field rz-field-num">
            <span>Fall, high eave to low</span>
            <NumInput value={fallNow} min={0.5} max={12} step={0.5} onCommit={(v) => onShedFall(drainsNow || 'north', v)} />
          </label>
        </>
      ) : roofType !== 'flat' && (
        <label className="rz-field rz-field-num">
          <span>Steepness · {Math.round(pitch * 12)}:12</span>
          <NumInput value={Math.round(pitch * 12)} min={1} max={18} step={1} unit=":12" onCommit={(v) => onPitch(clamp(v / 12, 0.02, 1.5))} />
        </label>
      )}

      <label className="rz-field">
        <span>Insulation · R-{derived.roofR}</span>
        <select value={insulKey} onChange={(e) => onInsulation(e.target.value)}>
          {Object.entries(INSULATION_TYPES).map(([key, ins]) => (
            <option key={key} value={key}>{ins.green ? '🌿 ' : ''}{ins.label} (R≈{ins.r})</option>
          ))}
        </select>
      </label>

      <div className="rz-field-num">
        <span className="rz-field-lead">Overhang past the walls{perSide ? '' : ` · ${overhangs.all} ft`}</span>
        {!perSide && <NumInput value={overhangs.all} min={0} max={12} step={0.5} onCommit={(v) => onOverhang('all', v)} />}
      </div>
      {perSide && (
        <div className="rz-overhang-grid">
          {WALL_SIDES.map((side) => (
            <label key={side} className="rz-field rz-field-num rz-overhang-cell">
              <span>{WALL_SIDE_LABELS[side]}</span>
              <NumInput value={overhangs[side]} min={0} max={12} step={0.5} onCommit={(v) => onOverhang(side, v)} />
            </label>
          ))}
        </div>
      )}
      <button type="button" className="rz-perwall-toggle" onClick={() => setPerSide((v) => !v)}>
        {perSide ? '▾ one overhang all around' : '▸ a different overhang per side'}
      </button>
      <div className="rz-shape-note">A 2-ft overhang is the minimum that keeps rain off plastered natural walls; 2–3 ft on the south shades summer sun without blocking winter light.</div>

      <DrainageControls spec={spec} derived={derived} roofType={roofType} onGutters={onGutters} onDischarge={onDischarge} />
    </div>
  );
}

// Where the water goes. A shed sends its WHOLE roof to one low eave, so this
// matters most there — but every roof sheds water somewhere. Gutters collect
// it, downspouts (auto-counted) carry it down, and the discharge choice sends
// it to grade, to a rain garden / dry well to soak in, or to barrels / a
// cistern to keep.
const GUTTER_OPTIONS = [
  { key: 'none', label: 'No gutters — water drips off the eave' },
  { key: 'eaves', label: 'Gutters on the draining edge' },
  { key: 'all', label: 'Gutters all around' }
];
function DrainageControls({ spec, derived, roofType, onGutters, onDischarge }) {
  const drainage = resolveDrainage(spec.shell);
  const rainYr = Number((spec.site || {}).rainInYr) || 38;
  const stormGal = Math.round(roofRunoffGallons(derived.roofArea, 1));
  const yearGal = Math.round(roofRunoffGallons(derived.roofArea, rainYr));
  const eaveLabel = roofType === 'shed'
    ? `the low (${drainage.lowEave}) eave`
    : roofType === 'gable' ? 'both long eaves' : 'the eaves';
  return (
    <div className="rz-drainage">
      <div className="rz-found-head">Drainage — where the water goes</div>
      <label className="rz-field">
        <span>Gutters</span>
        <select value={drainage.gutters} onChange={(e) => onGutters(e.target.value)}>
          {GUTTER_OPTIONS.map((g) => (
            <option key={g.key} value={g.key}>{g.key === 'eaves' ? `Gutters on ${eaveLabel}` : g.label}</option>
          ))}
        </select>
      </label>
      {drainage.gutters !== 'none' && (
        <>
          <label className="rz-field">
            <span>Where the runoff goes</span>
            <select value={drainage.discharge} onChange={(e) => onDischarge(e.target.value)}>
              {Object.values(DRAINAGE_DISCHARGE).map((d) => (
                <option key={d.key} value={d.key}>{d.green ? '🌿 ' : ''}{d.label}</option>
              ))}
            </select>
          </label>
          <div className="rz-shape-note">
            {drainage.downspouts} downspout{drainage.downspouts === 1 ? '' : 's'} on {Math.round(drainage.gutterLf)} ft of gutter. {drainage.dischargeSpec.note}
          </div>
        </>
      )}
      <div className="rz-runoff">
        This roof sheds <b>~{stormGal.toLocaleString()} gal</b> in a 1-inch rain — about <b>{yearGal.toLocaleString()} gal a year</b> here.
        {drainage.gutters !== 'none' && drainage.dischargeSpec.reuse ? ' You’re keeping it.' : drainage.gutters === 'none' ? ' Right now it just falls off the edge.' : ' Right now it soaks away.'}
      </div>
      {roofType === 'shed' && drainage.gutters === 'none' && (
        <div className="rz-shape-note rz-warn-note">A shed dumps its entire roof at the {drainage.lowEave} eave — a gutter there keeps it from trenching the ground and splashing the wall.</div>
      )}
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

// A compass that tracks the camera. Each letter is placed directly at its
// screen position for the current heading (no nested CSS rotation — that
// corrupts the position), so letters stay upright and land where the
// direction actually is in the view. N is world −z, S +z (the solar face),
// E +x, W −x — the same axes the plan, the walls, and the sun all use.
function Compass({ heading }) {
  const deg = (heading * 180) / Math.PI;
  const R = 20;
  const marks = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  return (
    <div className="rz-compass" title="Which way the model faces — N tracks true north">
      {marks.map(([label, a]) => {
        const ang = ((a + deg) * Math.PI) / 180; // clockwise from top
        const dx = R * Math.sin(ang);
        const dy = -R * Math.cos(ang); // screen y is down; top = negative
        return (
          <span
            key={label}
            className={`rz-compass-mark ${label === 'N' ? 'n' : ''} ${label === 'S' ? 's' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px)` }}
          >{label}</span>
        );
      })}
    </div>
  );
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const prettyId = (id) => String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
