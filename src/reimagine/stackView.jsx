import React, { useRef, useState } from 'react';
import { storeyElevationFt, storeyHeightFt, basementInfo } from '../../backend/bim-core.mjs';
import { upperPlateRect, floorLabel, resolveDeck } from '../engine.js';
import { buildFaceLaw } from './faceLaw.js';

// StackView — the STOREYS drawn as blocks you can grab, the way the Wall
// view draws one wall. Two kinds of face:
//
// • SIDE faces (south/north/east/west): the stack face-on. Drag a block's
//   TOP edge to set that storey's height, a SIDE handle to size it, or the
//   block itself to slide a set-back storey along the floor below. The
//   basement hangs below the grade line and drags DOWNWARD by its bottom
//   edge.
// • TOP face: the floors from straight above, nested like a map (north up,
//   west left — the same bearings as the Plan). Drag a floor to slide it
//   anywhere on the floor below, or pull any of its four edges to resize.
//   Heights live on the side faces; footprints live here.
//
// Everything commits through the same ops the Storeys chapter's number
// boxes use — one truth. Seen from outside, north and east side faces read
// mirrored — flipX handles that, and the corner labels name the ends.

const snapHalf = (v) => Math.round(v * 2) / 2;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const capWord = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const HANDLE = { fill: '#3C6472', stroke: '#fff', strokeWidth: 0.12 };

export function StackView({ spec, floors, hasBasement, activeFloor, basementLevel, onSelectFloor, onShapeStorey, onFloorHeight, onBasementHeight, selectedId = null, onSelectId = null, onMoveObject = null, onResizeObject = null }) {
  const svgRef = useRef(null);
  const [face, setFace] = useState('top');
  const [drag, setDrag] = useState(null);
  const shell = spec.shell || {};
  const width = Number(shell.widthFt) || 24;
  const depth = Number(shell.depthFt) || 24;
  const basementH = basementInfo(shell).heightFt;
  const top = face === 'top';
  const horiz = face === 'north' || face === 'south';   // side faces: measuring along plan x
  const run = Math.max(4, horiz ? width : depth);
  const flipX = face === 'north' || face === 'east';
  const axisWord = horiz ? 'west' : 'north';

  // Every storey's plan rectangle (the ground block is the shell itself).
  const rectOf = (lv) => (lv === 1 ? { x: 0, y: 0, w: width, d: depth } : (upperPlateRect(spec, lv) || { x: 0, y: 0, w: width, d: depth }));
  // Decks ride along in both faces — the same objects the Plan and 3D show,
  // tappable here too (the tap opens the same deck card; drags commit through
  // the same placement law, so a wraparound join or a clamp behaves alike
  // everywhere). Each carries its walking-surface height from resolveDeck.
  const decks = (spec.elements || []).filter((e) => e.category === 'deck').map((e) => {
    const dk = resolveDeck(spec, e);
    return {
      id: e.id, name: e.name || 'Deck', level: dk.level,
      rect: { x: Number(e.x) || 0, y: Number(e.y) || 0, w: Math.max(1, Number(e.w) || 10), d: Math.max(1, Number(e.d) || 8) },
      topFt: dk.topFt, railed: dk.railKey !== 'none'
    };
  });
  const storeyList = [];
  for (let lv = 1; lv <= floors; lv += 1) {
    const h = storeyHeightFt(shell, lv);
    if (lv > 1 && h <= 0) continue;
    const r = rectOf(lv);
    storeyList.push({
      lv, name: floorLabel(spec, lv), rect: r, h,
      setsBack: lv > 1 && (r.w * r.d < width * depth - 0.5 || r.x > 0.05 || r.y > 0.05)
    });
  }

  function toFeet(event) {
    const svg = svgRef.current;
    if (!svg) return { fx: 0, fy: 0 };
    const p = svg.createSVGPoint();
    p.x = event.clientX; p.y = event.clientY;
    const u = p.matrixTransform(svg.getScreenCTM().inverse());
    return { fx: u.x, fy: u.y };
  }

  // Side-face modes: 'height' (top edge ↕), 'deepen' (basement bottom ↕),
  // 'slide' (↔), 'start'/'end' (side handles ↔).
  // Top-face modes: 'tslide' (both axes), 'tn'/'ts'/'tw'/'te' (edge pulls).
  function startDrag(event, lv, mode, orig) {
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx, fy } = toFeet(event);
    onSelectFloor(lv);
    setDrag({ lv, mode, startFx: fx, startFy: fy, orig, ghost: null });
  }

  // Deck drags: same pointer grammar, looser clamps (a deck lives OUTSIDE
  // the walls; the placement law judges the final spot on commit).
  function startDeckDrag(event, deck, mode) {
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx, fy } = toFeet(event);
    if (onSelectId) onSelectId(deck.id);
    setDrag({ deckId: deck.id, mode, startFx: fx, startFy: fy, orig: { rect: deck.rect }, ghost: null });
  }
  const deckGhost = (r) => ({
    x: clampN(snapHalf(r.x), -48, width + 48), y: clampN(snapHalf(r.y), -48, depth + 48),
    w: clampN(snapHalf(r.w), 2, 60), d: clampN(snapHalf(r.d), 2, 60)
  });

  function onPointerMove(event) {
    if (!drag) return;
    const { fx, fy } = toFeet(event);
    const o = drag.orig;
    let ghost = null;
    if (drag.deckId) {
      const r = o.rect;
      const dxT = fx - drag.startFx;
      const dyT = fy - drag.startFy;
      const dA = (flipX ? -1 : 1) * dxT; // side faces: along the face axis
      if (drag.mode === 'kslide') {
        ghost = { rect: deckGhost(top
          ? { ...r, x: r.x + dxT, y: r.y + dyT }
          : (horiz ? { ...r, x: r.x + dA } : { ...r, y: r.y + dA })) };
      } else if (drag.mode === 'ke') ghost = { rect: deckGhost({ ...r, w: r.w + dxT }) };
      else if (drag.mode === 'ks') ghost = { rect: deckGhost({ ...r, d: r.d + dyT }) };
      else if (drag.mode === 'kw') { const x1 = r.x + r.w; const nx = clampN(snapHalf(r.x + dxT), x1 - 60, x1 - 2); ghost = { rect: { ...r, x: nx, w: x1 - nx } }; }
      else if (drag.mode === 'kn') { const y1 = r.y + r.d; const ny = clampN(snapHalf(r.y + dyT), y1 - 60, y1 - 2); ghost = { rect: { ...r, y: ny, d: y1 - ny } }; }
      else if (drag.mode === 'kend') ghost = { rect: deckGhost(horiz ? { ...r, w: r.w + dA } : { ...r, d: r.d + dA }) };
      else { // 'kstart' — the far edge stays put, along this face's axis
        if (horiz) { const x1 = r.x + r.w; const nx = clampN(snapHalf(r.x + dA), x1 - 60, x1 - 2); ghost = { rect: { ...r, x: nx, w: x1 - nx } }; }
        else { const y1 = r.y + r.d; const ny = clampN(snapHalf(r.y + dA), y1 - 60, y1 - 2); ghost = { rect: { ...r, y: ny, d: y1 - ny } }; }
      }
      setDrag((d) => (d ? { ...d, ghost } : d));
      return;
    }
    if (drag.mode === 'height' || drag.mode === 'deepen') {
      const dUp = drag.startFy - fy;
      ghost = drag.mode === 'height'
        ? { h: clampN(snapHalf(o.h + dUp), 7, 16) }
        : { h: clampN(snapHalf(o.h - dUp), 6, 12) };
    } else if (drag.mode === 'slide' || drag.mode === 'start' || drag.mode === 'end') {
      const dAlong = (flipX ? -1 : 1) * (fx - drag.startFx);
      if (drag.mode === 'slide') {
        const len = o.s1 - o.s0;
        const s0 = clampN(snapHalf(o.s0 + dAlong), 0, run - len);
        ghost = { s0, s1: s0 + len };
      } else if (drag.mode === 'end') {
        // the GROUND floor grows the shell itself — its end handle may pull
        // past the current run (engine minimum 18′, maximums 96′/80′); an
        // upper storey stays within the footprint (review finding: growth
        // was advertised but every clamp stopped at the current size)
        const maxEnd = drag.lv === 1 ? (horiz ? 96 : 80) : run;
        const minLen = drag.lv === 1 ? 18 : 8;
        ghost = { s0: o.s0, s1: clampN(snapHalf(o.s1 + dAlong), o.s0 + minLen, maxEnd) };
      } else ghost = { s0: clampN(snapHalf(o.s0 + dAlong), 0, o.s1 - 8), s1: o.s1 };
    } else {
      // top-face: free move / edge pulls, in plain plan feet (no mirror)
      const dx = fx - drag.startFx;
      const dy = fy - drag.startFy;
      const r = o.rect;
      if (drag.mode === 'tslide') {
        ghost = { rect: {
          x: clampN(snapHalf(r.x + dx), 0, Math.max(0, width - r.w)),
          y: clampN(snapHalf(r.y + dy), 0, Math.max(0, depth - r.d)),
          w: r.w, d: r.d
        } };
      } else if (drag.mode === 'te') {
        ghost = { rect: { ...r, w: clampN(snapHalf(r.w + dx), drag.lv === 1 ? 18 : 8, drag.lv === 1 ? 96 : width - r.x) } };
      } else if (drag.mode === 'ts') {
        ghost = { rect: { ...r, d: clampN(snapHalf(r.d + dy), drag.lv === 1 ? 18 : 8, drag.lv === 1 ? 80 : depth - r.y) } };
      } else if (drag.mode === 'tw') {
        const x1 = r.x + r.w;
        const nx = clampN(snapHalf(r.x + dx), 0, x1 - 8);
        ghost = { rect: { ...r, x: nx, w: x1 - nx } };
      } else { // 'tn'
        const y1 = r.y + r.d;
        const ny = clampN(snapHalf(r.y + dy), 0, y1 - 8);
        ghost = { rect: { ...r, y: ny, d: y1 - ny } };
      }
    }
    setDrag((d) => (d ? { ...d, ghost } : d));
  }

  function onPointerUp() {
    if (!drag) return;
    const { lv, deckId, mode, orig, ghost } = drag;
    setDrag(null);
    if (!ghost) return;
    if (deckId) {
      const a = orig.rect; const b = ghost.rect;
      if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.d - b.d) < 0.01) return;
      if (Math.abs(a.w - b.w) < 0.01 && Math.abs(a.d - b.d) < 0.01) { if (onMoveObject) onMoveObject(deckId, b.x, b.y); }
      else if (onResizeObject) onResizeObject(deckId, b.x, b.y, b.w, b.d);
      return;
    }
    if (mode === 'height') { if (Math.abs(ghost.h - orig.h) > 0.01) onFloorHeight(lv, ghost.h); return; }
    if (mode === 'deepen') { if (Math.abs(ghost.h - orig.h) > 0.01) onBasementHeight(ghost.h); return; }
    if (ghost.rect) {
      const a = orig.rect; const b = ghost.rect;
      if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.d - b.d) < 0.01) return;
      onShapeStorey(lv, b.x, b.y, b.w, b.d);
      return;
    }
    if (Math.abs(ghost.s0 - orig.s0) < 0.01 && Math.abs(ghost.s1 - orig.s1) < 0.01) return;
    const r = orig.rect || { x: 0, y: 0, w: width, d: depth };
    if (horiz) onShapeStorey(lv, ghost.s0, r.y, ghost.s1 - ghost.s0, r.d);
    else onShapeStorey(lv, r.x, ghost.s0, r.w, ghost.s1 - ghost.s0);
  }

  const faceBar = (
    <div
      className="rz-wallpick"
      title={top
        ? 'Straight above, north up. Drag a floor to slide it, pull an edge to resize — heights live on the side faces.'
        : `Face-on from the ${face}. Drag a top edge ↕ for height, a side handle ↔ for size, a set-back floor ↔ to slide it.`}
    >
      {/* a few words only — the full how-to lives in the hover tip (the
          long sentence grew the chip until it covered the plan itself) */}
      <span>{top ? <><b>Top</b> · north up</> : <>From the <b>{capWord(face)}</b></>}</span>
      {['top', 'south', 'north', 'east', 'west'].map((s) => (
        <button key={s} type="button" className={s === face ? 'on' : ''} onClick={() => setFace(s)}>{capWord(s)}</button>
      ))}
    </div>
  );

  // ───────────────────────── TOP face: the floors as a map ─────────────────
  if (top) {
    const pad = 4.2;
    // the map covers the house AND every deck around it
    const tx0 = Math.min(0, ...decks.map((k) => k.rect.x)) - pad;
    const tx1 = Math.max(width, ...decks.map((k) => k.rect.x + k.rect.w)) + pad;
    const ty0 = Math.min(0, ...decks.map((k) => k.rect.y)) - pad;
    const ty1 = Math.max(depth, ...decks.map((k) => k.rect.y + k.rect.d)) + pad;
    const vb = `${tx0} ${ty0} ${tx1 - tx0} ${ty1 - ty0}`;
    return (
      <div className="planWrap rz-elev-wrap">
        {faceBar}
        <svg
          ref={svgRef}
          className="rz-elev"
          viewBox={vb}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(event) => event.preventDefault()}
        >
          {/* the site under the house */}
          <rect x={tx0} y={ty0} width={tx1 - tx0} height={ty1 - ty0} fill="#e6dfcd" opacity="0.4" />
          {storeyList.map((b) => {
            const isDrag = drag && drag.lv === b.lv && drag.ghost?.rect;
            const r = isDrag ? drag.ghost.rect : b.rect;
            const sel = activeFloor === b.lv;
            const canSlide = b.lv > 1;
            // deeper floors draw lighter so the nesting reads at a glance
            const fill = b.lv === 1 ? '#f4efe3' : b.lv === 2 ? '#ece4d0' : '#e3d8bf';
            return (
              <g key={b.lv}>
                <rect
                  x={r.x} y={r.y} width={r.w} height={r.d}
                  fill={fill}
                  stroke={sel ? '#3C6472' : '#4a4f47'}
                  strokeWidth={sel ? 0.24 : 0.14}
                  strokeLinejoin="round"
                  opacity={isDrag ? 0.85 : 1}
                  style={{ cursor: canSlide ? 'move' : 'pointer' }}
                  onPointerDown={(e) => (canSlide ? startDrag(e, b.lv, 'tslide', { rect: b.rect }) : onSelectFloor(b.lv))}
                />
              </g>
            );
          })}
          {/* labels, drawn AFTER every block so no floor's name hides under a
              floor drawn later. Each label sits at the first spot of its
              floor that no HIGHER floor covers — center first, then the
              west/east quarters, then the north/south strips. */}
          {(() => { const placedLabels = []; return storeyList.map((b) => {
            const isDrag = drag && drag.lv === b.lv && drag.ghost?.rect;
            const r = isDrag ? drag.ghost.rect : b.rect;
            const covered = (px, py) => storeyList.some((o) => {
              if (o.lv <= b.lv) return false;
              const or2 = drag && drag.lv === o.lv && drag.ghost?.rect ? drag.ghost.rect : o.rect;
              return px > or2.x && px < or2.x + or2.w && py > or2.y && py < or2.y + or2.d;
            });
            const spots = [
              [r.x + r.w / 2, r.y + r.d / 2],
              [r.x + r.w * 0.25, r.y + r.d / 2],
              [r.x + r.w * 0.75, r.y + r.d / 2],
              [r.x + r.w / 2, r.y + 1.7],
              [r.x + r.w / 2, r.y + r.d - 2.6]
            ];
            let [lx, ly] = spots.find(([px, py]) => !covered(px, py)) || spots[0];
            // a FULL-footprint storey covers every candidate below it — both
            // labels then fell back to dead center and printed over each
            // other (Daniel's garbled "2Gd dhadr" screenshot). Colliding
            // labels now stack downward, one clear line each.
            while (placedLabels.some(([qx, qy]) => Math.abs(qx - lx) < 12 && Math.abs(qy - ly) < 2.4)) ly += 2.8;
            placedLabels.push([lx, ly]);
            return (
              <g key={`t${b.lv}`} pointerEvents="none">
                <text x={lx} y={ly - 0.2} textAnchor="middle" fontSize="1.25" fill="#22251F" fontWeight="600">
                  {b.name} — {Math.round(r.w * 10) / 10} × {Math.round(r.d * 10) / 10}′ · {Math.round(b.h * 10) / 10}′ tall
                </text>
                {b.lv > 1 && b.setsBack && (
                  <text x={lx} y={ly + 1.35} textAnchor="middle" fontSize="1.0" fill="#6b6f66">
                    {Math.round(r.x * 10) / 10}′ from west · {Math.round(r.y * 10) / 10}′ from north
                  </text>
                )}
              </g>
            );
          }); })()}
          {/* edge handles, drawn AFTER every block so the picked floor's
              handles never hide under a floor drawn later. The ground floor
              grows from its east/south edges (the west/north corner is
              pinned); upper floors pull from all four. */}
          {storeyList.filter((b) => activeFloor === b.lv).map((b) => {
            const isDrag = drag && drag.lv === b.lv && drag.ghost?.rect;
            const r = isDrag ? drag.ghost.rect : b.rect;
            return (
              <g key={`h${b.lv}`}>
                {b.lv > 1 && (
                  <>
                    <rect x={r.x - 0.45} y={r.y + r.d / 2 - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                      style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, b.lv, 'tw', { rect: b.rect })} />
                    <rect x={r.x + r.w / 2 - 0.45} y={r.y - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                      style={{ cursor: 'ns-resize' }} onPointerDown={(e) => startDrag(e, b.lv, 'tn', { rect: b.rect })} />
                  </>
                )}
                <rect x={r.x + r.w - 0.45} y={r.y + r.d / 2 - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                  style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, b.lv, 'te', { rect: b.rect })} />
                <rect x={r.x + r.w / 2 - 0.45} y={r.y + r.d - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                  style={{ cursor: 'ns-resize' }} onPointerDown={(e) => startDrag(e, b.lv, 'ts', { rect: b.rect })} />
              </g>
            );
          })}
          {/* decks — the same objects the Plan shows, tappable and draggable
              here; the tap opens the deck's own card with every option */}
          {decks.map((k) => {
            const isDrag = drag && drag.deckId === k.id && drag.ghost?.rect;
            const r = isDrag ? drag.ghost.rect : k.rect;
            const sel = String(selectedId || '') === String(k.id);
            // the picked floor's decks lead; other floors' decks stay faint
            // so the storey map underneath keeps reading
            const mine = k.level === Math.max(1, activeFloor);
            return (
              <g key={k.id} opacity={mine || sel ? 1 : 0.3}>
                <rect x={r.x} y={r.y} width={r.w} height={r.d}
                  fill="#c9a06b" opacity={isDrag ? 0.7 : 0.85}
                  stroke={sel ? '#3C6472' : '#8a6a48'} strokeWidth={sel ? 0.24 : 0.12} strokeLinejoin="round"
                  style={{ cursor: 'move' }}
                  onPointerDown={(e) => startDeckDrag(e, k, 'kslide')} />
                <text x={r.x + r.w / 2} y={r.y + r.d / 2 + 0.3} textAnchor="middle" fontSize="0.95" fill="#5a4632" pointerEvents="none">
                  {k.name} — {Math.round(r.w * 10) / 10} × {Math.round(r.d * 10) / 10}′
                </text>
                {sel && (
                  <g>
                    <rect x={r.x - 0.45} y={r.y + r.d / 2 - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                      style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDeckDrag(e, k, 'kw')} />
                    <rect x={r.x + r.w - 0.45} y={r.y + r.d / 2 - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                      style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDeckDrag(e, k, 'ke')} />
                    <rect x={r.x + r.w / 2 - 0.45} y={r.y - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                      style={{ cursor: 'ns-resize' }} onPointerDown={(e) => startDeckDrag(e, k, 'kn')} />
                    <rect x={r.x + r.w / 2 - 0.45} y={r.y + r.d - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                      style={{ cursor: 'ns-resize' }} onPointerDown={(e) => startDeckDrag(e, k, 'ks')} />
                  </g>
                )}
              </g>
            );
          })}
          {/* bearings — same map convention as the Plan */}
          <text x={width / 2} y={-1.4} textAnchor="middle" fontSize="1.3" fill="#6b6f66" pointerEvents="none">▲ N</text>
          <text x={width / 2} y={depth + 2.4} textAnchor="middle" fontSize="1.15" fill="#6b6f66" pointerEvents="none">South</text>
          <text x={-1.2} y={depth / 2} textAnchor="end" fontSize="1.15" fill="#6b6f66" pointerEvents="none">West</text>
          <text x={width + 1.2} y={depth / 2} fontSize="1.15" fill="#6b6f66" pointerEvents="none">East</text>
          {hasBasement && (
            <text x={width / 2} y={depth + 4.0} textAnchor="middle" fontSize="1.0" fill="#8a8271" pointerEvents="none">
              The basement sits under the whole ground floor — set its depth on a side face.
            </text>
          )}
        </svg>
      </div>
    );
  }

  // ─────────────────────── SIDE faces: the stack face-on ───────────────────
  const blocks = [];
  if (hasBasement) blocks.push({ lv: basementLevel, name: 'Basement', s0: 0, s1: run, y0: -basementH, y1: 0, basement: true });
  storeyList.forEach((b) => {
    const s0 = clampN(horiz ? b.rect.x : b.rect.y, 0, run);
    const s1 = clampN(horiz ? b.rect.x + b.rect.w : b.rect.y + b.rect.d, 0, run);
    const y0 = storeyElevationFt(shell, b.lv);
    blocks.push({ lv: b.lv, name: b.name, s0, s1, y0, y1: y0 + b.h, rect: b.rect, setsBack: b.lv > 1 && (s1 - s0 < run - 0.05 || s0 > 0.05) });
  });
  // THE FACE LAW — the same wall-top math the 3D scene builds from, so the
  // side faces show the storeys' TRUE shape (shed rakes, tier tops climbing
  // with the roof, caps under upper floors, attached lean-to planes) instead
  // of flat data boxes that disagreed with the model.
  const law = buildFaceLaw(spec, face);
  const lawCuts = [...new Set([0, run, ...law.tiers.flatMap((c) => [c.s0, c.s1])])]
    .filter((t) => t >= 0 && t <= run).sort((a, b2) => a - b2);
  // sampled per INTERVAL with a hair of inset — a cut sits exactly on a
  // plate edge, where the plane itself answers null. SEGMENTED: a skipped
  // interval ends the current run, so two wings on opposite sides of a
  // storey never get bridged by a phantom straight line across its face.
  const roofLineSegs = [];
  let roofSeg = [];
  for (let ci = 0; ci < lawCuts.length - 1; ci += 1) {
    const t0 = lawCuts[ci]; const t1 = lawCuts[ci + 1];
    if (t1 - t0 < 0.05) continue;
    const eps = Math.min(0.02, (t1 - t0) / 4);
    if (law.roofAt((t0 + t1) / 2) == null) {
      if (roofSeg.length >= 2) roofLineSegs.push(roofSeg);
      roofSeg = [];
      continue;
    }
    const ya = law.roofAt(t0 + eps); const yb = law.roofAt(t1 - eps);
    if (ya != null) roofSeg.push([t0, ya]);
    if (yb != null) roofSeg.push([t1, yb]);
  }
  if (roofSeg.length >= 2) roofLineSegs.push(roofSeg);
  const roofLinePts = roofLineSegs.flat();
  const maxTop = Math.max(...blocks.map((b) => b.y1), ...lawCuts.map((t) => law.wallTopAt(t)), ...roofLinePts.map(([, y]) => y), 8);
  const Y = (v) => maxTop - v; // feet measure up; paper draws down
  const cornerEnds = { south: ['West end', 'East end'], north: ['East end', 'West end'], east: ['South end', 'North end'], west: ['North end', 'South end'] };
  const [leftEnd, rightEnd] = cornerEnds[face] || ['', ''];
  const pad = 3.2;
  const soil = hasBasement ? basementH + 2.2 : 2.4;
  // the face covers the house AND every deck sticking past its ends
  const deckSpans = decks.map((k) => {
    const s0r = horiz ? k.rect.x : k.rect.y;
    const s1r = horiz ? k.rect.x + k.rect.w : k.rect.y + k.rect.d;
    return flipX ? [run - s1r, run - s0r] : [s0r, s1r];
  });
  const vx0 = Math.min(0, ...deckSpans.map(([a]) => a)) - pad;
  const vx1 = Math.max(run, ...deckSpans.map(([, b]) => b)) + pad;
  const vb = `${vx0} ${-2.2} ${vx1 - vx0} ${maxTop + 2.2 + soil + 2.4}`;

  return (
    <div className="planWrap rz-elev-wrap">
      {faceBar}
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
          const isDrag = drag && drag.lv === b.lv && drag.ghost && !drag.ghost.rect;
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
          const sideOrig = { s0: b.s0, s1: b.s1, h: b.y1 - b.y0, rect: b.rect };
          // the block's TRUE top on this face (the law's line) — a drag ghost
          // stays a plain box; the committed block wears its real shape
          const XX = (t) => (flipX ? run - t : t);
          const lawTier = !b.basement && b.lv > 1 ? law.tiers.find((tb) => tb.lv === b.lv) : null;
          const topF = b.basement || isDrag ? null : (b.lv === 1 ? law.groundTopAt : (lawTier ? lawTier.topAt : null));
          const shapePts = topF ? (() => {
            const tc = lawCuts.filter((t) => t >= s0 - 0.01 && t <= s1 + 0.01);
            const pts = [];
            for (let ci = 0; ci < tc.length - 1; ci += 1) {
              const t0 = tc[ci]; const t1 = tc[ci + 1];
              if (t1 - t0 < 0.02) continue;
              const eps = Math.min(0.02, (t1 - t0) / 4);
              pts.push([t0, Math.max(y0 + 0.5, topF(t0 + eps))], [t1, Math.max(y0 + 0.5, topF(t1 - eps))]);
            }
            if (!pts.length) return null;
            return [[s0, y0], ...pts, [s1, y0]].map(([t, v]) => `${XX(t)},${Y(v)}`).join(' ');
          })() : null;
          return (
            <g key={b.lv}>
              {shapePts ? (
                <polygon
                  points={shapePts}
                  fill="#f4efe3"
                  stroke={sel ? '#3C6472' : '#4a4f47'}
                  strokeWidth={sel ? 0.24 : 0.14}
                  strokeLinejoin="round"
                  style={{ cursor: canSlide ? 'move' : 'pointer' }}
                  onPointerDown={(e) => (canSlide ? startDrag(e, b.lv, 'slide', sideOrig) : onSelectFloor(b.lv))}
                />
              ) : (
              <rect
                x={x0} y={Y(y1)} width={len} height={y1 - y0}
                fill={b.basement ? '#e3ddcd' : '#f4efe3'}
                stroke={sel ? '#3C6472' : '#4a4f47'}
                strokeWidth={sel ? 0.24 : 0.14}
                strokeDasharray={b.basement ? '0.7 0.5' : undefined}
                strokeLinejoin="round"
                opacity={isDrag ? 0.85 : 1}
                style={{ cursor: canSlide ? 'move' : 'pointer' }}
                onPointerDown={(e) => (canSlide ? startDrag(e, b.lv, 'slide', sideOrig) : onSelectFloor(b.lv))}
              />
              )}
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
                    style={{ cursor: 'ns-resize' }} onPointerDown={(e) => startDrag(e, b.lv, 'deepen', sideOrig)} />
                  <g pointerEvents="none">
                    <rect x={x0 + len / 2 - 1.3} y={Y(y0) - 0.3} width={2.6} height={0.6} rx={0.3} fill="#3C6472" opacity="0.85" />
                    <text x={x0 + len / 2} y={Y(y0) + 0.22} textAnchor="middle" fontSize="0.62" fill="#fff" fontWeight="700">↕</text>
                  </g>
                </g>
              ) : (
                <g>
                  <line x1={x0} y1={Y(y1)} x2={x0 + len} y2={Y(y1)} stroke="transparent" strokeWidth={1.6}
                    style={{ cursor: 'ns-resize' }} onPointerDown={(e) => startDrag(e, b.lv, 'height', sideOrig)} />
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
                  {/* the ground floor is anchored at its origin — its west/
                      north edge can't move, so only the growing end gets a
                      handle (the other silently shifted the OPPOSITE edge) */}
                  {(b.lv > 1 || flipX) && (
                    <rect x={x0 - 0.45} y={midY - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                      style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, b.lv, (flipX ? 'end' : 'start'), sideOrig)} />
                  )}
                  {(b.lv > 1 || !flipX) && (
                    <rect x={x0 + len - 0.45} y={midY - 0.45} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                      style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, b.lv, (flipX ? 'start' : 'end'), sideOrig)} />
                  )}
                </g>
              )}
            </g>
          );
        })}

        {/* floor lines through the whole stack, so steps read against grade */}
        {blocks.filter((b) => !b.basement && b.lv > 1).map((b) => (
          <line key={`fl${b.lv}`} x1={-1} y1={Y(b.y0)} x2={run + 1} y2={Y(b.y0)} stroke="#9a937f" strokeWidth={0.07} strokeDasharray="0.8 0.6" pointerEvents="none" />
        ))}

        {/* the attached lean-to roof crossing this face — the same plane the
            3D wears, so the stack reads like the model (one polyline per
            contiguous wing; gaps stay gaps) */}
        {roofLineSegs.map((segPts, si) => (
          <polyline key={`rl${si}`} points={segPts.map(([t, y]) => `${flipX ? run - t : t},${Y(y)}`).join(' ')}
            fill="none" stroke="#7f8c89" strokeWidth={0.26} strokeLinecap="round" pointerEvents="none" opacity="0.9" />
        ))}

        {/* decks in elevation: a slab at its walking height with its railing —
            drag it along this face, pull a handle to size it, tap for its card */}
        {decks.map((k) => {
          const isDrag = drag && drag.deckId === k.id && drag.ghost?.rect;
          const r = isDrag ? drag.ghost.rect : k.rect;
          const s0r = horiz ? r.x : r.y;
          const s1r = horiz ? r.x + r.w : r.y + r.d;
          const dx0 = flipX ? run - s1r : s0r;
          const len = s1r - s0r;
          const sel = String(selectedId || '') === String(k.id);
          const railN = Math.max(1, Math.round(len / 4));
          return (
            <g key={`k${k.id}`}>
              <rect x={dx0} y={Y(k.topFt)} width={len} height={0.45}
                fill="#c9a06b" stroke={sel ? '#3C6472' : '#8a6a48'} strokeWidth={sel ? 0.2 : 0.1}
                opacity={isDrag ? 0.75 : 1}
                style={{ cursor: 'move' }} onPointerDown={(e) => startDeckDrag(e, k, 'kslide')} />
              {k.railed && (
                <g pointerEvents="none">
                  <line x1={dx0 + 0.2} y1={Y(k.topFt + 3)} x2={dx0 + len - 0.2} y2={Y(k.topFt + 3)} stroke="#8a6a48" strokeWidth={0.12} />
                  {Array.from({ length: railN + 1 }, (_, i) => dx0 + 0.2 + ((len - 0.4) * i) / railN).map((px, i) => (
                    <line key={i} x1={px} y1={Y(k.topFt)} x2={px} y2={Y(k.topFt + 3)} stroke="#8a6a48" strokeWidth={0.09} />
                  ))}
                </g>
              )}
              <text x={dx0 + len / 2} y={Y(k.topFt) + 1.4} textAnchor="middle" fontSize="0.9" fill="#5a4632" pointerEvents="none">{k.name}</text>
              {sel && (
                <g>
                  <rect x={dx0 - 0.45} y={Y(k.topFt) - 0.25} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                    style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDeckDrag(e, k, flipX ? 'kend' : 'kstart')} />
                  <rect x={dx0 + len - 0.45} y={Y(k.topFt) - 0.25} width={0.9} height={0.9} rx={0.18} {...HANDLE}
                    style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDeckDrag(e, k, flipX ? 'kstart' : 'kend')} />
                </g>
              )}
            </g>
          );
        })}

        {/* which corner is which */}
        <text x={0.2} y={Y(0) + (hasBasement ? basementH + 1.6 : 1.6)} fontSize="1.15" fill="#6b6f66" pointerEvents="none">{leftEnd}</text>
        <text x={run - 0.2} y={Y(0) + (hasBasement ? basementH + 1.6 : 1.6)} textAnchor="end" fontSize="1.15" fill="#6b6f66" pointerEvents="none">{rightEnd}</text>
      </svg>
    </div>
  );
}
