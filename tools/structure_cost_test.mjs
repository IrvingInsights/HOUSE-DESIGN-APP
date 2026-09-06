// JOINED STRUCTURES ARE PRICED AS ONE BUILDING — and a workshop can wear plywood.
//
// Daniel, July 2026: "Joining changes the drawing, not the costing. The engine
// still prices two structures, so a shared wall is counted twice." The 3D
// scene had built no wall on a shared edge since July; the receipts kept
// charging for it on both sides. The law (structureGroups) now lives in
// bim-core and the receipts read it: a shared stretch prices no wall, exactly
// the way an open side prices none. And the wall-skin list — which was the
// ROOF list — now carries the skins a workshop actually wears.
//
// Run: node tools/structure_cost_test.mjs
import { emptyLandSpec, deriveDesign, getWallSections, structureGroups, structureSharedLf, OUTBUILDING_CONSTRUCTION, WALL_SKINS } from '../src/engine.js';
import { applyBimOperations } from '../backend/bim-core.mjs';

let checks = 0;
const fails = [];
const ok = (cond, label) => { checks += 1; if (!cond) fails.push(label); };

const land = (elements) => { const s = emptyLandSpec(); s.elements = elements; return s; };
const outdoors = (s) => deriveDesign(s, getWallSections(s)).cost.outdoors;
const WALL_SHARE = 0.33;
const rate = (k) => OUTBUILDING_CONSTRUCTION[k].costPsf;

// ── two sheds side by side ─────────────────────────────────────────────────
{
  const A = { id: 'a', name: 'Bay', category: 'outbuilding', x: 60, y: 10, w: 12, d: 10, h: 9, construction: 'stick', level: 1 };
  const B = { id: 'b', name: 'Room', category: 'outbuilding', x: 72, y: 10, w: 8, d: 10, h: 9, construction: 'stick', level: 1 };
  const apart = outdoors(land([A, { ...B, x: 100 }]));
  const joined = outdoors(land([A, B]));
  const alone = outdoors(land([A])) + outdoors(land([B]));
  ok(Math.abs(apart - alone) < 0.01, 'two structures that do not touch cost the sum of the two');
  ok(joined < apart, `joined costs less than apart (${joined} vs ${apart})`);
  // Exactly the shared wall, off the wall third, on BOTH sides — 10 ft of
  // A's 44 ft perimeter, 10 ft of B's 36 ft.
  const expect = 120 * rate('stick') * (1 - WALL_SHARE * 10 / 44) + 80 * rate('stick') * (1 - WALL_SHARE * 10 / 36);
  ok(Math.abs(joined - expect) < 0.01, `the saving is the shared wall and nothing else (got ${joined}, expected ${expect.toFixed(2)})`);
  const groups = structureGroups(land([A, B]));
  ok(structureSharedLf(A, groups.get('a')) === 10 && structureSharedLf(B, groups.get('b')) === 10, 'each side shares 10 ft');
  // Declare them separate and the wall — and its price — come back.
  const split = outdoors(land([A, { ...B, standsAlone: 'yes' }]));
  ok(Math.abs(split - apart) < 0.01, 'standsAlone puts the wall back on the receipt');
  // A hairline gap still counts as touching (hand-dragged structures never land flush).
  const gap = outdoors(land([A, { ...B, x: 72.2 }]));
  ok(Math.abs(gap - joined) < 0.01, 'a hairline gap is still one building');
}

// ── a partial edge shares only the stretch that touches ────────────────────
{
  const A = { id: 'a', name: 'Barn', category: 'outbuilding', x: 60, y: 10, w: 24, d: 18, h: 14, construction: 'pole', level: 1 };
  const B = { id: 'b', name: 'Lean-to', category: 'outbuilding', x: 66, y: 28, w: 10, d: 6, h: 8, construction: 'shed', level: 1 };  // against 10 ft of the barn's 24 ft south side
  const groups = structureGroups(land([A, B]));
  ok(structureSharedLf(A, groups.get('a')) === 10, `the barn shares 10 ft of its south side (got ${structureSharedLf(A, groups.get('a'))})`);
  ok(structureSharedLf(B, groups.get('b')) === 10, 'the lean-to shares its whole north side');
  const expect = 24 * 18 * rate('pole') * (1 - WALL_SHARE * 10 / 84) + 60 * rate('shed') * (1 - WALL_SHARE * 10 / 32);
  ok(Math.abs(outdoors(land([A, B])) - expect) < 0.01, 'and the receipt takes off exactly those stretches');
}

// ── open sides and shared edges add up, never past the whole wall third ────
{
  const A = { id: 'a', name: 'Bay', category: 'outbuilding', x: 60, y: 10, w: 12, d: 10, h: 9, construction: 'stick', openNorth: 'yes', openSouth: 'yes', openWest: 'yes', level: 1 };
  const B = { id: 'b', name: 'Room', category: 'outbuilding', x: 72, y: 10, w: 8, d: 10, h: 9, construction: 'stick', level: 1 };
  const joined = outdoors(land([A, B]));
  const floorOnlyA = 120 * rate('stick') * (1 - WALL_SHARE);   // every side open or shared: the whole third comes off
  const expectB = 80 * rate('stick') * (1 - WALL_SHARE * 10 / 36);
  ok(Math.abs(joined - (floorOnlyA + expectB)) < 0.01, `a bay with three open sides and one shared has no walls to price (got ${joined}, expected ${(floorOnlyA + expectB).toFixed(2)})`);
}

// ── the receipts say what they did ─────────────────────────────────────────
{
  const A = { id: 'a', name: 'Bay', category: 'outbuilding', x: 60, y: 10, w: 12, d: 10, h: 9, construction: 'stick', level: 1 };
  const d = deriveDesign(land([A]), getWallSections(land([A])));
  const line = (d.receipts?.systems?.outdoors || []).find((l) => /Outbuildings/.test(l.label || ''));
  ok(line && /shares with a joined structure/.test(line.note || ''), 'the outbuildings receipt line says a shared edge is not priced');
}

// ── plywood is a wall skin ─────────────────────────────────────────────────
{
  ok(WALL_SKINS.plywood && WALL_SKINS.plywood.texture === 'wood', 'plywood is on the skin list');
  ok(WALL_SKINS.polycarb && WALL_SKINS.polycarb.softens && WALL_SKINS.polycarb.combustible, 'polycarbonate is still there, and marked as a skin that softens');
  ok(WALL_SKINS.metal && !WALL_SKINS.metal.combustible, 'metal is not combustible');
  const s = land([{ id: 'ws', name: 'Workshop', category: 'outbuilding', x: 60, y: 10, w: 16, d: 12, h: 9, construction: 'stick', level: 1 }]);
  const r = applyBimOperations(s, { operations: [{ type: 'update_object', targetId: 'ws', field: 'wallCovering', value: 'plywood' }] });
  ok(r.spec.elements[0].wallCovering === 'plywood', 'update_object wallCovering=plywood lands (the op path accepts a wall-only skin)');
  const bad = applyBimOperations(s, { operations: [{ type: 'update_object', targetId: 'ws', field: 'wallCovering', value: 'unobtainium' }] });
  ok(!bad.spec.elements[0].wallCovering, 'a skin that is not on the list is refused, not stored');
  const ridge = applyBimOperations(s, { operations: [
    { type: 'update_object', targetId: 'ws', field: 'roofShape', value: 'gable' },
    { type: 'update_object', targetId: 'ws', field: 'roofRidge', value: 'ns' },
    { type: 'update_object', targetId: 'ws', field: 'roofRidgeFt', value: '4' },
    { type: 'update_object', targetId: 'ws', field: 'heatShield', value: 'yes' }
  ] }).spec.elements[0];
  ok(ridge.roofShape === 'gable' && ridge.roofRidge === 'ns' && ridge.roofRidgeFt === 4 && ridge.heatShield === 'yes', 'the new structure and heater fields all land through the op path');
}

console.log(`structure cost: ${checks} checks`);
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('  ✓ a shared wall is priced once — that is, never — and a workshop can be skinned in plywood.');
