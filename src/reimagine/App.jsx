import React, { useMemo, useState } from 'react';
import { ThreeScene, webglAvailable } from '../threeScene.jsx';
import {
  seedSpec, getWallSections, deriveDesign, detectIssues, fmtMoney, fmtNum
} from '../engine.js';
import '../styles.css';
import './shell.css';

// The Trail — the spine of the app. One chapter open at a time. Each opens with
// a plain-sentence greeting (the "foreman" voice). Ordered as the house is
// actually decided; the model stays the same object underneath.
const CHAPTERS = [
  { id: 'rooms', label: 'Rooms', greet: (d) => `Your rooms are roughed in — ${fmtNum(d.floor)} sq ft across ${d.bedrooms >= 0 ? '' : ''}the ground floor. Tap any room to shape it, or tell me what to add.` },
  { id: 'shape', label: 'Shape', greet: () => 'Push and pull the walls until the footprint feels right. The house re-derives as you go.' },
  { id: 'shell', label: 'Shell', greet: (d) => `The shell stands ${fmtNum(d.storeys)} storey${d.storeys === 1 ? '' : 's'}. Set the height and how tall the walls run.` },
  { id: 'roof', label: 'Roof', greet: () => 'Choose how the roof sheds weather and sun — and how much daylight it lets in.' },
  { id: 'openings', label: 'Openings', greet: () => 'Place doors and windows where light and paths want them. South glass earns its keep in winter.' },
  { id: 'systems', label: 'Systems', greet: () => 'Heat, water, power, waste — the working parts. Each shows its own receipts.' },
  { id: 'finishes', label: 'Finishes', greet: () => 'Materials and surfaces, inside and out — natural or conventional, wall by wall.' }
];

const TYPE_LABEL = {
  living: 'Living', service: 'Service', sleeping: 'Sleeping', wet: 'Wet core',
  work: 'Work', plant: 'Growing', outdoor: 'Outdoor', site: 'Site'
};

export default function App() {
  const [spec] = useState(() => structuredClone(seedSpec));
  const [selectedId, setSelectedId] = useState(null);
  const [activeChapter, setActiveChapter] = useState('rooms');
  const [trailOpen, setTrailOpen] = useState(true);
  // Open framed from the corner so the whole house reads at a glance, not the roof.
  const [viewRequest, setViewRequest] = useState({ mode: 'iso', n: 1 });
  const [askText, setAskText] = useState('');
  const [askEcho, setAskEcho] = useState(null);

  const webglOK = useMemo(() => webglAvailable(), []);
  const wallSections = useMemo(() => getWallSections(spec), [spec]);
  const derived = useMemo(() => deriveDesign(spec, wallSections), [spec, wallSections]);
  const flags = useMemo(() => detectIssues(spec).filter((i) => i.severity !== 'pass'), [spec]);

  const selectedRoom = spec.rooms.find((r) => r.id === selectedId) || null;
  const chapter = CHAPTERS.find((c) => c.id === activeChapter) || CHAPTERS[0];

  return (
    <div className="rz-root">
      {/* SURFACE 1 — the Model, center stage and full-bleed */}
      <div className="rz-model">
        <ThreeScene
          spec={spec}
          selectedRoom={selectedId}
          viewRequest={viewRequest}
          onSelectRoom={(id) => setSelectedId(id)}
          onFallbackNav={() => {}}
        />
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

      {/* view angles — cheap orientation, the model is the subject */}
      {webglOK && (
        <div className="rz-views">
          {[['iso', 'Corner'], ['top', 'Top'], ['front', 'Front'], ['side', 'Side']].map(([mode, label]) => (
            <button key={mode} onClick={() => setViewRequest({ mode, n: Date.now() })}>{label}</button>
          ))}
        </div>
      )}

      {/* SURFACE 2 — the Trail (chapters + foreman greeting) */}
      <aside className={`rz-trail ${trailOpen ? 'open' : 'closed'}`}>
        <button className="rz-trail-toggle" onClick={() => setTrailOpen((v) => !v)} title={trailOpen ? 'Collapse' : 'Expand'}>
          {trailOpen ? '‹' : '›'}
        </button>
        {trailOpen && (
          <>
            <div className="rz-greeting">{chapter.greet(derived)}</div>
            <nav className="rz-chapters">
              {CHAPTERS.map((c, i) => (
                <button
                  key={c.id}
                  className={`rz-chapter ${c.id === activeChapter ? 'active' : ''}`}
                  onClick={() => setActiveChapter(c.id)}
                >
                  <span className="rz-chapter-num">{i + 1}</span>
                  <span className="rz-chapter-label">{c.label}</span>
                </button>
              ))}
            </nav>
          </>
        )}
      </aside>

      {/* SURFACE 3 — the Card (tap any part → vitals, controls, receipts) */}
      {selectedRoom && (
        <RoomCard room={selectedRoom} derived={derived} onClose={() => setSelectedId(null)} />
      )}
      {selectedId && !selectedRoom && (
        <div className="rz-card">
          <div className="rz-card-head">
            <h2>{prettyId(selectedId)}</h2>
            <button className="rz-x" onClick={() => setSelectedId(null)}>×</button>
          </div>
          <p className="rz-muted">A part of the building. Fine controls for this arrive as the surfaces fill in.</p>
        </div>
      )}

      {/* SURFACE 4b — the Ask bar (talk instead of tap) */}
      <form
        className="rz-ask"
        onSubmit={(e) => { e.preventDefault(); if (askText.trim()) { setAskEcho(askText.trim()); setAskText(''); } }}
      >
        {askEcho && (
          <div className="rz-ask-echo">
            Heard: “{askEcho}”. Talking-to-change lands in a later pass — for now, tap the model.
          </div>
        )}
        <input
          value={askText}
          onChange={(e) => setAskText(e.target.value)}
          placeholder="Tell me what to change…  (e.g. add a big pantry off the kitchen)"
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
            Fine controls — move, resize, change use and finish — attach here as the sculpting
            surface lands. Every number in this card will open to its full plain-English math.
          </p>
        </div>
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

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const prettyId = (id) => String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
