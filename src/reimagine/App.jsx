import React, { useEffect, useMemo, useState } from 'react';
import { ThreeScene, webglAvailable } from '../threeScene.jsx';
import { PlanView } from '../planView.jsx';
import { applyBimOperations, clamp } from '../../backend/bim-core.mjs';
import {
  seedSpec, getWallSections, deriveDesign, detectIssues, fmtMoney, fmtNum, COST_ROWS,
  buildTimeline, phaseDependencies, orderPhasesByDeps, validatePhaseOrder, DEFAULT_MODEL_LAYERS
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
  { id: 'rooms', label: 'Rooms', view: 'plan', planContext: 'rooms', greet: () => 'Lay the rooms out flat, from above. Drag a room to move it, grab a corner to resize. No roof in the way up here.' },
  { id: 'shell', label: 'Shell', view: '3d', greet: (d) => `The shell stands ${fmtNum(d.storeys)} storey${d.storeys === 1 ? '' : 's'}. Set how tall the walls run.` },
  { id: 'roof', label: 'Roof', view: '3d', greet: () => 'Choose how the roof sheds weather and sun — and how much daylight it lets in.' },
  { id: 'openings', label: 'Openings', view: 'plan', planContext: 'windows', greet: () => 'Place doors and windows where light and paths want them. Slide them along their wall.' },
  { id: 'systems', label: 'Systems', view: '3d', greet: () => 'Heat, water, power, waste — the working parts. Each shows its own receipts.' },
  { id: 'finishes', label: 'Finishes', view: '3d', greet: () => 'Materials and surfaces, inside and out — natural or conventional, wall by wall.' }
];

// Bumped on every shell change so Daniel can see at a glance which version
// his browser is showing (bottom of the Trail).
const UPDATE_STAMP = 'update 8 · Jul 14';

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
  const [spec, setSpec] = useState(() => structuredClone(seedSpec));
  const [selectedId, setSelectedId] = useState(null);
  const [activeChapter, setActiveChapter] = useState('shape');
  const [viewMode, setViewMode] = useState('plan'); // 'plan' (top-down) | '3d'
  const [trailOpen, setTrailOpen] = useState(true);
  const [viewRequest, setViewRequest] = useState({ mode: 'iso', n: 1 });
  const [askText, setAskText] = useState('');
  const [askEcho, setAskEcho] = useState(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
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
            activeFloor={1}
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
            <div className="rz-stamp">{UPDATE_STAMP}</div>
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
        <RoomCard room={selectedRoom} derived={derived} onClose={() => setSelectedId(null)} />
      )}
      {selectedId && !selectedRoom && (
        <div className="rz-card">
          <div className="rz-card-head">
            <h2>{prettyId(selectedId)}</h2>
            <button className="rz-x" onClick={() => setSelectedId(null)}>×</button>
          </div>
          <p className="rz-muted">Selected. Drag it in the plan to move or resize; deeper controls arrive as the surfaces fill in.</p>
        </div>
      )}

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

function RoomCard({ room, derived, onClose }) {
  const [expanded, setExpanded] = useState(false);
  const area = Math.round((Number(room.w) || 0) * (Number(room.d) || 0));
  const sharePct = derived.floor > 0 ? Math.round((area / derived.floor) * 100) : 0;
  return (
    <div className="rz-card">
      <div className="rz-card-head">
        <h2>{room.name}</h2>
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
            Drag this room in the Plan view to move it; grab a corner to resize. Every number
            here will open to its full plain-English math as the receipts surface lands.
          </p>
        </div>
      )}
    </div>
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
