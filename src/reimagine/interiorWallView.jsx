import React, { useRef, useState } from 'react';

// A dedicated face-on 2D surface for ONE interior wall (partition) — the same
// idea as the exterior Wall view, but an interior wall is far simpler: just a
// rectangle (its run × its height) with a doorway you slide along it. No roof,
// grade, or weather face. Drag the doorway to reposition it; it commits through
// the same op the edit card uses, so the plan, 3D, and receipts stay one truth.
//
// Windows land here next (the model extension) — they'll draw and drag on this
// same face, exactly like the doorway.

const shortWallName = (name) => String(name || 'Interior wall').replace(/ wall$/i, '').replace(' / ', ' ↔ ');

export function InteriorWallView({ el, spec, partitions = [], onSetDoor, onPickWall, onClose }) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const run = Math.round(Math.max(Number(el.w) || 0, Number(el.d) || 0) * 10) / 10;
  const height = Math.round((Number(el.h) || Number(spec?.shell?.wallHeightFt) || 9.5) * 10) / 10;
  const doorW = Math.max(0, Number(el.doorWFt) || 0);
  const doorAt = Math.min(Math.max(0, Number(el.doorAtFt) || 0), Math.max(0, run - doorW));
  const doorH = Math.min(6.8, height - 0.2);
  const shownAt = drag && Number.isFinite(drag.at) ? drag.at : doorAt;

  const pad = 2;
  const vb = `${-pad} ${-pad} ${run + pad * 2} ${height + pad * 2}`;
  const Y = (v) => height - v; // feet measured up; paper draws down

  const toFeetX = (event) => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const p = svg.createSVGPoint();
    p.x = event.clientX; p.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return 0;
    const u = p.matrixTransform(ctm.inverse());
    return Number.isFinite(u.x) ? u.x : 0;
  };

  const onMove = (event) => {
    if (!drag) return;
    const at = Math.round(Math.min(Math.max(0, toFeetX(event) - drag.grab), Math.max(0, run - doorW)) * 2) / 2;
    setDrag({ ...drag, at });
  };
  const onUp = () => {
    if (drag && Number.isFinite(drag.at) && drag.at !== doorAt) onSetDoor('doorAtFt', drag.at);
    setDrag(null);
  };

  return (
    <div className="planWrap rz-elev-wrap rz-intwall-wrap">
      <div className="rz-wallpick">
        <span><b>{el.name}</b> · interior wall</span>
        {partitions.length > 1 && partitions.map((p) => (
          <button key={p.id} type="button" className={p.id === el.id ? 'on' : ''} onClick={() => onPickWall(p.id)}>{shortWallName(p.name)}</button>
        ))}
        <button type="button" onClick={onClose}>Done</button>
      </div>
      <svg
        ref={svgRef}
        className="rz-intwall-svg"
        viewBox={vb}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        {/* floor line */}
        <line x1={-pad} y1={Y(0)} x2={run + pad} y2={Y(0)} stroke="#8a8271" strokeWidth="0.09" />
        {/* the wall face */}
        <rect x={0} y={Y(height)} width={run} height={height} fill="#efe9dd" stroke="#3c4a3a" strokeWidth="0.13" />
        {/* the doorway — an open gap you can slide along the run */}
        {doorW > 0 && (
          <rect
            x={shownAt} y={Y(doorH)} width={doorW} height={doorH}
            fill="#dfe7ea" stroke="#3c6472" strokeWidth="0.11"
            style={{ cursor: drag ? 'grabbing' : 'grab' }}
            onPointerDown={(event) => {
              try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
              setDrag({ grab: toFeetX(event) - shownAt, at: shownAt });
            }}
          />
        )}
        {/* dimension caption */}
        <text x={run / 2} y={Y(0) + 1.3} textAnchor="middle" fontSize="0.95" fill="#6b6257">
          {run}′ wide · {height}′ tall{doorW > 0 ? ` · ${doorW}′ doorway` : ' · no doorway'}
        </text>
      </svg>
    </div>
  );
}
