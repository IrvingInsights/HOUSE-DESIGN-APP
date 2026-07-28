// OUTBUILDING ROOFS — a wall rises to meet its roof.
//
// Daniel, 2026-07-27: "None meet the walls properly." Every outbuilding wall
// was built to a single height and the roof was then tilted above them,
// leaving open daylight on the high side (up to 7.2 ft on the shapes covered
// here) plus a raking gap down both flanks. The walls now follow the roof
// plane instead of a number — the same law the house obeys with its
// north/south wall heights, and the same technique as the gable-end infill.
//
// This battery rebuilds the SHIPPED roof panel with three's own rotation
// maths, solves its underside as a plane, and checks the wall top against it
// along every side of every wall: no daylight, and no wall piercing the roof.
// The formula under test is replicated here; the plane it is checked against
// is not — it comes from the real transform, which is where a sign error or a
// wrong half-thickness would actually hide.
//
// Run: node tools/outbuilding_roof_test.mjs
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

let checks = 0;
const fails = [];
const fail = (msg) => fails.push(msg);

// ── the geometry the app ships (mirrors src/threeScene.jsx, outbuilding) ────
function outbuilding(el, low) {
  const obH = Math.max(6, Number(el.h) || 9);
  const T = 0.5;
  const obOv = 1;
  const ox0 = el.x; const oz0 = el.y;
  const ox1 = el.x + el.w; const oz1 = el.y + el.d;
  const fallsAlongZ = low === 'north' || low === 'south';
  const runFt = fallsAlongZ ? el.d + obOv * 2 : el.w + obOv * 2;
  const rise = Math.max(0.8, runFt * 0.18);
  const obSlope = rise / runFt;
  const obCx = (ox0 + ox1) / 2; const obCz = (oz0 + oz1) / 2;
  const obMid = obH + rise / 2;
  const obUnder = 0.15 * Math.hypot(rise, runFt) / runFt;
  const roofTopAt = (x, z) => {
    const u = fallsAlongZ
      ? (z - obCz) * (low === 'north' ? 1 : -1)
      : (x - obCx) * (low === 'west' ? 1 : -1);
    return Math.max(1, obMid + u * obSlope - obUnder);
  };
  return { el, low, obH, T, obOv, ox0, oz0, ox1, oz1, fallsAlongZ, runFt, rise, obCx, obCz, obMid, roofTopAt };
}

// The truth: the real panel, positioned and rotated the way the app does it,
// its underside solved as a plane. Nothing here reuses the formula above.
function undersideOf(g) {
  const { el, low, obOv, obMid, obCx, obCz, fallsAlongZ, rise, runFt } = g;
  const W = el.w + obOv * 2; const D = el.d + obOv * 2;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D));
  mesh.position.set(obCx, obMid, obCz);
  if (fallsAlongZ) mesh.rotation.x = Math.atan2(rise, runFt) * (low === 'north' ? -1 : 1);
  else mesh.rotation.z = Math.atan2(rise, runFt) * (low === 'west' ? 1 : -1);
  mesh.updateMatrixWorld(true);
  const at = (lx, lz) => new THREE.Vector3(lx, -0.15, lz).applyMatrix4(mesh.matrixWorld);
  const a = at(-W / 2, -D / 2); const b = at(W / 2, -D / 2); const c = at(-W / 2, D / 2);
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
  return (x, z) => a.y - (n.x * (x - a.x) + n.z * (z - a.z)) / n.y;
}

const SHAPES = [
  { w: 12, d: 10, h: 9 }, { w: 24, d: 20, h: 12 }, { w: 8, d: 8, h: 7 },
  { w: 30, d: 12, h: 14 }, { w: 10, d: 26, h: 8 }, { w: 16, d: 16, h: 10 },
  { w: 6, d: 40, h: 9 }, { w: 40, d: 6, h: 11 }
];
const FALLS = ['north', 'south', 'east', 'west'];
const TOL_PIERCE = 0.001;   // a wall may never rise past the roof
const TOL_GAP = 0.02;       // nor sit visibly below it

let worst = 0;
let widestOldWedge = 0;
for (const low of FALLS) {
  for (const shape of SHAPES) {
    const g = outbuilding({ x: 5, y: 7, ...shape }, low);
    const under = undersideOf(g);
    const sides = [
      ['North', true, g.oz0 + g.T / 2], ['South', true, g.oz1 - g.T / 2],
      ['West', false, g.ox0 + g.T / 2], ['East', false, g.ox1 - g.T / 2]
    ];
    for (const [side, horizontal, cross] of sides) {
      const a0 = horizontal ? g.ox0 : g.oz0;
      const span = horizontal ? g.el.w : g.el.d;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const a = a0 + span * t;
        const x = horizontal ? a : cross;
        const z = horizontal ? cross : a;
        const top = g.roofTopAt(x, z);
        const roof = under(x, z);
        const gap = roof - top;
        worst = Math.max(worst, Math.abs(gap));
        checks++;
        if (gap < -TOL_PIERCE) fail(`${low}/${shape.w}x${shape.d}x${shape.h} ${side} @${a.toFixed(1)}: wall pierces the roof by ${(-gap).toFixed(3)} ft`);
        else if (gap > TOL_GAP) fail(`${low}/${shape.w}x${shape.d}x${shape.h} ${side} @${a.toFixed(1)}: ${gap.toFixed(3)} ft of daylight between wall and roof`);
      }
    }
    // What the old one-height-fits-all wall left open at the high side.
    const hx = g.fallsAlongZ ? g.obCx : (low === 'west' ? g.ox1 - g.T / 2 : g.ox0 + g.T / 2);
    const hz = g.fallsAlongZ ? (low === 'north' ? g.oz1 - g.T / 2 : g.oz0 + g.T / 2) : g.obCz;
    widestOldWedge = Math.max(widestOldWedge, under(hx, hz) - g.obH);
  }
}


// ── JOINED STRUCTURES ARE ONE BUILDING ─────────────────────────────────────
// Structures whose footprints share an edge are ONE building: one roof over
// the combined footprint, and no wall where they meet. Nothing names anything
// — the law is adjacency, so it holds for any building anywhere. Replicates
// the grouping, the shared-edge cut, and the group roof plane from
// src/threeScene.jsx, and checks every member against the ONE plane.
const TOUCH = 0.35;
const isYes = (v) => v === true || ['yes', 'true', '1', 'on'].includes(String(v ?? '').toLowerCase());
const structuresTouch = (a, b) => {
  const overX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overZ = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  return (overX > 1 && overZ > -TOUCH) || (overZ > 1 && overX > -TOUCH);
};
const groupOf = (all) => {
  const els = all.filter((e) => !isYes(e.standsAlone));
  const parent = new Map(els.map((e) => [e.id, e.id]));
  const find = (id) => { let r = id; while (parent.get(r) !== r) r = parent.get(r); return r; };
  for (let i = 0; i < els.length; i += 1) {
    for (let j = i + 1; j < els.length; j += 1) {
      if (!structuresTouch(els[i], els[j])) continue;
      const ra = find(els[i].id); const rb = find(els[j].id);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  const bucket = new Map();
  for (const e of els) { const r = find(e.id); if (!bucket.has(r)) bucket.set(r, []); bucket.get(r).push(e); }
  return [...bucket.values()];
};
const sharedOn = (el, sibs, side) => {
  const ox0 = el.x; const oz0 = el.y; const ox1 = el.x + el.w; const oz1 = el.y + el.d;
  const out = [];
  for (const s of sibs) {
    const sx0 = s.x; const sz0 = s.y; const sx1 = s.x + s.w; const sz1 = s.y + s.d;
    if (side === 'North' && Math.abs(sz1 - oz0) <= TOUCH) out.push([Math.max(ox0, sx0), Math.min(ox1, sx1)]);
    if (side === 'South' && Math.abs(sz0 - oz1) <= TOUCH) out.push([Math.max(ox0, sx0), Math.min(ox1, sx1)]);
    if (side === 'West' && Math.abs(sx1 - ox0) <= TOUCH) out.push([Math.max(oz0, sz0), Math.min(oz1, sz1)]);
    if (side === 'East' && Math.abs(sx0 - ox1) <= TOUCH) out.push([Math.max(oz0, sz0), Math.min(oz1, sz1)]);
  }
  return out.filter(([a, b]) => b - a > 0.05);
};
const keepLen = (from, to, shared) => shared
  .reduce((segs, [g0, g1]) => segs.flatMap(([s0, s1]) => (
    g1 <= s0 || g0 >= s1 ? [[s0, s1]] : [...(g0 > s0 ? [[s0, g0]] : []), ...(g1 < s1 ? [[g1, s1]] : [])]
  )), [[from, to]])
  .reduce((n, [a, b]) => n + (b - a), 0);

// Structures that TOUCH are one building — nothing is typed in to say so.
// First pair is to the foot from a real design: 28→48 x 31.5→38.2 against 28→48 x 38→51.3.
const PAIRS = [
  [{ id: 'workshop', x: 28, y: 31.5, w: 20, d: 6.7, h: 9 }, { id: 'bay', x: 28, y: 38, w: 20, d: 13.3, h: 0.3 }],
  [{ id: 'a', x: 0, y: 0, w: 12, d: 10, h: 9 }, { id: 'b', x: 12, y: 0, w: 8, d: 10, h: 10 }],   // side by side, east/west
  [{ id: 'p', x: 4, y: 4, w: 10, d: 10, h: 8 }, { id: 'q', x: 4, y: 14.2, w: 10, d: 6, h: 8 }]    // a hairline gap still counts
];
for (const pair of PAIRS) {
  for (const low of FALLS) {
    const groups = groupOf(pair);
    checks++;
    if (groups.length !== 1) { fail(`joins: ${pair.map((e) => e.id).join('+')} should be ONE building, got ${groups.length}`); continue; }
    const members = groups[0];
    const bbox = {
      x: Math.min(...members.map((m) => m.x)), y: Math.min(...members.map((m) => m.y)),
      w: Math.max(...members.map((m) => m.x + m.w)) - Math.min(...members.map((m) => m.x)),
      d: Math.max(...members.map((m) => m.y + m.d)) - Math.min(...members.map((m) => m.y)),
      h: Math.max(...members.map((m) => Math.max(6, m.h)))
    };
    const g = outbuilding(bbox, low);          // ONE roof, over the whole footprint
    const under = undersideOf(g);
    for (const m of members) {
      const sides = [
        ['North', true, m.y + g.T / 2], ['South', true, m.y + m.d - g.T / 2],
        ['West', false, m.x + g.T / 2], ['East', false, m.x + m.w - g.T / 2]
      ];
      const sibs = members.filter((o) => o.id !== m.id);
      let sharedLen = 0;
      for (const [side, horizontal, cross] of sides) {
        const a0 = horizontal ? m.x : m.y;
        const span = horizontal ? m.w : m.d;
        const shared = sharedOn(m, sibs, side);
        sharedLen += span - keepLen(a0, a0 + span, shared);
        for (let t = 0; t <= 1.0001; t += 0.1) {   // every wall top on the ONE plane
          const a = a0 + span * t;
          const x = horizontal ? a : cross; const z = horizontal ? cross : a;
          const gap = under(x, z) - g.roofTopAt(x, z);
          worst = Math.max(worst, Math.abs(gap));
          checks++;
          if (gap < -TOL_PIERCE || gap > TOL_GAP) fail(`joins ${low}: ${m.id} ${side} @${a.toFixed(1)} off the shared roof plane by ${gap.toFixed(3)} ft`);
        }
      }
      checks++;
      if (sharedLen <= 0.05) fail(`joins ${low}: ${m.id} kept a full wall against its sibling — the building is still split`);
    }
  }
}
// A structure that touches nothing keeps its own roof.
checks++;
if (groupOf([{ id: 'lone', x: 0, y: 0, w: 8, d: 8, h: 8 }]).some((g) => g.length > 1)) fail('a lone structure must not be grouped');
// Two structures far apart are two buildings, however they are ordered.
checks++;
if (groupOf([{ id: 'far1', x: 0, y: 0, w: 8, d: 8, h: 8 }, { id: 'far2', x: 40, y: 40, w: 8, d: 8, h: 8 }]).length !== 2) fail('structures that do not touch must stay separate buildings');
// standsAlone is the exception, and it is a fact about ONE structure, never a
// pointer at another. The one that opts out is not in anybody's building.
checks++;
const optedOut = groupOf([{ id: 'x', x: 0, y: 0, w: 10, d: 10, h: 9 }, { id: 'y', x: 10, y: 0, w: 10, d: 10, h: 9, standsAlone: 'yes' }]);
if (optedOut.some((g) => g.length > 1) || optedOut.flat().some((m) => m.id === 'y')) fail('standsAlone must split a touching pair back into two buildings');
// Three in a row are ONE building — the law chains.
checks++;
if (groupOf([{ id: 'r1', x: 0, y: 0, w: 8, d: 8, h: 9 }, { id: 'r2', x: 8, y: 0, w: 8, d: 8, h: 9 }, { id: 'r3', x: 16, y: 0, w: 8, d: 8, h: 9 }]).length !== 1) fail('three structures in a row must be one building');

// ── ONE BUILDING, ONE ROOF ─────────────────────────────────────────────────
// A structure that is part of a building must be roofed by the building and
// by nothing else. The canopy block roofs anything carrying a roofType, which
// is correct for a carport standing alone and a second roof layer the moment
// that carport is built against something. Held against the source, because
// the scene builder needs a browser and this battery must stay free to run.
const sceneSrc = readFileSync(new URL('../src/threeScene.jsx', import.meta.url), 'utf8');
const canopyGate = sceneSrc.split('\n').find((l) => l.trim().startsWith('if (canopyKind'));
checks++;
if (!canopyGate) fail('cannot find the canopy gate in threeScene.jsx — has it been renamed?');
else if (!canopyGate.includes('!joinOf(element)')) fail('the canopy is not gated on !joinOf — a structure joined into a building gets a second roof laid over the first');
checks++;
if (!/const joinOf = /.test(sceneSrc)) fail('joinOf is gone — nothing decides which structures are one building');
checks++;
if (/joinsId/.test(sceneSrc)) fail('joinsId is back — the building law must be adjacency, not a pointer at another object');

console.log(`outbuilding roofs: ${checks} checks across ${FALLS.length} fall directions × ${SHAPES.length} shapes`);
console.log(`  worst |wall top − roof underside| = ${worst.toFixed(5)} ft (${(worst * 12).toFixed(3)} in)`);
console.log(`  widest wedge the flat-wall build used to leave open: ${widestOldWedge.toFixed(2)} ft`);
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails.slice(0, 20)) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('  ✓ every wall rises to meet its roof, none pierces it, and a joined structure is roofed once.');
