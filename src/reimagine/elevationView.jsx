import React, { useRef, useState } from 'react';
import { OPENING_TYPES, storeyElevationFt, storeyHeightFt } from '../../backend/bim-core.mjs';
import { resolveWallSide } from '../engine.js';

// ElevationView — the chosen wall drawn face-on, from OUTSIDE the house, so
// doors and windows can be placed the way you'd sketch them on paper: slide
// one along the wall, lift it up or down (its sill height), or pull a side
// handle to widen it. Everything commits through the same ops the plan and
// the chapter list use, so all three stay one truth.
//
// Coordinates: the engine measures an opening's position ALONG its wall
// (x for north/south walls, y for east/west, from the west/north end).
// Seen from outside, two walls read mirrored (north, east) — flipX handles
// that, and the corner labels say which end is which so it's never a guess.

const snapHalf = (v) => Math.round(v * 2) / 2;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function ElevationView({ spec, wall, selectedId, onSelect, onPlace, onSizeAlong }) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const shell = spec.shell || {};
  const horiz = wall === 'north' || wall === 'south';
  const run = Math.max(4, Number(horiz ? shell.widthFt : shell.depthFt) || 24);
  const flipX = wall === 'north' || wall === 'east';
  const storeys = Math.max(1, Math.ceil(Number(shell.storeys || 1)));
  const roofType = shell.roofType || 'gable';
  const pitch = Number(shell.roofPitch || 0.32);
  const hS = Number(shell.southWallHeightFt) || Number(shell.wallHeightFt) || 10;
  const hN = Number(shell.northWallHeightFt) || Number(shell.wallHeightFt) || 10;
  const groundH = Number(resolveWallSide(spec, wall).heightFt) || 10;
  // Upper storeys ride on top of the ground wall (drawn full-run — a set-back
  // storey is narrower in reality, but along-the-wall placement is identical).
  const upperLift = storeys > 1
    ? storeyElevationFt(shell, storeys) + storeyHeightFt(shell, storeys) - storeyElevationFt(shell, 2)
    : 0;
  const groundTopAt = (t) => {
    if (roofType === 'shed') {
      if (wall === 'south') return hS;
      if (wall === 'north') return hN;
      return hN + (hS - hN) * (t / run); // east/west walls rake from the north end to the south end
    }
    return groundH;
  };
  const gableRise = roofType === 'gable' && horiz ? (Number(shell.depthFt) || 24) * pitch : 0;
  const topAt = (t) => {
    let v = groundTopAt(t) + upperLift;
    if (gableRise > 0) {
      const half = run / 2;
      v += gableRise * (1 - Math.abs(t - half) / half); // the gable peak, mid-wall
    }
    return v;
  };
  const maxTop = Math.max(topAt(0), topAt(run / 2), topAt(run));
  const Y = (v) => maxTop - v; // feet measure up; paper draws down
  const X = (t) => (flipX ? run - t : t);

  // the wall face as a polygon: grade → up one end → along the top → down
  const topPts = gableRise > 0
    ? [[0, topAt(0)], [run / 2, topAt(run / 2)], [run, topAt(run)]]
    : [[0, topAt(0)], [run, topAt(run)]];
  const facePts = [[0, 0], ...topPts, [run, 0]].map(([t, v]) => `${X(t)},${Y(v)}`).join(' ');

  // which end is which, seen from outside this wall
  const cornerEnds = { south: ['West end', 'East end'], north: ['East end', 'West end'], east: ['South end', 'North end'], west: ['North end', 'South end'] };
  const [leftEnd, rightEnd] = cornerEnds[wall] || ['', ''];

  const openings = (spec.openings || []).map((o, i) => ({ o, i })).filter(({ o }) => o.wall === wall);
  const sillOf = (o) => {
    const prof = OPENING_TYPES[o.type] || OPENING_TYPES.window;
    return Number.isFinite(Number(o.sillFt)) ? Number(o.sillFt) : prof.sill;
  };
  const alongOf = (o) => Number(horiz ? o.x : o.y) || 0;

  function toFeet(event) {
    const svg = svgRef.current;
    if (!svg) return { fx: 0, fy: 0 };
    const p = svg.createSVGPoint();
    p.x = event.clientX; p.y = event.clientY;
    const u = p.matrixTransform(svg.getScreenCTM().inverse());
    return { fx: u.x, fy: u.y };
  }

  function startDrag(event, idx, mode) {
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const o = spec.openings[idx];
    if (!o) return;
    const { fx, fy } = toFeet(event);
    setDrag({
      idx, mode, startFx: fx, startFy: fy,
      orig: { along: alongOf(o), sill: sillOf(o), w: Number(o.widthFt) || 3, level: Number(o.level || 1) },
      ghost: null
    });
    onSelect(idx);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const { fx, fy } = toFeet(event);
    const dAlong = (flipX ? -1 : 1) * (fx - drag.startFx);
    const dUp = drag.startFy - fy; // paper y grows down; sills grow up
    const o = drag.orig;
    const prof = OPENING_TYPES[spec.openings[drag.idx]?.type] || OPENING_TYPES.window;
    // how much wall stands above this opening's floor, where it sits
    const bandH = o.level === 1
      ? groundTopAt(clampN(o.along + o.w / 2, 0, run))
      : storeyHeightFt(shell, o.level);
    let ghost;
    if (drag.mode === 'move') {
      ghost = {
        along: clampN(snapHalf(o.along + dAlong), 0, Math.max(0, run - o.w)),
        sill: clampN(snapHalf(o.sill + dUp), 0, Math.max(0, bandH - prof.h)),
        w: o.w
      };
    } else if (drag.mode === 'end') {
      ghost = { along: o.along, sill: o.sill, w: clampN(snapHalf(o.w + dAlong), 1, Math.max(1, run - o.along)) };
    } else { // 'start' — the far edge stays put
      const end = o.along + o.w;
      const along = clampN(snapHalf(o.along + dAlong), 0, end - 1);
      ghost = { along, sill: o.sill, w: end - along };
    }
    setDrag((d) => (d ? { ...d, ghost } : d));
  }

  function onPointerUp() {
    if (!drag) return;
    const { idx, mode, ghost } = drag;
    setDrag(null);
    if (!ghost) return;
    if (mode === 'move') onPlace(idx, ghost.along, ghost.sill);
    else onSizeAlong(idx, ghost.along, ghost.w);
  }

  const pad = 3.2;
  const soil = 2.4;
  const vb = `${-pad} ${-2.2} ${run + pad * 2} ${maxTop + 2.2 + soil + 2.4}`;

  return (
    <div className="planWrap rz-elev-wrap">
      <svg
        ref={svgRef}
        className="rz-elev"
        viewBox={vb}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={() => onSelect(-1)}
      >
        {/* ground: a soil band under the grade line */}
        <rect x={-pad} y={Y(0)} width={run + pad * 2} height={soil} fill="#d8cfbc" opacity="0.55" />
        <line x1={-pad} y1={Y(0)} x2={run + pad} y2={Y(0)} stroke="#8a8271" strokeWidth={0.12} />

        {/* the wall face */}
        <polygon points={facePts} fill="#f4efe3" stroke="#4a4f47" strokeWidth={0.16} strokeLinejoin="round" />

        {/* floor lines — where each upper storey's floor sits */}
        {Array.from({ length: storeys - 1 }, (_, k) => k + 2).map((lv) => {
          const e = storeyElevationFt(shell, lv);
          return (
            <g key={lv} pointerEvents="none">
              <line x1={0.3} y1={Y(e)} x2={run - 0.3} y2={Y(e)} stroke="#9a937f" strokeWidth={0.08} strokeDasharray="0.8 0.6" />
              <text x={run - 0.5} y={Y(e) - 0.35} textAnchor="end" fontSize="1.05" fill="#8a8271">{lv === 2 ? '2nd floor' : `${lv}rd floor`}</text>
            </g>
          );
        })}

        {/* the openings */}
        {openings.map(({ o, i }) => {
          const prof = OPENING_TYPES[o.type] || OPENING_TYPES.window;
          const isGhost = drag?.idx === i && drag.ghost;
          const along = isGhost ? drag.ghost.along : alongOf(o);
          const sill = isGhost ? drag.ghost.sill : sillOf(o);
          const w = isGhost ? drag.ghost.w : (Number(o.widthFt) || 3);
          const bottom = storeyElevationFt(shell, Number(o.level || 1)) + sill;
          const sel = String(selectedId || '') === `opening-${i}`;
          const drawX = flipX ? run - along - w : along;
          return (
            <g key={i}>
              <rect
                x={drawX} y={Y(bottom + prof.h)} width={w} height={prof.h}
                fill={prof.glazed ? '#c4dbe8' : '#b98f61'}
                stroke={sel ? '#3C6472' : '#5d6157'}
                strokeWidth={sel ? 0.24 : 0.13}
                opacity={isGhost ? 0.8 : 1}
                style={{ cursor: 'move' }}
                onPointerDown={(e) => startDrag(e, i, 'move')}
              />
              {/* a center mullion so glazing reads as a window */}
              {prof.glazed && prof.h > 1.2 && (
                <line x1={drawX + w / 2} y1={Y(bottom + prof.h) + 0.15} x2={drawX + w / 2} y2={Y(bottom) - 0.15} stroke="#7c96a5" strokeWidth={0.07} pointerEvents="none" />
              )}
              {sel && (
                <g>
                  {/* side handles — pull to widen; the labels live in feet */}
                  <rect x={drawX - 0.45} y={Y(bottom + prof.h / 2) - 0.45} width={0.9} height={0.9} rx={0.18} fill="#3C6472" stroke="#fff" strokeWidth={0.1}
                    style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, i, flipX ? 'end' : 'start')} />
                  <rect x={drawX + w - 0.45} y={Y(bottom + prof.h / 2) - 0.45} width={0.9} height={0.9} rx={0.18} fill="#3C6472" stroke="#fff" strokeWidth={0.1}
                    style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, i, flipX ? 'start' : 'end')} />
                  <text x={drawX + w / 2} y={Y(bottom + prof.h) - 0.5} textAnchor="middle" fontSize="1.1" fill="#22251F" fontWeight="600" pointerEvents="none">
                    {(o.label || prof.label)} — {Math.round(w * 10) / 10}′ wide · bottom {Math.round(sill * 10) / 10}′ above its floor
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* which corner is which */}
        <text x={0.2} y={Y(0) + 1.6} fontSize="1.15" fill="#6b6f66" pointerEvents="none">{leftEnd}</text>
        <text x={run - 0.2} y={Y(0) + 1.6} textAnchor="end" fontSize="1.15" fill="#6b6f66" pointerEvents="none">{rightEnd}</text>

        {openings.length === 0 && (
          <text x={run / 2} y={Y(Math.max(2, groundTopAt(run / 2) / 2))} textAnchor="middle" fontSize="1.3" fill="#8a8271" pointerEvents="none">
            No doors or windows on this wall yet — add one from the list on the left.
          </text>
        )}
      </svg>
    </div>
  );
}
