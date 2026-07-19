import React, { useRef, useState } from 'react';
import { OPENING_TYPES, openingVerticalBand, storeyElevationFt, storeyHeightFt } from '../../backend/bim-core.mjs';
import { resolveWallSide, upperPlateRect } from '../engine.js';

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

export function ElevationView({ spec, wall, selectedId, onSelect, onPlace, onSizeAlong, onContext = null, onWallHeight = null, onPickWall = null }) {
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
  const hE = Number(shell.eastWallHeightFt) || Number(shell.wallHeightFt) || 10;
  const hW = Number(shell.westWallHeightFt) || Number(shell.wallHeightFt) || 10;
  // The shed's fall axis: a differing east/west pair means the roof falls
  // east or west, so the NORTH/SOUTH faces rake instead of the east/west ones.
  const shedEW = roofType === 'shed' && Math.abs(hE - hW) >= 0.05 && Math.abs(hS - hN) < 0.05;
  const groundH = Number(resolveWallSide(spec, wall).heightFt) || 10;
  const width = Number(shell.widthFt) || 24;
  const depth = Number(shell.depthFt) || 24;
  const elevOf = (lv) => storeyElevationFt(shell, lv);
  // Each upper storey shows on this wall only where its own outline stands:
  // TOUCHING the wall = the face steps up there ("built up only where the
  // second storey is"); SET BACK from it = drawn faint behind the face.
  const touching = [];
  const setBack = [];
  for (let lv = 2; lv <= storeys; lv += 1) {
    const h = storeyHeightFt(shell, lv);
    if (h <= 0) continue;
    const r = upperPlateRect(spec, lv) || { x: 0, y: 0, w: width, d: depth };
    const touches = wall === 'north' ? r.y <= 0.05
      : wall === 'south' ? r.y + r.d >= depth - 0.05
      : wall === 'west' ? r.x <= 0.05
      : r.x + r.w >= width - 0.05;
    const s0 = clampN(horiz ? r.x : r.y, 0, run);
    const s1 = clampN(horiz ? r.x + r.w : r.y + r.d, 0, run);
    if (s1 - s0 < 0.1) continue;
    (touches ? touching : setBack).push({ lv, s0, s1, y0: elevOf(lv), y1: elevOf(lv) + h });
  }
  const groundProfileAt = (t) => {
    if (roofType === 'shed' && shedEW) {
      if (wall === 'east') return hE;
      if (wall === 'west') return hW;
      // north/south walls rake from the west end to the east end; t runs in
      // plan x here (flipX only mirrors the drawing, not the measurement)
      return hW + (hE - hW) * (t / run);
    }
    if (roofType === 'shed') {
      if (wall === 'south') return hS;
      if (wall === 'north') return hN;
      return hN + (hS - hN) * (t / run); // east/west walls rake from the north end to the south end
    }
    return groundH;
  };
  const gableRise = roofType === 'gable' && horiz && storeys === 1 ? (Number(shell.depthFt) || 24) * pitch : 0;
  // the face's top edge: ground profile, capped at a covering storey's floor,
  // then raised by every storey standing on this stretch of the wall
  const topAt = (t) => {
    const covers = touching.filter((c) => t > c.s0 - 0.01 && t < c.s1 + 0.01);
    let g = groundProfileAt(t);
    if (covers.length) g = Math.min(g, Math.min(...covers.map((c) => c.y0)));
    let v = Math.max(g, ...covers.map((c) => c.y1));
    if (gableRise > 0) {
      const half = run / 2;
      v += gableRise * (1 - Math.abs(t - half) / half); // the gable peak, mid-wall
    }
    return v;
  };
  const cuts = [...new Set([0, run, run / 2, ...touching.flatMap((c) => [c.s0, c.s1])])]
    .filter((t) => t >= 0 && t <= run).sort((a, b) => a - b);
  const maxTop = Math.max(...cuts.map((t) => topAt(t)), ...setBack.map((c) => c.y1));
  const Y = (v) => maxTop - v; // feet measure up; paper draws down
  const X = (t) => (flipX ? run - t : t);

  // the wall face as a polygon: grade → up one end → step along the top → down.
  // Each stretch between cuts contributes both of its top corners (sampled
  // just inside, so steps draw as true verticals and rakes stay straight).
  const topPts = [];
  for (let ci = 0; ci < cuts.length - 1; ci += 1) {
    const t0 = cuts[ci]; const t1 = cuts[ci + 1];
    if (t1 - t0 < 0.02) continue;
    const eps = Math.min(0.02, (t1 - t0) / 4);
    topPts.push([t0, topAt(t0 + eps)], [t1, topAt(t1 - eps)]);
  }
  const facePts = [[0, 0], ...topPts, [run, 0]].map(([t, v]) => `${X(t)},${Y(v)}`).join(' ');

  // which end is which, seen from outside this wall
  const cornerEnds = { south: ['West end', 'East end'], north: ['East end', 'West end'], east: ['South end', 'North end'], west: ['North end', 'South end'] };
  const [leftEnd, rightEnd] = cornerEnds[wall] || ['', ''];

  // --- 2D wall shaping: grab the top edge and pull it up or down -------------
  // On a level-walled house the whole wall line moves together; on a shed the
  // flat faces move their own side, and a RAKED face gets a handle at each end
  // so the slope is shaped corner by corner. Commits go through the same
  // set_wall_height / wall-height ops as the Shell chapter's number boxes.
  const sideH = { south: hS, north: hN, east: hE, west: hW };
  const baseH = Number(shell.wallHeightFt) || 10;
  const isShed = roofType === 'shed';
  const rakedFace = isShed && (shedEW ? horiz : !horiz);
  // which wall each end of a raked top edge belongs to (t-space; X() mirrors)
  const endSides = shedEW ? ['west', 'east'] : ['north', 'south'];
  const capWord = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

  function startWallDrag(event, side, tEnd, startTopV) {
    if (!onWallHeight) return;
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fy } = toFeet(event);
    const startH = side ? Number(sideH[side]) || baseH : baseH;
    setDrag({ wallShape: { side, tEnd, startH, startTopV }, startFy: fy, ghostH: null });
    onSelect(-1);
  }

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
    if (drag.wallShape) {
      const { fy } = toFeet(event);
      const dUp = drag.startFy - fy;
      const ws = drag.wallShape;
      const h = clampN(snapHalf(ws.startH + dUp), ws.side ? 2 : 7, 18);
      setDrag((d) => (d ? { ...d, ghostH: h } : d));
      return;
    }
    const { fx, fy } = toFeet(event);
    const dAlong = (flipX ? -1 : 1) * (fx - drag.startFx);
    const dUp = drag.startFy - fy; // paper y grows down; sills grow up
    const o = drag.orig;
    const prof = OPENING_TYPES[spec.openings[drag.idx]?.type] || OPENING_TYPES.window;
    // how much wall stands above this opening's floor, where it sits
    const bandH = o.level === 1
      ? groundProfileAt(clampN(o.along + o.w / 2, 0, run))
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
    if (drag.wallShape) {
      const { wallShape, ghostH } = drag;
      setDrag(null);
      if (ghostH != null && Math.abs(ghostH - wallShape.startH) > 0.01) onWallHeight(wallShape.side, ghostH);
      return;
    }
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
      {onPickWall && (
        <div className="rz-wallpick">
          <span>Looking at the <b>{capWord(wall)} wall</b> from outside{onWallHeight ? ' — drag its top edge ↕ to change the height' : ''}.</span>
          {['south', 'north', 'east', 'west'].map((s) => (
            <button key={s} type="button" className={s === wall ? 'on' : ''} onClick={() => onPickWall(s)}>{capWord(s)}</button>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        className="rz-elev"
        viewBox={vb}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={() => onSelect(-1)}
        onContextMenu={(event) => event.preventDefault()}
      >
        {/* ground: a soil band under the grade line */}
        <rect x={-pad} y={Y(0)} width={run + pad * 2} height={soil} fill="#d8cfbc" opacity="0.55" />
        <line x1={-pad} y1={Y(0)} x2={run + pad} y2={Y(0)} stroke="#8a8271" strokeWidth={0.12} />

        {/* storeys set back from this wall show faint, behind the face */}
        {setBack.map((c) => (
          <rect key={`sb${c.lv}`} x={flipX ? run - c.s1 : c.s0} y={Y(c.y1)} width={c.s1 - c.s0} height={c.y1 - c.y0}
            fill="#e9e2d1" stroke="#a49d8a" strokeWidth={0.09} strokeDasharray="0.7 0.5" opacity="0.7" pointerEvents="none" />
        ))}

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
          // THE BAND LAW (same helper the 3D scene and health checks use):
          // the static drawing shows the opening where it will actually be
          // BUILT — clamped into its wall's real band, never floating. A
          // clamped one draws with a dashed amber edge (the flags card says
          // why in words). The drag ghost stays free — clamping happens at
          // commit and on the next render.
          const band = isGhost ? null : openingVerticalBand(spec, o);
          const sill = isGhost ? drag.ghost.sill : (band && !band.skylight && !band.raked ? band.fit.sillFt : sillOf(o));
          const drawH = !isGhost && band && !band.skylight && !band.raked ? band.fit.hFt : prof.h;
          const w = isGhost ? drag.ghost.w : (Number(o.widthFt) || 3);
          const drawLevel = !isGhost && band && !band.skylight && !band.raked ? band.level : Number(o.level || 1);
          const bottom = storeyElevationFt(shell, drawLevel) + sill;
          const isClamped = Boolean(band && band.clamped);
          const sel = String(selectedId || '') === `opening-${i}`;
          const drawX = flipX ? run - along - w : along;
          return (
            <g key={i}>
              <rect
                x={drawX} y={Y(bottom + drawH)} width={w} height={drawH}
                fill={prof.glazed ? '#c4dbe8' : '#b98f61'}
                stroke={isClamped ? '#c28a2e' : sel ? '#3C6472' : '#5d6157'}
                strokeDasharray={isClamped ? '0.5 0.3' : undefined}
                strokeWidth={sel ? 0.24 : isClamped ? 0.2 : 0.13}
                opacity={isGhost ? 0.8 : 1}
                style={{ cursor: 'move' }}
                onPointerDown={(e) => startDrag(e, i, 'move')}
                onContextMenu={(e) => {
                  if (!onContext) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onContext(i, e.clientX, e.clientY);
                }}
              />
              {/* a center mullion so glazing reads as a window */}
              {prof.glazed && drawH > 1.2 && (
                <line x1={drawX + w / 2} y1={Y(bottom + drawH) + 0.15} x2={drawX + w / 2} y2={Y(bottom) - 0.15} stroke="#7c96a5" strokeWidth={0.07} pointerEvents="none" />
              )}
              {sel && (
                <g>
                  {/* side handles — pull to widen; the labels live in feet */}
                  <rect x={drawX - 0.45} y={Y(bottom + drawH / 2) - 0.45} width={0.9} height={0.9} rx={0.18} fill="#3C6472" stroke="#fff" strokeWidth={0.1}
                    style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, i, flipX ? 'end' : 'start')} />
                  <rect x={drawX + w - 0.45} y={Y(bottom + drawH / 2) - 0.45} width={0.9} height={0.9} rx={0.18} fill="#3C6472" stroke="#fff" strokeWidth={0.1}
                    style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, i, flipX ? 'start' : 'end')} />
                  <text x={drawX + w / 2} y={Y(bottom + drawH) - 0.5} textAnchor="middle" fontSize="1.1" fill="#22251F" fontWeight="600" pointerEvents="none">
                    {(o.label || prof.label)} — {Math.round(w * 10) / 10}′ wide · bottom {Math.round(sill * 10) / 10}′ above its floor{isClamped ? ' · pulled to fit its wall' : ''}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* which corner is which */}
        <text x={0.2} y={Y(0) + 1.6} fontSize="1.15" fill="#6b6f66" pointerEvents="none">{leftEnd}</text>
        <text x={run - 0.2} y={Y(0) + 1.6} textAnchor="end" fontSize="1.15" fill="#6b6f66" pointerEvents="none">{rightEnd}</text>

        {/* shape the wall: a level top edge drags as one; a raked (sloped)
            top gets a handle at each end so you pull each corner where you
            want it */}
        {onWallHeight && !rakedFace && (
          <g>
            <polyline
              points={topPts.map(([t, v]) => `${X(t)},${Y(v)}`).join(' ')}
              fill="none" stroke="transparent" strokeWidth={1.8}
              style={{ cursor: 'ns-resize' }}
              onPointerDown={(e) => startWallDrag(e, isShed ? wall : null, run / 2, topAt(run / 2))}
            />
            <g pointerEvents="none">
              <rect x={run / 2 - 1.3} y={Y(topAt(run / 2)) - 0.3} width={2.6} height={0.6} rx={0.3} fill="#3C6472" opacity="0.85" />
              <text x={run / 2} y={Y(topAt(run / 2)) + 0.22} textAnchor="middle" fontSize="0.62" fill="#fff" fontWeight="700">↕</text>
            </g>
          </g>
        )}
        {onWallHeight && rakedFace && endSides.map((side, k) => {
          const tEnd = k === 0 ? 0 : run;
          const vTop = topAt(k === 0 ? 0.02 : run - 0.02);
          const hNow = Math.round((Number(sideH[side]) || baseH) * 10) / 10;
          return (
            <g key={side}>
              <rect
                x={X(tEnd) - 0.55} y={Y(vTop) - 0.55} width={1.1} height={1.1} rx={0.2}
                fill="#3C6472" stroke="#fff" strokeWidth={0.12}
                style={{ cursor: 'ns-resize' }}
                onPointerDown={(e) => startWallDrag(e, side, tEnd, vTop)}
              />
              <text x={X(tEnd) < run / 2 ? X(tEnd) + 0.9 : X(tEnd) - 0.9} y={Y(vTop) - 0.9}
                textAnchor={X(tEnd) < run / 2 ? 'start' : 'end'} fontSize="1.05" fill="#3C6472" fontWeight="600" pointerEvents="none">
                {capWord(side)} wall {hNow}′
              </text>
            </g>
          );
        })}
        {drag?.wallShape && drag.ghostH != null && (() => {
          const ws = drag.wallShape;
          const vNew = ws.startTopV + (drag.ghostH - ws.startH);
          const label = ws.side ? `${capWord(ws.side)} wall: ${drag.ghostH}′ tall` : `All the walls: ${drag.ghostH}′ tall`;
          const otherT = rakedFace && ws.side ? (ws.tEnd === 0 ? run : 0) : null;
          return (
            <g pointerEvents="none">
              {otherT == null ? (
                <line x1={0} y1={Y(vNew)} x2={run} y2={Y(vNew)} stroke="#3C6472" strokeWidth={0.14} strokeDasharray="0.9 0.6" />
              ) : (
                <line x1={X(otherT)} y1={Y(topAt(otherT === 0 ? 0.02 : run - 0.02))} x2={X(ws.tEnd)} y2={Y(vNew)} stroke="#3C6472" strokeWidth={0.14} strokeDasharray="0.9 0.6" />
              )}
              <text x={run / 2} y={Y(vNew) + 1.5} textAnchor="middle" fontSize="1.25" fill="#22251F" fontWeight="700">{label}</text>
            </g>
          );
        })()}

        {openings.length === 0 && (
          <text x={run / 2} y={Y(Math.max(2, groundProfileAt(run / 2) / 2))} textAnchor="middle" fontSize="1.3" fill="#8a8271" pointerEvents="none">
            No doors or windows on this wall yet — add them in the Openings chapter.
          </text>
        )}
      </svg>
    </div>
  );
}
