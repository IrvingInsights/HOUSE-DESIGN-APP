// PLACEMENT CORPUS — property test of the law of placement (src/placement.js)
// against generated designs. Not example-based: hundreds of design states ×
// move/resize targets, each checked against invariants that must hold for ANY
// design. If the app can get a placement wrong, this is where it shows up.
//
//   I1  HONORED-OR-GROWN (rect): the room lands exactly at the (post-growth)
//       target, unless the shell hit its hard cap on that axis.
//   I2  ROUND LAWFUL TRIM: an honored target keeps its center inside the
//       curve; a trimmed one settles with its center just inside.
//   I3  POLYGON ENCLOSURE: the room ends inside the real walls, or the fitter
//       genuinely had no valid placement for it.
//   I4  WORLD PRESERVATION: west/north growth shifts every other placed thing
//       by exactly the growth delta (the wall moves, the world doesn't).
//   I5  SANITY: no NaN anywhere; shell within [12,96]×[12,80].
import {
  applyBimOperations, isRoundFootprint, hasCustomFootprint, footprintPolygon,
  rectInFootprint, fitRoomInsideOutline
} from '../backend/bim-core.mjs';
import { seedSpec } from '../src/engine.js';
import { planObjectMove, planObjectResize, fitShellToRooms, OUTDOOR_TYPES, SHELL_W_MAX, SHELL_D_MAX } from '../src/placement.js';

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const range = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 2) / 2;

let pass = 0; let fail = 0;
const problems = [];
function check(ok, label, detail) {
  if (ok) { pass += 1; return; }
  fail += 1;
  if (problems.length < 12) problems.push(`${label} — ${detail}`);
}

function noNaN(value, path = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i += 1) { const p = noNaN(value[i], `${path}[${i}]`); if (p) return p; } return null; }
  if (value && typeof value === 'object') { for (const k of Object.keys(value)) { const p = noNaN(value[k], `${path}.${k}`); if (p) return p; } return null; }
  return null;
}

const apply = (spec, operations) => {
  const r = applyBimOperations(spec, { operations });
  return { spec: r.spec || r, warnings: r.warnings || [] };
};

// --- design generators -------------------------------------------------------
const OUTLINES = ['rect', 'round', 'l', 't', 'u', 'jog'];
function makeDesign(outline) {
  let s = structuredClone(seedSpec);
  const W = pick([24, 36, 48]);
  const D = pick([20, 28, 40]);
  ({ spec: s } = apply(s, [
    { type: 'set_shell', field: 'widthFt', value: String(W) },
    { type: 'set_shell', field: 'depthFt', value: String(D) }
  ]));
  const half = (v) => Math.round(v * 2) / 2;
  const shapes = {
    l: [[0, 0], [W, 0], [W, half(D * 0.55)], [half(W * 0.6), half(D * 0.55)], [half(W * 0.6), D], [0, D]],
    t: [[0, 0], [W, 0], [W, half(D * 0.5)], [half(W * 0.75), half(D * 0.5)], [half(W * 0.75), D], [half(W * 0.25), D], [half(W * 0.25), half(D * 0.5)], [0, half(D * 0.5)]],
    u: [[0, 0], [W, 0], [W, D], [half(W * 0.7), D], [half(W * 0.7), half(D * 0.45)], [half(W * 0.3), half(D * 0.45)], [half(W * 0.3), D], [0, D]],
    jog: [[1, 0], [W, 0], [W, D], [0, D], [0, Math.round(D / 2)], [1, Math.round(D / 2)]]
  };
  if (outline === 'round') ({ spec: s } = apply(s, [{ type: 'set_footprint', value: 'round' }]));
  else if (outline !== 'rect') ({ spec: s } = apply(s, [{ type: 'set_footprint', value: JSON.stringify(shapes[outline]) }]));
  // half the designs get site clutter: a foundation pad somewhere arbitrary
  // (including far west/north — the case that hid for a week), an opening,
  // sometimes a second storey
  if (rnd() < 0.5) {
    ({ spec: s } = apply(s, [{ type: 'add_element', name: 'Slab pad', category: 'foundation', construction: 'slabpad', x: range(-30, W + 10), y: range(-20, D + 8), w: 16, d: 16, h: 0.7 }]));
  }
  if (rnd() < 0.5) ({ spec: s } = apply(s, [{ type: 'add_opening', wall: pick(['north', 'south', 'east', 'west']), openingType: 'window', x: 4, y: 4 }]));
  if (rnd() < 0.3 && outline === 'rect') ({ spec: s } = apply(s, [{ type: 'set_shell', field: 'storeys', value: '2' }]));
  return s;
}

// --- the sweep ----------------------------------------------------------------
const CASES = 420;
for (let i = 0; i < CASES; i += 1) {
  const outline = OUTLINES[i % OUTLINES.length];
  const before = makeDesign(outline);
  const rooms = (before.rooms || []).filter((r) => Number(r.level || 1) === 1);
  const room = pick(rooms);
  if (!room) continue;
  const W0 = Number(before.shell.widthFt); const D0 = Number(before.shell.depthFt);
  // targets: everywhere a user could drop — deep west/north, corners, inside,
  // past east/south, absurdly far out
  const tx = pick([range(-25, -1), 0, range(0, W0), range(W0, W0 + 20), -40]);
  const ty = pick([range(-18, -1), 0, range(0, D0), range(D0, D0 + 14), -30]);
  const doResize = rnd() < 0.25;
  const plan = doResize
    ? planObjectResize(before, room.id, tx, ty, Number(room.w), Number(room.d))
    : planObjectMove(before, room.id, tx, ty);
  if (!plan) { check(false, `case ${i}`, 'planner returned null for a real room'); continue; }
  const fx = doResize ? plan.rx : plan.fx;
  const fy = doResize ? plan.ry : plan.fy;
  const { spec: after } = apply(before, plan.ops);
  const landed = after.rooms.find((r) => r.id === room.id);
  const label = `case ${i} [${outline}${doResize ? ' resize' : ' move'}] target ${tx},${ty}`;

  // I5 sanity
  const nan = noNaN(after);
  check(!nan, label, `NaN at ${nan}`);
  const W1 = Number(after.shell.widthFt); const D1 = Number(after.shell.depthFt);
  check(W1 >= 12 && W1 <= SHELL_W_MAX && D1 >= 12 && D1 <= SHELL_D_MAX, label, `shell out of caps ${W1}x${D1}`);
  if (!landed) { check(false, label, 'room vanished'); continue; }

  const lx = Number(landed.x); const ly = Number(landed.y);
  if (outline === 'rect') {
    // I1: honored exactly, unless the cap bit on that axis
    const capX = (plan.grow && W0 + plan.grow.dx >= SHELL_W_MAX) || fx > SHELL_W_MAX + 8 || fx < -4;
    const capY = (plan.grow && D0 + plan.grow.dy >= SHELL_D_MAX) || fy > SHELL_D_MAX + 8 || fy < -4;
    if (!capX) check(Math.abs(lx - fx) <= 0.05, label, `x not honored: wanted ${fx}, landed ${lx}`);
    if (!capY) check(Math.abs(ly - fy) <= 0.05, label, `y not honored: wanted ${fy}, landed ${ly}`);
  } else if (outline === 'round') {
    // I2: center inside the curve (honored targets stay put)
    const a = W1 / 2; const b = D1 / 2;
    const cx = lx + Number(landed.w) / 2; const cy = ly + Number(landed.d) / 2;
    const v = ((cx - a) / a) ** 2 + ((cy - b) / b) ** 2;
    check(v <= 0.9702 ** 2 + 0.08, label, `round center escaped the curve: v=${v.toFixed(3)}`);
    const tcx = fx + Number(room.w) / 2; const tcy = fy + Number(room.d) / 2;
    const tv = ((tcx - a) / a) ** 2 + ((tcy - b) / b) ** 2;
    if (tv <= 0.94) {
      check(Math.abs(lx - fx) <= 0.05 && Math.abs(ly - fy) <= 0.05, label, `inside-curve drop not honored: wanted ${fx},${fy} landed ${lx},${ly}`);
    }
  } else {
    // I3: inside the real walls, or the fitter genuinely had nothing
    const poly = footprintPolygon(after);
    const inside = rectInFootprint(poly, { x: lx, y: ly, w: Number(landed.w), d: Number(landed.d) });
    const fitterGaveUp = fitRoomInsideOutline(after, landed) === null && !inside;
    check(inside || fitterGaveUp, label, `outside the polygon at ${lx},${ly} (${Number(landed.w)}x${Number(landed.d)})`);
  }

  // I4: growth preserved the world — every OTHER object shifted by exactly (dx,dy)
  if (plan.grow) {
    const { dx, dy } = plan.grow;
    for (const r0 of before.rooms) {
      if (r0.id === room.id || Number(r0.level || 1) !== 1) continue;
      const r1 = after.rooms.find((r) => r.id === r0.id);
      if (!r1) continue;
      check(Math.abs(Number(r1.x) - (Number(r0.x) + dx)) <= 0.05 && Math.abs(Number(r1.y) - (Number(r0.y) + dy)) <= 0.05,
        label, `world moved: room ${r0.id} ${r0.x},${r0.y} -> ${r1.x},${r1.y} (growth ${dx},${dy})`);
    }
    for (const e0 of (before.elements || [])) {
      if (e0.category !== 'foundation') continue; // foundations must never drift off their footings
      const e1 = (after.elements || []).find((e) => e.id === e0.id);
      if (!e1) continue;
      check(Math.abs(Number(e1.x) - (Number(e0.x) + dx)) <= 0.05 && Math.abs(Number(e1.y) - (Number(e0.y) + dy)) <= 0.05,
        label, `foundation drifted: ${e0.id} ${e0.x},${e0.y} -> ${e1.x},${e1.y} (growth ${dx},${dy})`);
    }
    // openings stay on their spot on the wall: N/S walls shift along x,
    // E/W walls along y, skylights both
    (before.openings || []).forEach((o0, oi) => {
      const o1 = (after.openings || [])[oi];
      if (!o1 || o1.wall !== o0.wall) return;
      const expX = (Number(o0.x) || 0) + (o0.wall === 'roof' || o0.wall === 'north' || o0.wall === 'south' ? dx : 0);
      const expY = (Number(o0.y) || 0) + (o0.wall === 'roof' || o0.wall === 'east' || o0.wall === 'west' ? dy : 0);
      // the engine clamps openings onto their (possibly resized) wall — allow that
      const wallLen = o0.wall === 'north' || o0.wall === 'south' ? W1 : D1;
      const wide = Number(o0.widthFt) || 3;
      const clampAlong = (v) => Math.min(Math.max(v, 0.2), Math.max(0.2, wallLen - wide - 0.2));
      const okX = Math.abs((Number(o1.x) || 0) - expX) <= 0.05 || Math.abs((Number(o1.x) || 0) - clampAlong(expX)) <= 0.05;
      const okY = Math.abs((Number(o1.y) || 0) - expY) <= 0.05 || Math.abs((Number(o1.y) || 0) - clampAlong(expY)) <= 0.05;
      check(okX && okY, label, `opening ${oi} (${o0.wall}) drifted: ${o0.x},${o0.y} -> ${o1.x},${o1.y} expected ~${expX},${expY}`);
    });
  }
}

// --- the FIT law: walls hug the rooms; the world (pads included) holds -------
//   F1 after fit, shell == bounding box of ground indoor rooms (caps aside)
//   F2 the world is preserved: rooms, elements (patio/carport pads!), openings
//      all shift by exactly the re-anchor delta — a pad WEST of the rooms ends
//      up OUTSIDE the shell (no roof or wall over it)
//   F3 idempotent: fitting a fitted house is a no-op
for (let i = 0; i < 90; i += 1) {
  let s = makeDesign('rect');
  const W0 = Number(s.shell.widthFt); const D0 = Number(s.shell.depthFt);
  // manufacture Daniel's situation: grow the shell by dropping a room far
  // out, so the vacated side leaves slack; sprinkle an outdoor pad nearby
  const rooms = s.rooms.filter((r) => Number(r.level || 1) === 1);
  const mover = pick(rooms);
  ({ spec: s } = apply(s, [{ type: 'add_element', name: 'Patio pad', category: 'foundation', construction: 'slabpad', x: range(-28, -12), y: range(0, D0 - 8), w: 10, d: 10, h: 0.6 }]));
  const plan1 = planObjectMove(s, mover.id, range(-24, -10), range(0, D0 - Number(mover.d)));
  ({ spec: s } = apply(s, plan1.ops));
  const fit = fitShellToRooms(s);
  const label = `fit case ${i}`;
  if (!fit) { // nothing to fit is legal only if the shell already hugs the rooms
    const ground = s.rooms.filter((r) => Number(r.level || 1) === 1 && !OUTDOOR_TYPES.has(r.type));
    const maxX = Math.max(...ground.map((r) => Number(r.x) + Number(r.w)));
    const maxY = Math.max(...ground.map((r) => Number(r.y) + Number(r.d)));
    check(Math.abs(Number(s.shell.widthFt) - maxX) < 1.1 && Math.abs(Number(s.shell.depthFt) - maxY) < 1.1, label, `fit refused but slack exists (shell ${s.shell.widthFt}x${s.shell.depthFt}, rooms to ${maxX}x${maxY})`);
    continue;
  }
  const before = s;
  const { spec: after } = apply(s, fit.ops);
  const nan = noNaN(after);
  check(!nan, label, `NaN at ${nan}`);
  // F1 — shell hugs the rooms
  const ground = after.rooms.filter((r) => Number(r.level || 1) === 1 && !OUTDOOR_TYPES.has(r.type));
  const minX = Math.min(...ground.map((r) => Number(r.x)));
  const minY = Math.min(...ground.map((r) => Number(r.y)));
  const maxX = Math.max(...ground.map((r) => Number(r.x) + Number(r.w)));
  const maxY = Math.max(...ground.map((r) => Number(r.y) + Number(r.d)));
  check(Math.abs(minX) <= 0.1 && Math.abs(minY) <= 0.1, label, `rooms not re-anchored: min ${minX},${minY}`);
  const W1 = Number(after.shell.widthFt); const D1 = Number(after.shell.depthFt);
  check(W1 >= maxX - 0.1 && W1 <= Math.max(12, maxX + 1.1), label, `shell width ${W1} vs rooms ${maxX}`);
  check(D1 >= maxY - 0.1 && D1 <= Math.max(12, maxY + 1.1), label, `shell depth ${D1} vs rooms ${maxY}`);
  // F2 — the pad kept its place in the world (same offset relative to rooms)
  const pad0 = (before.elements || []).find((e) => e.name === 'Patio pad');
  const pad1 = (after.elements || []).find((e) => e.name === 'Patio pad');
  const m0 = before.rooms.find((r) => r.id === mover.id);
  const m1 = after.rooms.find((r) => r.id === mover.id);
  if (pad0 && pad1 && m0 && m1) {
    const rel0 = [Number(pad0.x) - Number(m0.x), Number(pad0.y) - Number(m0.y)];
    const rel1 = [Number(pad1.x) - Number(m1.x), Number(pad1.y) - Number(m1.y)];
    check(Math.abs(rel0[0] - rel1[0]) <= 0.1 && Math.abs(rel0[1] - rel1[1]) <= 0.1, label, `pad drifted relative to its room: ${rel0} -> ${rel1}`);
  }
  // F3 — idempotent
  const again = fitShellToRooms(after);
  check(!again || (Math.abs(again.dx) < 0.6 && Math.abs(again.dy) < 0.6 && again.slackW < 1.1 && again.slackD < 1.1), label, `fit not idempotent: ${JSON.stringify(again && { dx: again.dx, dy: again.dy, slackW: again.slackW, slackD: again.slackD })}`);
}

console.log(`placement corpus: ${pass} checks passed, ${fail} failed (${CASES} move/resize + 90 fit cases)`);
if (problems.length) {
  console.log('first failures:');
  problems.forEach((p) => console.log('  ' + p));
  process.exit(1);
}
