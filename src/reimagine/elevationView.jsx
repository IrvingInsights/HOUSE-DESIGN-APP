import React, { useRef, useState } from 'react';
import { OPENING_TYPES, openingVerticalBand, storeyElevationFt, storeyHeightFt, footprintEdges, hasSegmentedFootprint, CLADDING_TYPES } from '../../backend/bim-core.mjs';
import { resolveWallSide, upperPlateRect, resolveDeck } from '../engine.js';
import { buildFaceLaw } from './faceLaw.js';

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

export function ElevationView({ spec, wall, selectedId, onSelect, onPlace, onSizeAlong, onContext = null, onWallHeight = null, onPickWall = null, onSelectId = null, onMoveObject = null }) {
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
  // THE FACE LAW — the same wall-top math the 3D scene builds from (shed
  // rakes, tier tops that climb with the roof, storey caps, the attached
  // lean-to of "roof below: climbs to this floor's top"). Before this, the
  // face drew flat storey tops and the 2D and 3D disagreed.
  const law = buildFaceLaw(spec, wall);
  // Each upper storey shows on this wall only where its own outline stands:
  // TOUCHING the wall = the face steps up there ("built up only where the
  // second storey is"); SET BACK from it = drawn faint behind the face.
  const touching = law.tiers.filter((b) => b.touches).map((b) => ({ lv: b.lv, s0: b.s0, s1: b.s1, y0: b.floorY, y1: b.topAt((b.s0 + b.s1) / 2) }));
  const setBack = law.tiers.filter((b) => !b.touches).map((b) => ({ lv: b.lv, s0: b.s0, s1: b.s1, y0: b.floorY, y1: b.topAt((b.s0 + b.s1) / 2) }));
  const groundProfileAt = (t) => law.groundTopAt(t);
  // Sun-glazed stretches on THIS face — the whole side (classic) or glazed
  // SECTIONS of a split wall. Drawn as slanted-glass bands so the Wall view
  // finally shows the greenhouse face the 3D builds (it was 3D-only).
  // What this face WEARS — the chosen cladding's color, else the wall
  // system's own rendered face — pulled well toward paper so lines and
  // openings stay crisp. Before this the face was one fixed paper color and
  // both the system and face selects looked dead in this view.
  const rFace = resolveWallSide(spec, wall);
  const wearHex = rFace.cladding && rFace.cladding !== 'render'
    ? (CLADDING_TYPES[rFace.cladding] || {}).color
    : (rFace.assembly || {}).color;
  const faceFill = (() => {
    if (!Number.isFinite(Number(wearHex))) return '#f4efe3';
    const mix = (a, b, t) => Math.round(a + (b - a) * t);
    const h = Number(wearHex);
    const r8 = mix((h >> 16) & 255, 0xf4, 0.55); const g8 = mix((h >> 8) & 255, 0xef, 0.55); const b8 = mix(h & 255, 0xe3, 0.55);
    return `#${((r8 << 16) | (g8 << 8) | b8).toString(16).padStart(6, '0')}`;
  })();
  const glassCeilFace = storeys > 1 ? elevOf(2) : Infinity;
  const glassStretches = (() => {
    const out = [];
    const rSide = resolveWallSide(spec, wall);
    if (rSide.omitted) return out;
    if (rSide.sunGlazing) {
      out.push({ t0: 0.5, t1: run - 0.5, knee: Number(rSide.heightFt) || 2 });
    } else if (hasSegmentedFootprint(spec)) {
      footprintEdges(spec).forEach((edge) => {
        if (edge.facing !== wall) return;
        const r = resolveWallSide(spec, wall, 1, edge.key);
        if (!r.sunGlazing || r.omitted) return;
        const lo = horiz ? Math.min(edge.x0, edge.x1) : Math.min(edge.y0, edge.y1);
        const hi = horiz ? Math.max(edge.x0, edge.x1) : Math.max(edge.y0, edge.y1);
        out.push({ t0: Math.max(0.3, lo + 0.2), t1: Math.min(run - 0.3, hi - 0.2), knee: Number(r.heightFt) || 2 });
      });
    }
    // A greenhouse ROOM standing past this wall builds its glazed annex in
    // 3D — draw the same band here, so the Wall view shows it too (it was
    // 3D-only, and "the greenhouse button did nothing" was born).
    const W = Number(shell.widthFt) || 36;
    const Dp = Number(shell.depthFt) || 28;
    (spec.rooms || []).forEach((room) => {
      if (room.type !== 'plant' || Number(room.level || 1) !== 1) return;
      const rx = Number(room.x) || 0; const ry = Number(room.y) || 0;
      const rw = Number(room.w) || 0; const rd = Number(room.d) || 0;
      const poke = { south: ry + rd - Dp, north: -ry, east: rx + rw - W, west: -rx }[wall];
      if (!(poke > 1.5)) return;
      const lo = horiz ? Math.max(0, rx) : Math.max(0, ry);
      const hi = horiz ? Math.min(run, rx + rw) : Math.min(run, ry + rd);
      out.push({ t0: Math.max(0.3, lo + 0.2), t1: Math.min(run - 0.3, hi - 0.2), knee: 2, annex: true, label: `${room.name || 'greenhouse'} — slanted glass` });
    });
    return out.filter((s) => s.t1 - s.t0 > 1.5);
  })();
  // half the slope span × pitch — mirrors the 3D's corrected gable law
  const gableRise = roofType === 'gable' && horiz && storeys === 1 ? ((Number(shell.widthFt) || 24) / 2) * pitch : 0;
  // the face's top edge — the law's silhouette, plus the classic gable peak
  const topAt = (t) => {
    let v = law.wallTopAt(t);
    if (gableRise > 0) {
      const half = run / 2;
      v += gableRise * (1 - Math.abs(t - half) / half); // the gable peak, mid-wall
    }
    return v;
  };
  const cuts = [...new Set([0, run, run / 2, ...law.tiers.flatMap((c) => [c.s0, c.s1])])]
    .filter((t) => t >= 0 && t <= run).sort((a, b) => a - b);
  // the attached lean-to crossing this face (drawn as a roof line): sampled
  // per INTERVAL with a hair of inset — a cut sits exactly on a plate edge,
  // where the plane itself answers null. SEGMENTED so wings on opposite
  // sides of a storey never bridge with a phantom line across its face.
  const roofLineSegs = [];
  let roofSeg = [];
  for (let ci = 0; ci < cuts.length - 1; ci += 1) {
    const t0 = cuts[ci]; const t1 = cuts[ci + 1];
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
  const roofLine = roofLineSegs.flat();
  const maxTop = Math.max(...cuts.map((t) => topAt(t)), ...setBack.map((c) => c.y1), ...roofLine.map(([, y]) => y));
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
  // Decks that stand against THIS wall (touching it or just outside it, and
  // overlapping its run) show face-on: the walking slab at its true height,
  // its railing, draggable along the wall — the numeric twin of the plan
  // drag. Tapping opens the same deck card every other view opens.
  const wallDecks = (spec.elements || []).filter((el) => {
    if (el.category !== 'deck') return false;
    const ex = Number(el.x) || 0; const ey = Number(el.y) || 0;
    const ew = Number(el.w) || 10; const ed = Number(el.d) || 8;
    const near = wall === 'south' ? ey + ed >= depth - 0.75
      : wall === 'north' ? ey <= 0.75
      : wall === 'east' ? ex + ew >= width - 0.75
      : ex <= 0.75;
    if (!near) return false;
    const s0 = horiz ? ex : ey; const s1 = horiz ? ex + ew : ey + ed;
    return s1 > 0.1 && s0 < run - 0.1;
  }).map((el) => {
    const dk = resolveDeck(spec, el);
    return { el, topFt: dk.topFt, railed: dk.railKey !== 'none' };
  });

  function startDeckDrag(event, el) {
    if (!onMoveObject) return;
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx } = toFeet(event);
    if (onSelectId) onSelectId(el.id);
    setDrag({ deck: { id: el.id, origAlong: horiz ? (Number(el.x) || 0) : (Number(el.y) || 0), x: Number(el.x) || 0, y: Number(el.y) || 0 }, startFx: fx, ghostAlong: null });
  }
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
    if (drag.deck) {
      const { fx } = toFeet(event);
      const dAlong = (flipX ? -1 : 1) * (fx - drag.startFx);
      setDrag((d) => (d ? { ...d, ghostAlong: snapHalf(d.deck.origAlong + dAlong) } : d));
      return;
    }
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
    if (drag.deck) {
      const { deck, ghostAlong } = drag;
      setDrag(null);
      if (ghostAlong == null || Math.abs(ghostAlong - deck.origAlong) < 0.01) return;
      if (horiz) onMoveObject(deck.id, ghostAlong, deck.y);
      else onMoveObject(deck.id, deck.x, ghostAlong);
      return;
    }
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
  // the face covers the wall AND every deck sticking past its ends (a deck
  // 8 ft west of the house was clipped mid-slab before)
  const deckSpansEl = wallDecks.map(({ el }) => {
    const s0d = horiz ? (Number(el.x) || 0) : (Number(el.y) || 0);
    const s1d = s0d + (horiz ? (Number(el.w) || 10) : (Number(el.d) || 8));
    return flipX ? [run - s1d, run - s0d] : [s0d, s1d];
  });
  const vx0 = Math.min(0, ...deckSpansEl.map(([a]) => a)) - pad;
  const vx1 = Math.max(run, ...deckSpansEl.map(([, b]) => b)) + pad;
  const vb = `${vx0} ${-2.2} ${vx1 - vx0} ${maxTop + 2.2 + soil + 2.4}`;

  return (
    <div className="planWrap rz-elev-wrap">
      {onPickWall && (
        <div
          className="rz-wallpick"
          title={`Looking at the ${wall} wall from outside${onWallHeight ? ' — drag its top edge ↕ to change the height; drag doors and windows right on the face' : ''}.`}
        >
          {/* a few words only — the full how-to lives in the hover tip so
              the chip never grows over the drawing */}
          <span><b>{capWord(wall)} wall</b> · from outside</span>
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

        {/* the wall face — tinted by what the wall actually WEARS (its
            cladding, or the wall system's own rendered face), so this view
            answers the system/face selects instead of ignoring both */}
        <polygon points={facePts} fill={faceFill} stroke="#4a4f47" strokeWidth={0.16} strokeLinejoin="round" />

        {/* sun-glazed stretches: kneewall line, glass band up to the roofline
            (or the 2nd floor on a multi-storey house), timber mullions */}
        {glassStretches.map((s, si) => {
          const steps = Math.max(6, Math.round((s.t1 - s.t0) / 1.5));
          const topOfT = (t) => Math.min(groundProfileAt(t), glassCeilFace);
          const topEdge = Array.from({ length: steps + 1 }, (_, k) => {
            const t = s.t1 - ((s.t1 - s.t0) * k) / steps;
            return `${X(t)},${Y(topOfT(t))}`;
          }).join(' ');
          const pts = `${X(s.t0)},${Y(s.knee)} ${X(s.t1)},${Y(s.knee)} ${topEdge}`;
          const bays = Math.max(2, Math.round((s.t1 - s.t0) / 4));
          return (
            <g key={`sg${si}`} pointerEvents="none">
              <polygon points={pts} fill="#bcd8e0" fillOpacity="0.55" stroke="#6e93a0" strokeWidth={0.12} strokeLinejoin="round" />
              {Array.from({ length: bays + 1 }, (_, k) => {
                const t = s.t0 + ((s.t1 - s.t0) * k) / bays;
                const yT = topOfT(t);
                return yT - s.knee > 0.8
                  ? <line key={k} x1={X(t)} y1={Y(s.knee)} x2={X(t)} y2={Y(yT)} stroke="#7c5c38" strokeWidth={0.22} />
                  : null;
              })}
              <line x1={X(s.t0)} y1={Y(s.knee)} x2={X(s.t1)} y2={Y(s.knee)} stroke="#7c5c38" strokeWidth={0.28} />
              <text x={(X(s.t0) + X(s.t1)) / 2} y={Y(s.knee) + 1.1} textAnchor="middle" fontSize="0.95" fill="#5d7d89">{s.label || 'slanted sun glass'}</text>
            </g>
          );
        })}

        {/* the attached lean-to roof crossing this face — same plane the 3D
            builds, so the 2D face finally shows the roof the model wears
            (one polyline per contiguous wing; gaps stay gaps) */}
        {roofLineSegs.map((segPts, si) => (
          <polyline key={`rl${si}`} points={segPts.map(([t, y]) => `${X(t)},${Y(y)}`).join(' ')}
            fill="none" stroke="#7f8c89" strokeWidth={0.26} strokeLinecap="round" pointerEvents="none" opacity="0.9" />
        ))}

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

        {/* decks against this wall: the slab at its true height + railing —
            drag it along the wall; tap for its card (surface, roof, steps) */}
        {wallDecks.map(({ el, topFt, railed }) => {
          const isGhost = drag?.deck?.id === el.id && drag.ghostAlong != null;
          const alongNow = isGhost ? drag.ghostAlong : (horiz ? (Number(el.x) || 0) : (Number(el.y) || 0));
          const len = horiz ? (Number(el.w) || 10) : (Number(el.d) || 8);
          const dx0 = flipX ? run - alongNow - len : alongNow;
          const sel = String(selectedId || '') === String(el.id);
          const railN = Math.max(1, Math.round(len / 4));
          return (
            <g key={`k${el.id}`}>
              <rect x={dx0} y={Y(topFt)} width={len} height={0.45}
                fill="#c9a06b" stroke={sel ? '#3C6472' : '#8a6a48'} strokeWidth={sel ? 0.2 : 0.1}
                opacity={isGhost ? 0.75 : 1}
                style={{ cursor: onMoveObject ? 'move' : 'pointer' }}
                onPointerDown={(e) => startDeckDrag(e, el)} />
              {railed && (
                <g pointerEvents="none">
                  <line x1={dx0 + 0.2} y1={Y(topFt + 3)} x2={dx0 + len - 0.2} y2={Y(topFt + 3)} stroke="#8a6a48" strokeWidth={0.12} />
                  {Array.from({ length: railN + 1 }, (_, i) => dx0 + 0.2 + ((len - 0.4) * i) / railN).map((px, i) => (
                    <line key={i} x1={px} y1={Y(topFt)} x2={px} y2={Y(topFt + 3)} stroke="#8a6a48" strokeWidth={0.09} />
                  ))}
                </g>
              )}
              {sel && (
                <text x={dx0 + len / 2} y={Y(topFt) - 0.6} textAnchor="middle" fontSize="1.05" fill="#22251F" fontWeight="600" pointerEvents="none">
                  {el.name || 'Deck'} — {Math.round(len * 10) / 10}′ along this wall, floor at {Math.round(topFt * 10) / 10}′
                </text>
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
