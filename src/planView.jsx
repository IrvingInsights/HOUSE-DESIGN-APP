// 2D surfaces: JointDetail, PlanView, PlanMoveBoard (moved verbatim from main.jsx, JOB 0 split).
import React, { useEffect, useRef, useState } from 'react';
import {
  OPENING_TYPES, FLOORING_TYPES, resolveFlooring, SUBFLOOR_TYPES, resolveSubfloor, INSULATION_TYPES, resolveInsulation, footprintPolygon,
  footprintEdges, hasSegmentedFootprint, edgeForOpening, basementInfo, BASEMENT_LEVEL, isRoundFootprint, fitRoomInsideOutline
} from '../backend/bim-core.mjs';
import { Grid3X3, Plus } from 'lucide-react';
import {
  clamp, floorCount, floorLabel, resolveOverhangs, utilitiesOf, resolveWallSide, PLAN_ELEMENT_HEX, planLabelInk,
  PLAN_ZONE_HEX, hexOf
} from './engine.js';

export function JointDetail({ spec, derived, kind, side = 'south', opening = null }) {
  const u = utilitiesOf(spec);
  const label = (x, y, text, anchor = 'start') => (
    <text x={x} y={y} fontSize={0.52} fill="var(--ink2)" textAnchor={anchor}>{text}</text>
  );
  const dim = (x1, y1, x2, y2, text) => (
    <g stroke="var(--ink3)" strokeWidth={0.04}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1} y1={y1 - 0.2} x2={x1} y2={y1 + 0.2} />
      <line x1={x2} y1={y2 - 0.2} x2={x2} y2={y2 + 0.2} />
      <text x={(x1 + x2) / 2} y={y1 - 0.25} fontSize={0.5} fill="var(--ink3)" textAnchor="middle" stroke="none">{text}</text>
    </g>
  );

  if (kind === 'wall') {
    const r = resolveWallSide(spec, side);
    const t = r.thicknessFt;
    // Draw what's actually designed: a stem wall's real height, a slab's edge,
    // or a rubble trench's low plinth. Straw bale must ride ≥12″ above grade —
    // if this wall doesn't, the drawing says so in red (and Review flags it).
    const stemH = u.foundationType === 'stemwall' ? Math.min(6, Math.max(0.5, Number(u.stemwallHeightFt) || 1.5)) : u.foundationType === 'slab' ? 0.5 : 0.3;
    const baleAtRisk = r.assemblyKey === 'straw-bale' && stemH < 1;
    const wallTop = 0, wallBot = 3.2, grade = wallBot + stemH;
    const finish = FLOORING_TYPES[resolveFlooring(spec)]?.label || 'finish floor';
    const insul = INSULATION_TYPES[resolveInsulation(u.floorInsulation, 'cellulose')]?.label || 'insulation';
    const deck = SUBFLOOR_TYPES[resolveSubfloor(spec)]?.label.split(' —')[0] || 'deck';
    return (
      <svg viewBox="-3.4 -0.9 13.4 8.6" className="jointSvg">
        {/* wall leaf + plasters */}
        <rect x={0} y={wallTop} width={t} height={wallBot} fill={hexOf(r.assembly.color)} stroke="var(--ink3)" strokeWidth={0.05} />
        <line x1={-0.12} y1={wallTop} x2={-0.12} y2={wallBot} stroke="var(--straw, #C9A24B)" strokeWidth={0.1} />
        <line x1={t + 0.12} y1={wallTop} x2={t + 0.12} y2={wallBot} stroke="var(--ink2)" strokeWidth={0.08} />
        {/* foundation / stem + footing */}
        <rect x={-0.35} y={wallBot} width={t + 0.7} height={stemH} fill="#9a958b" stroke="var(--ink3)" strokeWidth={0.05} />
        <rect x={-0.8} y={grade} width={t + 1.6} height={1.1} fill="none" stroke="var(--ink3)" strokeWidth={0.05} strokeDasharray="0.25 0.18" />
        {/* grade line + hatch */}
        <line x1={-3.2} y1={grade} x2={-0.35} y2={grade} stroke="var(--ink2)" strokeWidth={0.09} />
        {[-2.9, -2.3, -1.7, -1.1].map((gx) => <line key={gx} x1={gx} y1={grade} x2={gx - 0.4} y2={grade + 0.4} stroke="var(--ink3)" strokeWidth={0.05} />)}
        {/* interior floor assembly bands */}
        <rect x={t + 0.35} y={wallBot - 0.16} width={4.6} height={0.16} fill="var(--straw, #C9A24B)" />
        <rect x={t + 0.35} y={wallBot + 0.0} width={4.6} height={0.42} fill="var(--limesage, #7E8A6A)" opacity={0.8} />
        <rect x={t + 0.35} y={wallBot + 0.42} width={4.6} height={0.24} fill="#8a7458" />
        {label(t + 0.5, wallBot - 0.32, finish)}
        {label(t + 0.5, wallBot + 0.3, insul)}
        {label(t + 0.5, wallBot + 0.62, deck)}
        {label(-3.2, wallTop + 0.5, 'exterior')}
        {label(-0.4, wallBot - 0.4, `${r.assembly.label}`, 'end')}
        {label(t + 1.1, grade + 0.8, `${u.foundationType} foundation`)}
        {dim(0, -0.45, t, -0.45, `${t.toFixed(2)}′`)}
        {u.foundationType === 'stemwall' && dim(-1.6, wallBot, -1.6, grade, '')}
        {u.foundationType === 'stemwall' && label(-3.2, wallBot + stemH / 2 + 0.2, `${Math.round(stemH * 12)}″ stem wall`)}
        {baleAtRisk && (
          <g>
            {/* the stem wall this bale wall REQUIRES but doesn't have */}
            <rect x={-0.35} y={wallBot - 1 + stemH} width={t + 0.7} height={1} fill="none" stroke="#AE452F" strokeWidth={0.09} strokeDasharray="0.3 0.2" />
            <text x={t + 0.6} y={wallBot - 1.5} fontSize={0.5} fill="#AE452F" fontWeight="700">⚠ bales need a ≥12″ stem wall</text>
            <text x={t + 0.6} y={wallBot - 0.85} fontSize={0.42} fill="#AE452F">splash + damp rot the bottom course — see Review</text>
          </g>
        )}
      </svg>
    );
  }

  if (kind === 'roof') {
    const o = resolveOverhangs(spec.shell).south;
    const pitch = Number(spec.shell.roofPitch || 0.32);
    const t = resolveWallSide(spec, 'south').thicknessFt;
    const insul = INSULATION_TYPES[resolveInsulation(u.roofInsulation, 'cellulose')]?.label || 'insulation';
    const eaveY = 2.4, run = 5;
    const rise = run * pitch;
    return (
      <svg viewBox={`${-o - 1.6} -2.4 ${o + run + 3.4} 7.6`} className="jointSvg">
        {/* wall top + plate */}
        <rect x={0} y={eaveY} width={t} height={2.6} fill={hexOf(resolveWallSide(spec, 'south').assembly.color)} stroke="var(--ink3)" strokeWidth={0.05} />
        <rect x={-0.05} y={eaveY - 0.22} width={t + 0.1} height={0.22} fill="#8a7458" />
        {/* rafter from overhang tip up the slope */}
        <line x1={-o} y1={eaveY} x2={run} y2={eaveY - rise} stroke="#8a7458" strokeWidth={0.28} />
        <line x1={-o} y1={eaveY - 0.5} x2={run} y2={eaveY - rise - 0.5} stroke="var(--ink2)" strokeWidth={0.12} />
        {/* insulation band between rafter and covering */}
        <line x1={0.4} y1={eaveY - 0.38} x2={run} y2={eaveY - rise - 0.28} stroke="var(--limesage, #7E8A6A)" strokeWidth={0.3} opacity={0.85} />
        {label(-o, eaveY + 0.6, `${o.toFixed(1)}′ overhang`)}
        {label(run - 3.4, eaveY - rise - 0.85, 'roof covering')}
        {label(1.2, eaveY - 0.85, insul)}
        {label(0.1, eaveY + 1.6, resolveWallSide(spec, 'south').assembly.label)}
        {label(-o - 1.4, eaveY - 0.3, 'eave')}
        {dim(-o, eaveY + 1.1, 0, eaveY + 1.1, `${o.toFixed(1)}′`)}
        {label(run - 3.4, eaveY - rise + 0.6, `pitch ≈ ${Math.round(pitch * 12)}:12 · sun ${Math.round(derived.sunWinterDeg)}°–${Math.round(derived.sunSummerDeg)}°`)}
      </svg>
    );
  }

  // opening: vertical section through a window/door in its wall
  const profile = OPENING_TYPES[opening?.type] || OPENING_TYPES.window;
  const r = resolveWallSide(spec, opening?.wall && opening.wall !== 'roof' ? opening.wall : 'south');
  const t = r.thicknessFt;
  const sill = profile.sill, head = profile.sill + profile.h;
  const top = 0.4;
  const scaleY = 5.6 / Math.max(head + 1.5, 8);
  const y = (ft) => top + (Math.max(head + 1.5, 8) - ft) * scaleY;
  return (
    <svg viewBox={`-2.6 0 ${t + 8} 7.2`} className="jointSvg">
      {/* wall above header and below sill */}
      <rect x={0} y={y(head + 1.2)} width={t} height={y(head) - y(head + 1.2)} fill={hexOf(r.assembly.color)} stroke="var(--ink3)" strokeWidth={0.05} />
      <rect x={0} y={y(sill)} width={t} height={y(0) - y(sill)} fill={hexOf(r.assembly.color)} stroke="var(--ink3)" strokeWidth={0.05} />
      {/* header + buck + sill */}
      <rect x={-0.1} y={y(head) - 0.3} width={t + 0.2} height={0.3} fill="#8a7458" />
      <line x1={t * 0.35} y1={y(head)} x2={t * 0.35} y2={y(sill)} stroke="var(--ink2)" strokeWidth={0.1} />
      <line x1={t * 0.45} y1={y(head)} x2={t * 0.45} y2={y(sill)} stroke="var(--ink2)" strokeWidth={0.1} />
      <polygon points={`${-0.4},${y(sill) + 0.28} ${t * 0.6},${y(sill)} ${t * 0.6},${y(sill) + 0.22} ${-0.4},${y(sill) + 0.5}`} fill="#8a7458" />
      {label(t + 0.5, y(head) - 0.4, `header over ${opening?.widthFt || profile.defaultW}′ ${profile.label.toLowerCase()}`)}
      {label(t + 0.5, (y(head) + y(sill)) / 2, profile.glazed ? `glazing (${u.windowQuality} pane)` : 'leaf')}
      {label(t + 0.5, y(sill) + 0.55, `sloped sill · ${Math.round(sill * 12)}″ above floor`)}
      {label(t + 0.5, y(0) - 0.2, r.assembly.label)}
    </svg>
  );
}

export const PLAN_CONTEXT_LABEL = {
  foundation: 'Foundation plan — drag the footprint corner to resize',
  shell: 'Footprint plan — drag the corner to resize',
  frame: 'Frame plan — the footprint the frame carries',
  flooring: 'Floor plan — the footprint the floor covers',
  walls: 'Wall plan — tap a wall in the model to edit it',
  roof: 'Roof plan — footprint the roof covers',
  site: 'Site plan — place and drag outbuildings',
  outdoors: 'Site plan — place and drag outbuildings',
  rooms: 'Room plan — drag to move, corners to resize',
  windows: 'Openings plan — white gaps mark windows & doors'
};
// Collision-aware plan labels: a label may never cross its room's boundary.
// Full name when it fits, two lines when the room is tall enough, initials
// when tight, nothing when tiny — except the SELECTED room/element, which
// always shows its full name on a paper halo. Returns null to draw no label.
const LABEL_CHAR_W = 0.62; // approx glyph width as a fraction of font size
function planLabelFit(name, w, d, isSel, maxSize = 2) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const room = Math.max(0.5, w - 0.8);
  const sizeFor = (text) => room / (Math.max(1, text.length) * LABEL_CHAR_W);
  if (isSel) {
    return { lines: [clean], size: Math.max(0.85, Math.min(maxSize, sizeFor(clean))), halo: true };
  }
  const natural = Math.min(maxSize, w / 5, d / 2.2);
  if (natural <= 0) return null;
  const oneLine = Math.min(natural, sizeFor(clean));
  if (oneLine >= 0.95 && d >= 2.2) return { lines: [clean], size: oneLine, halo: false };
  const words = clean.split(/[\s/-]+/).filter(Boolean);
  if (words.length > 1 && d >= 4.2) {
    // balance the words across two lines, longest line decides the size
    let best = null;
    for (let i = 1; i < words.length; i += 1) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      const size = Math.min(natural, sizeFor(a.length >= b.length ? a : b));
      if (!best || size > best.size) best = { lines: [a, b], size, halo: false };
    }
    if (best && best.size >= 0.95) return best;
  }
  const initials = words.map((word) => word[0]).join('').toUpperCase();
  const shortSize = Math.min(1.5, sizeFor(initials), d / 2.2);
  if (initials.length >= 1 && shortSize >= 0.9 && d >= 1.8) return { lines: [initials], size: shortSize, halo: false };
  return null;
}

export function PlanView({ spec, selectedRoom, onSelect, onMove, onResize, onResizeShell, onMoveEdge, onMoveOpening, onContext = null, context = null, activeFloor = 1 }) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [shellGhost, setShellGhost] = useState(null);
  const [edgeDrag, setEdgeDrag] = useState(null);
  const [openingDrag, setOpeningDrag] = useState(null);
  const W = Number(spec.shell.widthFt) || 36;
  const D = Number(spec.shell.depthFt) || 28;
  const snap = (v) => Math.round(v * 2) / 2;
  const buildingContext = ['foundation', 'shell', 'frame', 'floor', 'walls', 'roof', 'windows'].includes(context);
  const siteContext = context === 'site' || context === 'outdoors';



  // Two honest framings, no shrunken default: HOUSE (the working view — the
  // shell at full size, like the plan always drew) and SITE (everything —
  // patios, the greenhouse, a carport 40 ft out). The plan opens on House;
  // one tap reframes; anything beyond the frame announces itself with a
  // labeled edge arrow so nothing is ever silently cut off. Wheel zooms at
  // the cursor, dragging the ground pans.
  const planLevelFilter = (el) => (el.category === 'floor'
    ? (activeFloor > 1 && Number(el.level || 1) === activeFloor)
    : (Number(el.level || 1) === activeFloor || (/stair|ladder/i.test(el.name || '')
      && Number(el.level || 1) === (activeFloor === 1 && basementInfo(spec.shell).present ? BASEMENT_LEVEL : activeFloor - 1))));
  const houseBox = (() => {
    const m = Math.max(6, Math.round(Math.max(W, D) * 0.14));
    return { x: -m, y: -m, w: W + m * 2, h: D + m * 2 };
  })();
  const fitBox = (() => {
    let minX = 0; let minY = 0; let maxX = W; let maxY = D;
    for (const el of (spec.elements || []).filter(planLevelFilter)) {
      const x = Number(el.x) || 0; const y = Number(el.y) || 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + (Number(el.w) || 4)); maxY = Math.max(maxY, y + (Number(el.d) || 4));
    }
    const margin = Math.max(4, Math.round(Math.max(maxX - minX, maxY - minY) * 0.08));
    return { x: minX - margin, y: minY - margin, w: (maxX - minX) + margin * 2, h: (maxY - minY) + margin * 2 };
  })();
  // Is there anything out there beyond the house frame worth switching for?
  const siteBeyondHouse = fitBox.x < houseBox.x - 1 || fitBox.y < houseBox.y - 1
    || fitBox.x + fitBox.w > houseBox.x + houseBox.w + 1 || fitBox.y + fitBox.h > houseBox.y + houseBox.h + 1;
  // Foundation pads/footings usually sit OUTSIDE the house, so frame the whole
  // site there (like the site context) — a pad dropped east of the house must
  // be visible, not off the edge.
  const siteLikeFrame = siteContext || context === 'foundation';
  const [planFrame, setPlanFrame] = useState(siteLikeFrame ? 'site' : 'house');
  const [viewOverride, setViewOverride] = useState(null);
  const [panDrag, setPanDrag] = useState(null);
  const vb = viewOverride || (planFrame === 'site' && siteBeyondHouse ? fitBox : houseBox);
  const vbRef = useRef(vb); vbRef.current = vb;
  const fitBoxRef = useRef(fitBox); fitBoxRef.current = fitBox;
  useEffect(() => {
    setPlanFrame(siteLikeFrame ? 'site' : 'house');
    setViewOverride(null);
  }, [activeFloor, context, siteContext, siteLikeFrame]);
  // Wheel = zoom at the cursor. Manual listener: React's onWheel can't
  // preventDefault (passive), and the page must not scroll instead.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const point = svg.createSVGPoint();
      point.x = event.clientX; point.y = event.clientY;
      const user = point.matrixTransform(svg.getScreenCTM().inverse());
      const factor = event.deltaY > 0 ? 1.18 : 1 / 1.18;
      setViewOverride((current) => {
        const cur = current || fitBoxRef.current;
        const w = clamp(cur.w * factor, 8, Math.max(240, fitBoxRef.current.w * 2.5));
        const scale = w / cur.w;
        return { x: user.x - (user.x - cur.x) * scale, y: user.y - (user.y - cur.y) * scale, w, h: cur.h * scale };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);
  function startPan(event) {
    if (event.button !== 0) return;
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const rect = svgRef.current.getBoundingClientRect();
    const cur = vbRef.current;
    // 'meet' letterboxes: one uniform scale, the larger ft-per-px ratio.
    const fpp = Math.max(cur.w / rect.width, cur.h / rect.height);
    setPanDrag({ cx: event.clientX, cy: event.clientY, orig: cur, fpp });
  }
  function onPanMove(event) {
    if (!panDrag) return;
    const dx = (event.clientX - panDrag.cx) * panDrag.fpp;
    const dy = (event.clientY - panDrag.cy) * panDrag.fpp;
    setViewOverride({ ...panDrag.orig, x: panDrag.orig.x - dx, y: panDrag.orig.y - dy });
  }
  function endPan() { setPanDrag(null); }
  // Segmented = stored outline (a custom shape OR a split-but-still-rectangular
  // one): each wall piece draws and drags as its own edge with its own grip.
  const fpCustom = hasSegmentedFootprint(spec);
  // Round house: the shell draws as an ellipse; there are no straight wall
  // edges to grab, so the edge grips stay off and the corner dot does the sizing.
  const fpRound = isRoundFootprint(spec);
  const fpPoly = footprintPolygon(spec);
  const fpEdgesList = fpRound ? [] : footprintEdges(spec);
  // In a building context the footprint is the subject; dim the room fill so it
  // recedes. In a site context the outbuildings are the subject; dim the house.
  const roomsDim = buildingContext ? 0.18 : siteContext ? 0.28 : 1;

  function clientToFeet(event) {
    const svg = svgRef.current;
    if (!svg) return { fx: 0, fy: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const user = point.matrixTransform(svg.getScreenCTM().inverse());
    return { fx: user.x, fy: user.y };
  }

  function startDrag(event, room, mode) {
    event.stopPropagation();
    event.preventDefault();
    // Capture the pointer to the SVG so move/up keep firing even if the cursor
    // outruns the small handle or leaves a room rect mid-drag.
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx, fy } = clientToFeet(event);
    // A ground-floor indoor ROOM being MOVED inside a shaped outline (round or
    // L/T/U) hugs the built shape live: the wall stops the room mid-drag
    // instead of the room snapping back on release ("still can't move it").
    const isIndoorRoom = (spec.rooms || []).some((r) => r.id === room.id)
      && !['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead', 'plant', 'water', 'earthwork'].includes(room.type)
      && Number(room.level || 1) === 1;
    setDrag({ id: room.id, mode, startFx: fx, startFy: fy, hugOutline: isIndoorRoom, orig: { x: Number(room.x), y: Number(room.y), w: Number(room.w), d: Number(room.d) }, ghost: { x: Number(room.x), y: Number(room.y), w: Number(room.w), d: Number(room.d) } });
    onSelect(room.id);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const { fx, fy } = clientToFeet(event);
    const dx = fx - drag.startFx;
    const dy = fy - drag.startFy;
    const o = drag.orig;
    let ghost;
    if (drag.mode === 'move') {
      ghost = { x: clamp(snap(o.x + dx), vbRef.current.x, vbRef.current.x + vbRef.current.w - o.w), y: clamp(snap(o.y + dy), vbRef.current.y, vbRef.current.y + vbRef.current.h - o.d), w: o.w, d: o.d };
      if (drag.hugOutline) {
        const fitted = fitRoomInsideOutline(spec, ghost);
        if (fitted) ghost = { ...ghost, x: fitted.x, y: fitted.y };
      }
    } else {
      // corner resize keeps the opposite corner fixed
      let { x, y, w, d } = o;
      const right = o.x + o.w;
      const bottom = o.y + o.d;
      // 2-ft floor: a reach-in closet is a real 2-ft-deep room.
      if (drag.mode.includes('w')) { x = clamp(snap(o.x + dx), right - 60, right - 2); w = right - x; } else if (drag.mode.includes('e')) { w = clamp(snap(o.w + dx), 2, 60); }
      if (drag.mode.includes('n')) { y = clamp(snap(o.y + dy), bottom - 60, bottom - 2); d = bottom - y; } else if (drag.mode.includes('s')) { d = clamp(snap(o.d + dy), 2, 60); }
      ghost = { x, y, w, d };
    }
    setDrag((current) => current && { ...current, ghost });
  }

  function endDrag() {
    if (!drag) return;
    const g = drag.ghost;
    const o = drag.orig;
    if (drag.mode === 'move') {
      if (g.x !== o.x || g.y !== o.y) onMove(drag.id, g.x, g.y);
    } else if (g.w !== o.w || g.d !== o.d || g.x !== o.x || g.y !== o.y) {
      onResize(drag.id, g.x, g.y, g.w, g.d);
    }
    setDrag(null);
  }

  // Drag a wall EDGE perpendicular to itself — "move a wall" / make an L.
  function startEdgeDrag(event, edge) {
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx, fy } = clientToFeet(event);
    setEdgeDrag({ index: edge.index, edge, startFx: fx, startFy: fy, offset: 0 });
    onSelect?.(`wall-${edge.key}`);
  }
  function onEdgeMove(event) {
    if (!edgeDrag) return;
    const { fx, fy } = clientToFeet(event);
    // outward component of the pointer delta along the edge normal
    const raw = (fx - edgeDrag.startFx) * edgeDrag.edge.nx + (fy - edgeDrag.startFy) * edgeDrag.edge.ny;
    setEdgeDrag((current) => current && { ...current, offset: clamp(snap(raw), -48, 48) });
  }
  function endEdgeDrag() {
    if (!edgeDrag) return;
    if (Math.abs(edgeDrag.offset) >= 0.5 && onMoveEdge) onMoveEdge(edgeDrag.index, edgeDrag.offset);
    setEdgeDrag(null);
  }

  // Drag an opening ALONG its wall — windows and doors find their real spot
  // on the plan, the natural home for that decision.
  function startOpeningDrag(event, index, opening) {
    if (!onMoveOpening) return;
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx, fy } = clientToFeet(event);
    const horizontal = opening.wall === 'north' || opening.wall === 'south';
    const along0 = Number(horizontal ? opening.x : opening.y) || 0;
    setOpeningDrag({ index, horizontal, start: horizontal ? fx : fy, along0, along: along0, width: Number(opening.widthFt) || 3 });
    onSelect?.(`opening-${index}`);
  }
  function onOpeningMove(event) {
    if (!openingDrag) return;
    const { fx, fy } = clientToFeet(event);
    const cur = openingDrag.horizontal ? fx : fy;
    const maxAlong = Math.max(0, (openingDrag.horizontal ? W : D) - openingDrag.width);
    setOpeningDrag((current) => current && { ...current, along: clamp(snap(current.along0 + (cur - current.start)), 0, maxAlong) });
  }
  function endOpeningDrag() {
    if (!openingDrag) return;
    if (Math.abs(openingDrag.along - openingDrag.along0) >= 0.25) onMoveOpening(openingDrag.index, openingDrag.along);
    setOpeningDrag(null);
  }

  function startShellDrag(event) {
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    setShellGhost({ ghostW: W, ghostD: D });
  }
  function onShellMove(event) {
    if (!shellGhost) return;
    const { fx, fy } = clientToFeet(event);
    setShellGhost((current) => current && { ...current, ghostW: clamp(snap(fx), 12, 96), ghostD: clamp(snap(fy), 12, 80) });
  }
  function endShellDrag() {
    if (!shellGhost) return;
    const w = shellGhost.ghostW ?? W;
    const d = shellGhost.ghostD ?? D;
    if ((w !== W || d !== D) && onResizeShell) onResizeShell(w, d);
    setShellGhost(null);
  }
  const shellW = shellGhost?.ghostW ?? W;
  const shellD = shellGhost?.ghostD ?? D;

  let dragAnnotations = null;
  if (drag && drag.ghost) {
    const g = drag.ghost;
    const tickH = 0.5;
    const yLine = g.y + g.d + 1;
    const xLine = g.x + g.w + 1;
    dragAnnotations = (
      <g stroke="#5c6258" strokeWidth={0.06} fill="none" opacity={0.8} style={{ fontFamily: 'var(--font-hand)' }}>
        {/* Width */}
        <line x1={g.x} y1={yLine} x2={g.x + g.w} y2={yLine} strokeDasharray="0.1 0.1" />
        <line x1={g.x} y1={yLine - tickH} x2={g.x} y2={yLine + tickH} />
        <line x1={g.x + g.w} y1={yLine - tickH} x2={g.x + g.w} y2={yLine + tickH} />
        <text x={g.x + g.w / 2} y={yLine - 0.2} textAnchor="middle" fontSize={1.6} fill="#5c6258" stroke="none">{g.w}′</text>

        {/* Depth */}
        <line x1={xLine} y1={g.y} x2={xLine} y2={g.y + g.d} strokeDasharray="0.1 0.1" />
        <line x1={xLine - tickH} y1={g.y} x2={xLine + tickH} y2={g.y} />
        <line x1={xLine - tickH} y1={g.y + g.d} x2={xLine + tickH} y2={g.y + g.d} />
        <text x={xLine + 0.3} y={g.y + g.d / 2 + 0.5} textAnchor="start" fontSize={1.6} fill="#5c6258" stroke="none">{g.d}′</text>
      </g>
    );
  } else if (shellGhost) {
    const tickH = 0.5;
    const yLine = shellGhost.ghostD + 2;
    const xLine = shellGhost.ghostW + 2;
    dragAnnotations = (
      <g stroke="#5c6258" strokeWidth={0.07} fill="none" opacity={0.8} style={{ fontFamily: 'var(--font-hand)' }}>
        {/* Width */}
        <line x1={0} y1={yLine} x2={shellGhost.ghostW} y2={yLine} strokeDasharray="0.15 0.15" />
        <line x1={0} y1={yLine - tickH} x2={0} y2={yLine + tickH} />
        <line x1={shellGhost.ghostW} y1={yLine - tickH} x2={shellGhost.ghostW} y2={yLine + tickH} />
        <text x={shellGhost.ghostW / 2} y={yLine - 0.25} textAnchor="middle" fontSize={2.2} fill="#5c6258" stroke="none">{shellGhost.ghostW}′</text>

        {/* Depth */}
        <line x1={xLine} y1={0} x2={xLine} y2={shellGhost.ghostD} strokeDasharray="0.15 0.15" />
        <line x1={xLine - tickH} y1={0} x2={xLine + tickH} y2={0} />
        <line x1={xLine - tickH} y1={shellGhost.ghostD} x2={xLine + tickH} y2={shellGhost.ghostD} />
        <text x={xLine + 0.4} y={shellGhost.ghostD / 2 + 0.6} textAnchor="start" fontSize={2.2} fill="#5c6258" stroke="none">{shellGhost.ghostD}′</text>
      </g>
    );
  } else if (edgeDrag && edgeDrag.edge) {
    const e = edgeDrag.edge;
    const gx = e.nx * edgeDrag.offset;
    const gy = e.ny * edgeDrag.offset;
    const tickH = 0.5;
    const midX = (e.x0 + e.x1) / 2 + gx;
    const midY = (e.y0 + e.y1) / 2 + gy;
    dragAnnotations = (
      <g stroke="#5c6258" strokeWidth={0.07} fill="none" opacity={0.8} style={{ fontFamily: 'var(--font-hand)' }}>
        <line x1={midX} y1={midY} x2={midX + e.nx * 2} y2={midY + e.ny * 2} strokeDasharray="0.1 0.1" />
        <text x={midX + e.nx * 2.5} y={midY + e.ny * 2.5 + 0.5} textAnchor="middle" fontSize={1.8} fill="#5c6258" stroke="none">
          {edgeDrag.offset > 0 ? '+' : ''}{edgeDrag.offset}′
        </text>
      </g>
    );
  }

  const roomAt = (room) => (drag && drag.id === room.id ? { ...room, ...drag.ghost } : room);
  // Live size readout DURING a corner drag: big digits inside the box that
  // track every half-foot as it changes — nobody should have to read tiny
  // numbers somewhere else while their hand is mid-resize.
  const isResizing = (id) => drag && drag.id === id && drag.mode !== 'move';
  const fmtFt = (v) => String(Math.round(Number(v) * 2) / 2);
  const liveDimsText = (rect) => `${fmtFt(rect.w)} × ${fmtFt(rect.d)}′`;
  const liveDimsLabel = (rect) => {
    const text = liveDimsText(rect);
    const size = Math.max(0.9, Math.min(2.4, (rect.w - 0.6) / (text.length * LABEL_CHAR_W), rect.d * 0.5));
    return (
      <text
        x={rect.x + rect.w / 2} y={rect.y + rect.d / 2 + size * 0.35}
        textAnchor="middle" fontSize={size} fontWeight="700" fill="#1f2a26" pointerEvents="none"
        paintOrder="stroke" stroke="rgba(246,244,236,0.92)" strokeWidth={size * 0.2}
      >{text}</text>
    );
  };
  const gridStep = W > 60 ? 10 : 5;
  const gridLines = [];
  for (let gx = 0; gx <= W + 0.01; gx += gridStep) gridLines.push(<line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={D} stroke="var(--line)" strokeWidth={0.06} opacity={0.5} />);
  for (let gy = 0; gy <= D + 0.01; gy += gridStep) gridLines.push(<line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="var(--line)" strokeWidth={0.06} opacity={0.5} />);

  // Openings show on their own floor's plan — a 2nd-floor window draws on the
  // 2nd-floor layout, not the ground. (Roof openings are drawn in 3D only.)
  const openings = (spec.openings || []).filter((o) => o.wall !== 'roof' && Number(o.level || 1) === activeFloor);

  return (
    <div className="planWrap">
      <svg
        ref={svgRef}
        className="planSvg"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={(event) => { onPointerMove(event); onShellMove(event); onEdgeMove(event); onOpeningMove(event); onPanMove(event); }}
        onPointerUp={(event) => { endDrag(); endShellDrag(event); endEdgeDrag(); endOpeningDrag(); endPan(); }}
        onPointerLeave={(event) => { endDrag(); endShellDrag(event); endEdgeDrag(); endOpeningDrag(); endPan(); }}
        onClick={() => {}}
      >
        {/* the ground — oversized so panning never runs out of paper; drag it
            to move the view, double-tap to fit everything again */}
        <rect
          x={vb.x - 400} y={vb.y - 400} width={vb.w + 800} height={vb.h + 800}
          fill="var(--canvas)"
          style={{ cursor: panDrag ? 'grabbing' : 'grab' }}
          onPointerDown={startPan}
          onDoubleClick={() => setViewOverride(null)}
        />
        {gridLines}
        {/* shell / exterior wall — the footprint (editable in a building context) */}
        {fpRound ? (
          <>
            {/* rooms clip to this — the curved wall trims a room that reaches it */}
            <defs>
              <clipPath id="rzRoundShellClip">
                <ellipse cx={shellW / 2} cy={shellD / 2} rx={shellW / 2} ry={shellD / 2} />
              </clipPath>
            </defs>
            <ellipse cx={shellW / 2} cy={shellD / 2} rx={shellW / 2} ry={shellD / 2} fill={buildingContext ? 'var(--active-line)' : 'none'} fillOpacity={buildingContext ? 0.08 : 0} stroke={buildingContext ? 'var(--active-line)' : 'var(--ink3)'} strokeWidth={buildingContext ? 0.5 : 1} />
            <ellipse cx={shellW / 2} cy={shellD / 2} rx={Math.max(0, shellW / 2 - 0.7)} ry={Math.max(0, shellD / 2 - 0.7)} fill="none" stroke="var(--line2)" strokeWidth={0.12} />
          </>
        ) : fpCustom ? (
          <>
            <polygon points={fpPoly.map(([px, py]) => `${px},${py}`).join(' ')} fill={buildingContext ? 'var(--active-line)' : 'none'} fillOpacity={buildingContext ? 0.08 : 0} stroke={buildingContext ? 'var(--active-line)' : 'var(--ink3)'} strokeWidth={buildingContext ? 0.5 : 1} />
            {shellGhost && <rect x={0} y={0} width={shellW} height={shellD} fill="none" stroke="var(--active-line)" strokeWidth={0.2} strokeDasharray="1 0.6" pointerEvents="none" />}
          </>
        ) : (
          <>
            <rect x={0} y={0} width={shellW} height={shellD} fill={buildingContext ? 'var(--active-line)' : 'none'} fillOpacity={buildingContext ? 0.08 : 0} stroke={buildingContext ? 'var(--active-line)' : 'var(--ink3)'} strokeWidth={buildingContext ? 0.5 : 1} />
            <rect x={0.7} y={0.7} width={Math.max(0, shellW - 1.4)} height={Math.max(0, shellD - 1.4)} fill="none" stroke="var(--line2)" strokeWidth={0.12} />
          </>
        )}
        {buildingContext && onResizeShell && (
          <>
            <circle cx={shellW} cy={shellD} r={1.1} fill="var(--active-line)" stroke="#fff" strokeWidth={0.18} style={{ cursor: 'se-resize' }} onPointerDown={startShellDrag} />
            {shellGhost && <text x={shellW / 2} y={shellD / 2} textAnchor="middle" fontSize={2.4} fill="var(--active-line)" fontWeight="700" pointerEvents="none">{shellW}′ × {shellD}′</text>}
          </>
        )}
        {/* wall edges: grab-and-slide in a building context ("move a wall") */}
        {buildingContext && onMoveEdge && fpEdgesList.map((edge) => {
          const active = edgeDrag && edgeDrag.index === edge.index;
          const gx = active ? edge.nx * edgeDrag.offset : 0;
          const gy = active ? edge.ny * edgeDrag.offset : 0;
          return (
            <g key={edge.key}>
              {active && (
                <>
                  <line x1={edge.x0 + gx} y1={edge.y0 + gy} x2={edge.x1 + gx} y2={edge.y1 + gy} stroke="var(--active-line)" strokeWidth={0.6} strokeDasharray="1 0.6" pointerEvents="none" />
                  <line x1={edge.x0} y1={edge.y0} x2={edge.x0 + gx} y2={edge.y0 + gy} stroke="var(--active-line)" strokeWidth={0.15} strokeDasharray="0.5 0.5" pointerEvents="none" />
                  <line x1={edge.x1} y1={edge.y1} x2={edge.x1 + gx} y2={edge.y1 + gy} stroke="var(--active-line)" strokeWidth={0.15} strokeDasharray="0.5 0.5" pointerEvents="none" />
                  <text x={(edge.x0 + edge.x1) / 2 + gx + edge.nx * 2.2} y={(edge.y0 + edge.y1) / 2 + gy + edge.ny * 2.2} textAnchor="middle" fontSize={2.2} fill="var(--active-line)" fontWeight="700" pointerEvents="none">
                    {edgeDrag.offset > 0 ? '+' : ''}{edgeDrag.offset}′
                  </text>
                </>
              )}
              <line
                x1={edge.x0} y1={edge.y0} x2={edge.x1} y2={edge.y1}
                stroke="var(--active-line)" strokeWidth={1.6} strokeOpacity={active ? 0.35 : 0.001}
                style={{ cursor: edge.horizontal ? 'ns-resize' : 'ew-resize' }}
                onPointerDown={(event) => startEdgeDrag(event, edge)}
              />
            </g>
          );
        })}
        {/* the plan reflects the selection: a selected wall's edge glows */}
        {(() => {
          const em = /^wall-e(\d+)/.exec(String(selectedRoom || ''));
          if (em) {
            const edge = fpEdgesList[Number(em[1])];
            if (!edge) return null;
            return <line x1={edge.x0} y1={edge.y0} x2={edge.x1} y2={edge.y1} stroke="var(--active-line)" strokeWidth={0.7} opacity={0.9} pointerEvents="none" />;
          }
          const m = /^wall-(north|south|east|west)/.exec(String(selectedRoom || ''));
          if (!m) return null;
          const s = m[1];
          const pts = s === 'north' ? [0, 0, W, 0] : s === 'south' ? [0, D, W, D] : s === 'east' ? [W, 0, W, D] : [0, 0, 0, D];
          return <line x1={pts[0]} y1={pts[1]} x2={pts[2]} y2={pts[3]} stroke="var(--active-line)" strokeWidth={0.7} opacity={0.9} pointerEvents="none" />;
        })()}
        {/* rooms */}
        {(spec.rooms || []).map((raw) => {
          const onFloor = Number(raw.level || 1) === activeFloor;
          if (!onFloor) {
            // other floors: faint ghost for context, not interactive
            return <rect key={raw.id} x={raw.x} y={raw.y} width={raw.w} height={raw.d} fill="var(--ink3)" fillOpacity={0.1} stroke="var(--line)" strokeWidth={0.1} strokeDasharray="0.5 0.5" pointerEvents="none" />;
          }
          const room = roomAt(raw);
          const isSel = raw.id === selectedRoom;
          // On a round house an indoor room clips to the curve: it can slide
          // all the way into the "corner" and the wall trims what pokes past.
          const clipToShell = fpRound && Number(raw.level || 1) === 1
            && !['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead', 'plant', 'water', 'earthwork'].includes(raw.type);
          return (
            <g key={raw.id} style={{ cursor: drag ? 'grabbing' : 'grab' }}>
              <rect
                x={room.x} y={room.y} width={room.w} height={room.d}
                fill={PLAN_ZONE_HEX[raw.type] || '#86a0a8'}
                fillOpacity={(isSel ? 0.9 : 0.66) * roomsDim}
                stroke={isSel ? 'var(--active-line)' : 'var(--line)'}
                strokeWidth={isSel ? 0.4 : 0.18}
                clipPath={clipToShell ? 'url(#rzRoundShellClip)' : undefined}
                pointerEvents={buildingContext || siteContext ? 'none' : undefined}
                onPointerDown={(event) => startDrag(event, raw, 'move')}
                onContextMenu={(event) => { if (onContext) { event.preventDefault(); onContext(raw.id, event.clientX, event.clientY); } }}
              />
              {(() => {
                // mid-resize the room speaks in one voice: its live size
                if (isResizing(raw.id)) return liveDimsLabel(room);
                const lab = planLabelFit(raw.name, room.w, room.d, isSel);
                if (!lab) return null;
                const cx = room.x + room.w / 2;
                const cy = room.y + room.d / 2;
                const ink = planLabelInk(PLAN_ZONE_HEX[raw.type] || '#79a7a8');
                const lineH = lab.size * 1.2;
                const dimText = liveDimsText(room);
                const dimSize = Math.min(1.4, room.w / 6);
                // dims only when they fit under the name without touching it
                const showDims = lab.lines.length === 1
                  && dimText.length * dimSize * LABEL_CHAR_W <= room.w - 0.8
                  && room.d >= lab.size + dimSize + 2.4;
                return (
                  <>
                    {lab.lines.map((line, index) => (
                      <text
                        key={index}
                        x={cx}
                        y={cy - 0.3 + (index - (lab.lines.length - 1) / 2) * lineH}
                        textAnchor="middle" fontSize={lab.size} fill={ink} fontWeight="600" pointerEvents="none"
                        paintOrder="stroke" stroke={lab.halo ? 'rgba(246,244,236,0.85)' : 'none'} strokeWidth={lab.halo ? lab.size * 0.22 : 0}
                      >{line}</text>
                    ))}
                    {showDims && <text x={cx} y={cy - 0.3 + lab.size * 0.4 + dimSize + 0.35} textAnchor="middle" fontSize={dimSize} fill="#2a302d" opacity={0.75} pointerEvents="none">{dimText}</text>}
                  </>
                );
              })()}
              {isSel && ['nw', 'ne', 'sw', 'se'].map((corner) => {
                const cx = room.x + (corner.includes('e') ? room.w : 0);
                const cy = room.y + (corner.includes('s') ? room.d : 0);
                return <circle key={corner} cx={cx} cy={cy} r={0.9} fill="var(--active-line)" stroke="#fff" strokeWidth={0.15} style={{ cursor: `${corner}-resize` }} onPointerDown={(event) => startDrag(event, raw, corner)} />;
              })}
            </g>
          );
        })}
        {/* placed elements (heater, tank, garden, coop, stairs…) — dashed to
            read as objects/fixtures rather than rooms; drag + resize like rooms */}
        {(spec.elements || []).filter(planLevelFilter).map((raw) => {
          const el = roomAt(raw);
          const isSel = raw.id === selectedRoom;
          const w = Number(el.w) || 4;
          const d = Number(el.d) || 4;
          // A storey's extent plate. Its BODY is a non-interactive dashed
          // outline (so a room click hits the room, never the plate). But you
          // can still work the floor directly: drag its BORDER to move it, or a
          // CORNER dot to resize — those thin handles are the only interactive
          // parts, so rooms underneath stay clickable. (Numbers in Shape do the
          // same job.) Only the upper floors are grabbable this way.
          if (raw.category === 'floor') {
            const isSel = raw.id === selectedRoom;
            const grabbable = Number(raw.level || 1) > 1 && !buildingContext && !siteContext && Boolean(onResize);
            return (
              <g key={raw.id}>
                <rect x={el.x} y={el.y} width={w} height={d} fill="none"
                  stroke={isSel ? 'var(--active-line)' : 'var(--line)'} strokeWidth={isSel ? 0.5 : 0.3}
                  strokeDasharray="1.2 0.8" opacity={0.7} pointerEvents="none" />
                {grabbable && (
                  <>
                    {/* the border is the move handle — only the stroke is live,
                        so clicks inside (on rooms) pass straight through */}
                    <rect x={el.x} y={el.y} width={w} height={d} fill="none"
                      stroke="transparent" strokeWidth={1.6} pointerEvents="stroke"
                      style={{ cursor: drag ? 'grabbing' : 'grab' }}
                      onPointerDown={(event) => startDrag(event, raw, 'move')} />
                    {['nw', 'ne', 'sw', 'se'].map((corner) => {
                      const cx = el.x + (corner.includes('e') ? w : 0);
                      const cy = el.y + (corner.includes('s') ? d : 0);
                      return <circle key={corner} cx={cx} cy={cy} r={1} fill="var(--active-line)" stroke="#fff" strokeWidth={0.18}
                        style={{ cursor: `${corner}-resize` }} onPointerDown={(event) => startDrag(event, raw, corner)} />;
                    })}
                  </>
                )}
              </g>
            );
          }
          // In a building context most elements are backdrop — EXCEPT the ones
          // the context is FOR: foundation runs are the subject of the
          // Foundation view (drag them under whatever they carry).
          const isContextSubject = context === 'foundation' && raw.category === 'foundation';
          return (
            <g key={raw.id} style={{ cursor: drag ? 'grabbing' : 'grab' }}>
              <rect
                x={el.x} y={el.y} width={w} height={d}
                fill={PLAN_ELEMENT_HEX[raw.category] || '#8a7768'}
                fillOpacity={raw.category === 'partition' ? (isSel ? 1 : 0.95) : (isSel ? 0.92 : 0.7) * (buildingContext && !isContextSubject ? 0.25 : 1)}
                stroke={isSel ? 'var(--active-line)' : '#5a5348'}
                strokeWidth={isSel ? 0.4 : 0.22}
                strokeDasharray={raw.category === 'partition' ? undefined : '0.8 0.5'}
                pointerEvents={buildingContext && !isContextSubject ? 'none' : undefined}
                onPointerDown={(event) => startDrag(event, raw, 'move')}
                onContextMenu={(event) => { if (onContext) { event.preventDefault(); onContext(raw.id, event.clientX, event.clientY); } }}
              />
              {(() => {
                if (isResizing(raw.id)) return liveDimsLabel({ x: el.x, y: el.y, w, d });
                const lab = planLabelFit(raw.name, w, d, isSel, 1.5);
                if (!lab) return null;
                const ink = planLabelInk(PLAN_ELEMENT_HEX[raw.category] || '#8a7768');
                const lineH = lab.size * 1.2;
                return lab.lines.map((line, index) => (
                  <text
                    key={index}
                    x={el.x + w / 2}
                    y={el.y + d / 2 + 0.5 + (index - (lab.lines.length - 1) / 2) * lineH}
                    textAnchor="middle" fontSize={lab.size} fill={ink} fontWeight="600" pointerEvents="none"
                    paintOrder="stroke" stroke={lab.halo ? 'rgba(246,244,236,0.85)' : 'none'} strokeWidth={lab.halo ? lab.size * 0.22 : 0}
                  >{line}</text>
                ));
              })()}
              {isSel && ['nw', 'ne', 'sw', 'se'].map((corner) => {
                const cx = el.x + (corner.includes('e') ? w : 0);
                const cy = el.y + (corner.includes('s') ? d : 0);
                return <circle key={corner} cx={cx} cy={cy} r={0.8} fill="var(--active-line)" stroke="#fff" strokeWidth={0.15} style={{ cursor: `${corner}-resize` }} onPointerDown={(event) => startDrag(event, raw, corner)} />;
              })}
            </g>
          );
        })}
        {/* openings as white gaps on the walls — DRAGGABLE along their wall
            (windows and doors find their spot on the plan). On a custom
            footprint each gap draws on the opening's actual polygon edge. */}
        {openings.map((o) => {
          const index = (spec.openings || []).indexOf(o);
          const wide = Number(o.widthFt) || 3;
          const horizontal = o.wall === 'north' || o.wall === 'south';
          const oEdge = fpCustom ? edgeForOpening(spec, o) : null;
          const lineC = horizontal
            ? (oEdge && oEdge.horizontal ? oEdge.y0 : (o.wall === 'north' ? 0 : D))
            : (oEdge && !oEdge.horizontal ? oEdge.x0 : (o.wall === 'east' ? W : 0));
          const dragging = openingDrag && openingDrag.index === index;
          const along = dragging ? openingDrag.along : (Number(horizontal ? o.x : o.y) || 0);
          const isSel = String(selectedRoom || '') === `opening-${index}`;
          const stroke = dragging || isSel ? 'var(--active-line)' : '#e8e6dd';
          const sw = dragging || isSel ? 1.5 : 1.1;
          let x1 = horizontal ? along : lineC;
          let y1 = horizontal ? lineC : along;
          let x2 = horizontal ? along + wide : lineC;
          let y2 = horizontal ? lineC : along + wide;
          if (fpRound && o.wall !== 'roof') {
            // On a round house the opening sits ON the curve: its along-position
            // maps to that wall's quarter-arc of the ellipse, and it draws as a
            // chord hugging the arc (dragging still slides it along the arc).
            const roundPt = (a) => {
              const sideLen = horizontal ? W : D;
              const f = clamp(sideLen > 0 ? a / sideLen : 0.5, 0, 1);
              const deg = o.wall === 'south' ? 135 - 90 * f
                : o.wall === 'north' ? 225 + 90 * f
                : o.wall === 'east' ? -45 + 90 * f
                : 225 - 90 * f;
              const th = deg * Math.PI / 180;
              return [W / 2 + (W / 2) * Math.cos(th), D / 2 + (D / 2) * Math.sin(th)];
            };
            [x1, y1] = roundPt(along);
            [x2, y2] = roundPt(along + wide);
          }
          const draggable = Boolean(onMoveOpening) && !buildingContext && !siteContext;
          return (
            <g key={index}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} />
              {dragging && (
                <text
                  x={horizontal ? along + wide / 2 : lineC + (o.wall === 'east' ? -2.6 : 2.6)}
                  y={horizontal ? lineC + (o.wall === 'north' ? 2.8 : -1.6) : along + wide / 2}
                  textAnchor="middle" fontSize={2.2} fill="var(--active-line)" fontWeight="700" pointerEvents="none"
                >{along}′</text>
              )}
              {draggable && (
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="var(--active-line)" strokeWidth={2.4} strokeOpacity={0.001}
                  style={{ cursor: horizontal ? 'ew-resize' : 'ns-resize' }}
                  onPointerDown={(event) => startOpeningDrag(event, index, o)}
                />
              )}
            </g>
          );
        })}
        {/* dimensions */}
        <text x={W / 2} y={-1.2} textAnchor="middle" fontSize={2} fill="var(--ink2)">{W}′</text>
        <text x={-1.2} y={D / 2} textAnchor="middle" fontSize={2} fill="var(--ink2)" transform={`rotate(-90 ${-1.2} ${D / 2})`}>{D}′</text>
        {/* Anything living beyond this frame gets a labeled edge arrow — the
            site is never silently cut off. Tap an arrow to reframe to Site. */}
        {(() => {
          const byEdge = { left: [], right: [], top: [], bottom: [] };
          for (const el of (spec.elements || []).filter(planLevelFilter)) {
            if (!el.name) continue;
            const x = Number(el.x) || 0; const y = Number(el.y) || 0;
            const w = Number(el.w) || 4; const d = Number(el.d) || 4;
            const out = x + w < vb.x || x > vb.x + vb.w || y + d < vb.y || y > vb.y + vb.h;
            if (!out) continue;
            const cx = x + w / 2; const cy = y + d / 2;
            if (cx > vb.x + vb.w) byEdge.right.push(el.name);
            else if (cx < vb.x) byEdge.left.push(el.name);
            else if (cy > vb.y + vb.h) byEdge.bottom.push(el.name);
            else byEdge.top.push(el.name);
          }
          const fs = vb.w / 34;
          const inset = fs * 0.9;
          const goSite = () => { setPlanFrame('site'); setViewOverride(null); };
          const chip = (key, x, y, anchor, text) => (
            <text key={key} x={x} y={y} textAnchor={anchor} fontSize={fs} fontWeight="700" fill="var(--plum, #26424C)"
              paintOrder="stroke" stroke="rgba(251,250,244,0.9)" strokeWidth={fs * 0.3}
              style={{ cursor: 'pointer' }} onClick={goSite}>{text}</text>
          );
          const listOf = (names) => names.slice(0, 3).join(' · ') + (names.length > 3 ? ` +${names.length - 3}` : '');
          return [
            byEdge.right.length > 0 && chip('e-r', vb.x + vb.w - inset, vb.y + vb.h * 0.45, 'end', `${listOf(byEdge.right)} →`),
            byEdge.left.length > 0 && chip('e-l', vb.x + inset, vb.y + vb.h * 0.55, 'start', `← ${listOf(byEdge.left)}`),
            byEdge.bottom.length > 0 && chip('e-b', vb.x + vb.w / 2, vb.y + vb.h - inset, 'middle', `${listOf(byEdge.bottom)} ↓`),
            byEdge.top.length > 0 && chip('e-t', vb.x + vb.w / 2, vb.y + inset * 1.6, 'middle', `↑ ${listOf(byEdge.top)}`)
          ].filter(Boolean);
        })()}
        {dragAnnotations}
      </svg>
      <div className="planNorth">▲ N</div>
      {siteBeyondHouse && (
        <div className="planFrameToggle">
          <button type="button" className={!viewOverride && planFrame === 'house' ? 'active' : ''} title="Frame the house at working size" onClick={() => { setPlanFrame('house'); setViewOverride(null); }}>House</button>
          <button type="button" className={!viewOverride && planFrame === 'site' ? 'active' : ''} title="Frame everything — patios, outbuildings, the whole site" onClick={() => { setPlanFrame('site'); setViewOverride(null); }}>Site</button>
        </div>
      )}
      <div className="planHint">{buildingContext && onMoveEdge ? `${PLAN_CONTEXT_LABEL[context] || 'Footprint'} · drag a wall edge to move that wall · corner dot resizes the whole plan` : PLAN_CONTEXT_LABEL[context] || `${floorLabel(spec, activeFloor)} plan · drag to move, drag corners to resize (½ ft snap)`} · scroll to zoom · drag the ground to pan</div>
    </div>
  );
}

export function PlanMoveBoard({ spec, selectedRoom, selectedObject, onSelectRoom, onRename, onMoveStart, onMove, onMoveEnd, onResize, onResizeEnd, onQuickMove, onNudge, onAddRoom }) {
  const boardRef = useRef(null);
  const dragRef = useRef(null);
  const shellW = spec.shell.widthFt;
  const shellD = spec.shell.depthFt;

  function pointToFeet(event) {
    const rect = boardRef.current.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * shellW, 0, shellW),
      y: clamp(((event.clientY - rect.top) / rect.height) * shellD, 0, shellD)
    };
  }

  function startDrag(event, room) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointToFeet(event);
    dragRef.current = {
      id: room.id,
      pointerId: event.pointerId,
      offsetX: point.x - room.x,
      offsetY: point.y - room.y
    };
    onSelectRoom(room.id);
    onMoveStart();
  }

  function startResize(event, room) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: 'resize',
      id: room.id,
      pointerId: event.pointerId
    };
    onSelectRoom(room.id);
    onMoveStart();
  }

  function dragMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const room = spec.rooms.find((item) => item.id === drag.id);
    if (!room) return;
    const point = pointToFeet(event);
    if (drag.mode === 'resize') {
      // Rooms go down to 2 ft — a real reach-in closet is a 2-ft-deep room.
      const nextW = clamp(Math.round((point.x - room.x) * 2) / 2, 2, Math.max(2, shellW - room.x));
      const nextD = clamp(Math.round((point.y - room.y) * 2) / 2, 2, Math.max(2, shellD - room.y));
      dragRef.current = { ...drag, w: nextW, d: nextD };
      onResize(room.id, nextW, nextD, false);
      return;
    }
    const nextX = clamp(Math.round((point.x - drag.offsetX) * 2) / 2, 0, Math.max(0, shellW - room.w));
    const nextY = clamp(Math.round((point.y - drag.offsetY) * 2) / 2, 0, Math.max(0, shellD - room.d));
    dragRef.current = { ...drag, x: nextX, y: nextY };
    onMove(room.id, nextX, nextY, false);
  }

  function endDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const room = spec.rooms.find((item) => item.id === drag.id);
    dragRef.current = null;
    if (room && drag.mode === 'resize') {
      onResizeEnd(room.id, drag.w ?? room.w, drag.d ?? room.d);
      return;
    }
    if (room) onMoveEnd(room.id, drag.x ?? room.x, drag.y ?? room.y);
  }

  return (
    <div className="planMove">
      <div className="sectionHead"><Grid3X3 size={17} /> Plan Move Board</div>
      <label className="planNameEdit">
        <span>Name</span>
        <input value={selectedObject?.name || ''} onChange={(event) => onRename(event.target.value)} />
      </label>
      <div className="planBoard" ref={boardRef} aria-label="Drag rooms on plan">
        <span className="planNorth">N</span>
        {spec.rooms.map((room) => (
          <button
            key={room.id}
            className={room.id === selectedRoom ? `planRoom ${room.type} active` : `planRoom ${room.type}`}
            style={{
              left: `${(room.x / shellW) * 100}%`,
              top: `${(room.y / shellD) * 100}%`,
              width: `${(room.w / shellW) * 100}%`,
              height: `${(room.d / shellD) * 100}%`
            }}
            onClick={() => onSelectRoom(room.id)}
            onPointerDown={(event) => startDrag(event, room)}
            onPointerMove={dragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span>{room.name}</span>
            <i
              className="resizeHandle"
              aria-hidden="true"
              onPointerDown={(event) => startResize(event, room)}
              onPointerMove={dragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          </button>
        ))}
      </div>
      <div className="moveControls">
        <button className="secondary addPlanRoom" onClick={onAddRoom}><Plus size={14} /> Add Room</button>
        {['NW', 'N', 'NE', 'W', 'Center', 'E', 'SW', 'S', 'SE'].map((target) => (
          <button key={target} className="ghost" onClick={() => onQuickMove(target)}>{target}</button>
        ))}
      </div>
      <div className="nudgeControls">
        <button className="ghost" onClick={() => onNudge(0, -1)}>Nudge N</button>
        <button className="ghost" onClick={() => onNudge(-1, 0)}>W</button>
        <button className="ghost" onClick={() => onNudge(1, 0)}>E</button>
        <button className="ghost" onClick={() => onNudge(0, 1)}>Nudge S</button>
      </div>
    </div>
  );
}

