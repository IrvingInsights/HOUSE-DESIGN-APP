import React, { useRef, useState } from 'react';
import { storeyElevationFt, storeyHeightFt, basementInfo } from '../../backend/bim-core.mjs';
import { upperPlateRect, floorLabel } from '../engine.js';

// StackView — the STOREYS drawn face-on, the way the Wall view draws one
// wall: every floor is a block you can grab. Drag a block's TOP edge to set
// that storey's height, a SIDE handle to size it, or the block itself to
// slide a set-back storey along the floor below. The basement hangs below
// the grade line and drags DOWNWARD by its bottom edge. Everything commits
// through the same ops the Storeys chapter's number boxes use — one truth.
//
// Faces: like walls, the stack reads from any of the four sides. South and
// north faces measure along the house's WIDTH (offsets "from west"); east
// and west faces along its DEPTH (offsets "from north"). Seen from outside,
// north and east read mirrored — flipX handles that, and the corner labels
// say which end is which.

const snapHalf = (v) => Math.round(v * 2) / 2;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const capWord = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

export function StackView({ spec, floors, hasBasement, activeFloor, basementLevel, onSelectFloor, onShapeStorey, onFloorHeight, onBasementHeight }) {
  const svgRef = useRef(null);
  const [face, setFace] = useState('south');
  const [drag, setDrag] = useState(null);
  const shell = spec.shell || {};
  const horiz = face === 'north' || face === 'south';   // measuring along plan x
  const width = Number(shell.widthFt) || 24;
  const depth = Number(shell.depthFt) || 24;
  const run = Math.max(4, horiz ? width : depth);
  const flipX = face === 'north' || face === 'east';
  const axisWord = horiz ? 'west' : 'north';
  const basementH = basementInfo(shell).heightFt;

  // Every storey as a block: its stretch along this face's axis, its floor
  // elevation, its height. The ground block is the shell itself.
  const blocks = [];
  if (hasBasement) blocks.push({ lv: basementLevel, name: 'Basement', s0: 0, s1: run, y0: -basementH, y1: 0, basement: true });
  for (let lv = 1; lv <= floors; lv += 1) {
    const h = storeyHeightFt(shell, lv);
    if (lv > 1 && h <= 0) continue;
    const r = lv === 1 ? { x: 0, y: 0, w: width, d: depth } : (upperPlateRect(spec, lv) || { x: 0, y: 0, w: width, d: depth });
    const s0 = clampN(horiz ? r.x : r.y, 0, run);
    const s1 = clampN(horiz ? r.x + r.w : r.y + r.d, 0, run);
    const y0 = storeyElevationFt(shell, lv);
    blocks.push({ lv, name: floorLabel(spec, lv), s0, s1, y0, y1: y0 + h, rect: r, setsBack: lv > 1 && (s1 - s0 < run - 0.05 || s0 > 0.05) });
  }
  const maxTop = Math.max(...blocks.map((b) => b.y1), 8);
  const Y = (v) => maxTop - v; // feet measure up; paper draws down
  const X = (t) => (flipX ? run - t : t);

  // which end is which, seen from outside this face
  const cornerEnds = { south: ['West end', 'East end'], north: ['East end', 'West end'], east: ['South end', 'North end'], west: ['North end', 'South end'] };
  const [leftEnd, rightEnd] = cornerEnds[face] || ['', ''];

  function toFeet(event) {
    const svg = svgRef.current;
    if (!svg) return { fx: 0, fy: 0 };
    const p = svg.createSVGPoint();
    p.x = event.clientX; p.y = event.clientY;
    const u = p.matrixTransform(svg.getScreenCTM().inverse());
    return { fx: u.x, fy: u.y };
  }

  // mode: 'height' (top edge ↕), 'deepen' (basement bottom ↕), 'slide'
  // (whole upper block ↔), 'start'/'end' (side handles ↔)
  function startDrag(event, b, mode) {
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx, fy } = toFeet(event);
    onSelectFloor(b.lv);
    setDrag({ lv: b.lv, mode, startFx: fx, startFy: fy, orig: { s0: b.s0, s1: b.s1, h: b.y1 - b.y0, rect: b.rect }, ghost: null });
  }

  function onPointerMove(event) {
    if (!drag) return;
    const { fx, fy } = toFeet(event);
    const dAlong = (flipX ? -1 : 1) * (fx - drag.startFx);
    const dUp = drag.startFy - fy; // paper y grows down; heights grow up
    const o = drag.orig;
    let ghost = null;
    if (drag.mode === 'height') ghost = { h: clampN(snapHalf(o.h + dUp), 7, 16) };
    else if (drag.mode === 'deepen') ghost = { h: clampN(snapHalf(o.h - dUp), 6, 12) };
    else if (drag.mode === 'slide') {
      const len = o.s1 - o.s0;
      const s0 = clampN(snapHalf(o.s0 + dAlong), 0, run - len);
      ghost = { s0, s1: s0 + len };
    } else if (drag.mode === 'end') ghost = { s0: o.s0, s1: clampN(snapHalf(o.s1 + dAlong), o.s0 + 8, run) };
    else ghost = { s0: clampN(snapHalf(o.s0 + dAlong), 0, o.s1 - 8), s1: o.s1 }; // 'start'
    setDrag((d) => (d ? { ...d, ghost } : d));
  }

  function onPointerUp() {
    if (!drag) return;
    const { lv, mode, orig, ghost } = drag;
    setDrag(null);
    if (!ghost) return;
    if (mode === 'height') { if (Math.abs(ghost.h - orig.h) > 0.01) onFloorHeight(lv, ghost.h); return; }
    if (mode === 'deepen') { if (Math.abs(ghost.h - orig.h) > 0.01) onBasementHeight(ghost.h); return; }
    if (Math.abs(ghost.s0 - orig.s0) < 0.01 && Math.abs(ghost.s1 - orig.s1) < 0.01) return;
    const r = orig.rect || { x: 0, y: 0, w: width, d: depth };
    if (horiz) onShapeStorey(lv, ghost.s0, r.y, ghost.s1 - ghost.s0, r.d);
    else onShapeStorey(lv, r.x, ghost.s0, r.w, ghost.s1 - ghost.s0);
  }

  const pad = 3.2;
  const soil = hasBasement ? basementH + 2.2 : 2.4;
  const vb = `${-pad} ${-2.2} ${run + pad * 2} ${maxTop + 2.2 + soil + 2.4}`;
  const HANDLE = { fill: '#3C6472', stroke: '#fff', strokeWidth: 0.12 };

  return (
    <div className="planWrap rz-elev-wrap">
      <div className="rz-wallpick">
        <span>The <b>storeys</b> face-on, from the <b>{capWord(face)}</b> — drag a top edge ↕ for height, a side handle ↔ for size, a set-back floor ↔ to slide it.</span>
        {['south', 'north', 'east', 'west'].map((s) => (
          <button key={s} type="button" className={s === face ? 'on' : ''} onClick={() => setFace(s)}>{capWord(s)}</button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="rz-elev"
        viewBox={vb}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        {/* ground: a soil band under the grade line (deep enough for a basement) */}
        <rect x={-pad} y={Y(0)} width={run + pad * 2} height={soil} fill="#d8cfbc" opacity="0.55" />
        <line x1={-pad} y1={Y(0)} x2={run + pad} y2={Y(0)} stroke="#8a8271" strokeWidth={0.12} />

        {blocks.map((b) => {
          const isDrag = drag && drag.lv === b.lv && drag.ghost;
          const s0 = isDrag && drag.ghost.s0 != null ? drag.ghost.s0 : b.s0;
          const s1 = isDrag && drag.ghost.s1 != null ? drag.ghost.s1 : b.s1;
          const h = isDrag && drag.ghost.h != null ? drag.ghost.h : b.y1 - b.y0;
          const y0 = b.basement ? -h : b.y0;
          const y1 = b.basement ? 0 : b.y0 + h;
          const sel = activeFloor === b.lv;
          const x0 = flipX ? run - s1 : s0;
          const len = s1 - s0;
          const canSlide = !b.basement && b.lv > 1;
          const midY = Y(y1) + (y1 - y0) / 2;
          return (
            <g key={b.lv}>
              <rect
                x={x0} y={Y(y1)} width={len} height={y1 - y0}
                fill={b.basement ? '#e3ddcd' : '#f4efe3'}
                stroke={sel ? '#3C6472' : '#4a4f47'}
                strokeWidth={sel ? 0.24 : 0.14}
                strokeDasharray={b.basement ? '0.7 0.5' : undefined}
                strokeLinejoin="round"
                opacity={isDrag ? 0.85 : 1}
                style={{ cursor: canSlide ? 'move' : 'pointer' }}
                onPointerDown={(e) => (canSlide ? startDrag(e, b, 'slide') : onSelectFloor(b.lv))}
              />
              {/* name + the numbers this face can read (length × height) */}
              <text x={x0 + len / 2} y={midY - 0.2} textAnchor="middle" fontSize="1.25" fill="#22251F" fontWeight="600" pointerEvents="none">
                {b.name} — {Math.round(len * 10) / 10} × {Math.round(h * 10) / 10}′
              </text>
              {!b.basement && b.setsBack && (
                <text x={x0 + len / 2} y={midY + 1.35} textAnchor="middle" fontSize="1.0" fill="#6b6f66" pointerEvents="none">
                  starts {Math.round(s0 * 10) / 10}′ from {axisWord}
                </text>
              )}
              {/* TOP edge (bottom edge on the basement): the height handle */}
              {b.basement ? (
                <g>
                  <line x1={x0} y1={Y(y0)} x2={x0 + len} y2={Y(y0)} stroke="transparent" strokeWidth={1.6}
                    style={{ cursor: 'ns-resize' }} onPointerDown={(e) => startDrag(e, b, 'deepen')} />
                  <g pointerEvents="none">
                    <rect x={x0 + len / 2 - 1.3} y={Y(y0) - 0.3} width={2.6} height={0.6} rx={0.3} fill="#3C6472" opacity="0.85" />
                    <text x={x0 + len / 2} y={Y(y0) + 0.22} textAnchor="middle" fontSize="0.62" fill="#fff" fontWeight="700">↕</text>
                  </g>
                </g>
              ) : (
                <g>
                  <line x1={x0} y1={Y(y1)} x2={x0 + len} y2={Y(y1)} stroke="transparent" strokeWidth={1.6}
                    style={{ cursor: 'ns-resize' }} onPointerDown={(e) => startDrag(e, b, 'height')} />
                  <g pointerEvents="none">
                    <rect x={x0 + len / 2 - 1.3} y={Y(y1) - 0.3} width={2.6} height={0.6} rx={0.3} fill="#3C6472" opacity="0.85" />
                    <text x={x0 + len / 2} y={Y(y1) + 0.22} textAnchor="middle" fontSize="0.62" fill="#fff" fontWeight="700">↕</text>
                  </g>
                </g>
              )}
              {/* side handles: size this storey along the face's axis (the
                  basement follows the ground floor, so it has none) */}
              {!b.basement && sel && (
                <g>
                  <rect x={x0 - 0.45} y={midY - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                    style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, b, (flipX ? 'end' : 'start'))} />
                  <rect x={x0 + len - 0.45} y={midY - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                    style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, b, (flipX ? 'start' : 'end'))} />
                </g>
              )}
            </g>
          );
        })}

        {/* floor lines through the whole stack, so steps read against grade */}
        {blocks.filter((b) => !b.basement && b.lv > 1).map((b) => (
          <line key={`fl${b.lv}`} x1={-1} y1={Y(b.y0)} x2={run + 1} y2={Y(b.y0)} stroke="#9a937f" strokeWidth={0.07} strokeDasharray="0.8 0.6" pointerEvents="none" />
        ))}

        {/* which corner is which */}
        <text x={0.2} y={Y(0) + (hasBasement ? basementH + 1.6 : 1.6)} fontSize="1.15" fill="#6b6f66" pointerEvents="none">{leftEnd}</text>
        <text x={run - 0.2} y={Y(0) + (hasBasement ? basementH + 1.6 : 1.6)} textAnchor="end" fontSize="1.15" fill="#6b6f66" pointerEvents="none">{rightEnd}</text>
      </svg>
    </div>
  );
}
