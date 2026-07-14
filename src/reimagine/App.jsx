import React, { useMemo, useState } from 'react';
import { ThreeScene, webglAvailable } from '../threeScene.jsx';
import { PlanView } from '../planView.jsx';
import { applyBimOperations, clamp } from '../../backend/bim-core.mjs';
import {
  seedSpec, getWallSections, deriveDesign, detectIssues, fmtMoney, fmtNum
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
const UPDATE_STAMP = 'update 6 · Jul 14';

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

  const webglOK = useMemo(() => webglAvailable(), []);
  const wallSections = useMemo(() => getWallSections(spec), [spec]);
  const derived = useMemo(() => deriveDesign(spec, wallSections), [spec, wallSections]);
  const flags = useMemo(() => detectIssues(spec).filter((i) => i.severity !== 'pass'), [spec]);

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
            viewRequest={viewRequest}
            onSelectRoom={setSelectedId}
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
        <span className="rz-status-item"><b>{fmtMoney(derived.total)}</b> rough</span>
        <span className="rz-dot" />
        <span className="rz-status-item"><b>{Math.round(derived.carbonKg / 1000)}</b> t CO₂e</span>
        <span className="rz-dot" />
        {flags.length === 0
          ? <span className="rz-status-item rz-clear">all clear</span>
          : <span className="rz-status-item rz-flag">{flags.length} to look at</span>}
      </div>

      {/* Plan / 3D toggle + (3D only) view angles */}
      <div className="rz-views">
        <button className={viewMode === 'plan' ? 'on' : ''} onClick={() => setViewMode('plan')}>Plan</button>
        <button className={viewMode === '3d' ? 'on' : ''} onClick={() => setViewMode('3d')}>3D</button>
        {viewMode === '3d' && webglOK && <span className="rz-views-sep" />}
        {viewMode === '3d' && webglOK && [['iso', 'Corner'], ['top', 'Top'], ['front', 'Front'], ['side', 'Side']].map(([mode, label]) => (
          <button key={mode} onClick={() => setViewRequest({ mode, n: Date.now() })}>{label}</button>
        ))}
      </div>

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
            <div className="rz-stamp">{UPDATE_STAMP}</div>
          </>
        )}
      </aside>

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

      {/* SURFACE 4b — the Ask bar (a shortcut, never the only way) */}
      <form
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
      </form>
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
