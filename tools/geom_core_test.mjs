// Headless tests for the footprint geometry core (bim-core.mjs).
// Run: node tools/geom_core_test.mjs   (companion: tools/op_smoke_test.mjs)
import {
  footprintRect, footprintPolygon, normalizeFootprint, isRectFootprint, hasCustomFootprint,
  footprintEdges, polygonArea, polygonPerimeter, footprintBounds, pointInFootprint,
  decomposeFootprint, rectInFootprint, subtractRect, subtractRectFromFootprint,
  expandFootprint, moveFootprintEdge, splitFootprintEdge, applyBimOperations
} from '../backend/bim-core.mjs';

let pass = 0, fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass += 1; console.log(`  ok  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label} ${extra}`); }
}
function near(a, b, eps = 0.01) { return Math.abs(a - b) <= eps; }

// --- rect basics ---
const rect = footprintRect({ widthFt: 36, depthFt: 28 });
ok(polygonArea(rect) === 36 * 28, 'rect area');
ok(polygonPerimeter(rect) === 2 * (36 + 28), 'rect perimeter');
ok(isRectFootprint(rect), 'rect isRect');

const spec = { shell: { widthFt: 36, depthFt: 28, wallHeightFt: 10 }, systems: { envelope: 'straw bale' }, rooms: [], elements: [], openings: [] };
const edges = footprintEdges(spec);
ok(edges.length === 4, 'rect has 4 edges');
ok(edges[0].facing === 'north' && edges[1].facing === 'east' && edges[2].facing === 'south' && edges[3].facing === 'west', 'rect edge facings N,E,S,W', JSON.stringify(edges.map(e => e.facing)));
ok(edges[0].lengthFt === 36 && edges[1].lengthFt === 28, 'edge lengths');

// --- L-shape ---
// 40 wide, 28 deep, notch cut from the SE corner: 16 wide x 13 deep
const L = normalizeFootprint([[0, 0], [40, 0], [40, 15], [24, 15], [24, 28], [0, 28]]);
ok(Boolean(L), 'L normalizes');
ok(!isRectFootprint(L), 'L is not rect');
ok(near(polygonArea(L), 40 * 28 - 16 * 13), 'L area', String(polygonArea(L)));
ok(near(polygonPerimeter(L), 2 * (40 + 28)), 'L perimeter (rectilinear = bbox perimeter)');
const lEdges = footprintEdges({ shell: { footprint: L, widthFt: 40, depthFt: 28 } });
ok(lEdges.length === 6, 'L has 6 edges');
const facings = lEdges.map((e) => e.facing);
ok(facings.filter((f) => f === 'south').length === 2, 'L has two south-facing edges', JSON.stringify(facings));
ok(pointInFootprint(L, 10, 20) && !pointInFootprint(L, 35, 25), 'point-in-polygon');

const pieces = decomposeFootprint(L);
ok(near(pieces.reduce((s, r) => s + r.w * r.d, 0), polygonArea(L)), 'decompose covers area', JSON.stringify(pieces));
ok(rectInFootprint(L, { x: 2, y: 2, w: 10, d: 10 }), 'rect inside L');
ok(!rectInFootprint(L, { x: 30, y: 20, w: 8, d: 6 }), 'rect in notch NOT inside L');

// --- expand (roof plan) ---
const expanded = expandFootprint(rect, { north: 1.6, south: 1.6, east: 1.6, west: 1.6 });
ok(near(polygonArea(expanded), (36 + 3.2) * (28 + 3.2)), 'rect expand matches legacy roof plan', String(polygonArea(expanded)));
const expandedL = expandFootprint(L, { north: 2, south: 2, east: 2, west: 2 });
// L expanded: area + perimeter*o + corner terms: 5 convex corners (+o^2 each... rectilinear: convex adds o^2, reflex subtracts o^2): 5 convex 1 reflex -> +4*o^2? Just check it's bigger and sane.
ok(polygonArea(expandedL) > polygonArea(L) + polygonPerimeter(L) * 2 - 0.1, 'L expand grows sanely', String(polygonArea(expandedL)));

// --- subtract (stepped roof remainders) ---
const rem = subtractRect({ x: 0, y: 0, w: 36, d: 28 }, { x: 0, y: 0, w: 20, d: 28 });
ok(rem.length === 1 && near(rem[0].x, 20) && near(rem[0].w, 16), 'subtract half plate', JSON.stringify(rem));
const remL = subtractRectFromFootprint(L, { x: 0, y: 0, w: 24, d: 15 });
ok(near(remL.reduce((s, r) => s + r.w * r.d, 0), polygonArea(L) - 24 * 15), 'subtract from L covers remainder', JSON.stringify(remL));

// --- move edge: resize a rectangle ---
const moved = moveFootprintEdge(rect, 2, 6); // south wall out 6
ok(isRectFootprint(moved), 'move south edge keeps rect');
ok(near(footprintBounds(moved).d, 34), 'south move deepens to 34', JSON.stringify(footprintBounds(moved)));
const movedIn = moveFootprintEdge(rect, 3, -4); // west wall inward (shrink)
ok(near(footprintBounds(movedIn).w, 32) && near(footprintBounds(movedIn).minX, 4), 'west move inward shrinks + shifts minX', JSON.stringify(footprintBounds(movedIn)));
const collapse = moveFootprintEdge(rect, 0, 40); // north edge THROUGH the south wall
ok(collapse === null || polygonArea(collapse) >= 40, 'collapse rejected or degenerates safely');

// --- split then move middle = L ---
const split = splitFootprintEdge(rect, 2, 10, 26); // south edge (from 36,28 -> 0,28), distances from its start
ok(split && split.vertices.length === 6, 'split inserts 2 vertices');
const jogged = moveFootprintEdge(split.vertices, split.middleIndex, -8); // push middle 16' inward (notch)
ok(Boolean(jogged), 'jog succeeds');
ok(jogged && jogged.length === 8, 'jog yields 8 corners', jogged && JSON.stringify(jogged));
ok(jogged && near(polygonArea(jogged), 36 * 28 - 16 * 8), 'notch area correct', jogged && String(polygonArea(jogged)));

// --- ops through applyBimOperations ---
const baseSpec = {
  projectName: 'T', revision: 1,
  shell: { widthFt: 36, depthFt: 28, wallHeightFt: 10, roofType: 'gable', roofPitch: 0.32 },
  systems: { envelope: 'straw bale walls', structure: '', water: '', energy: '' },
  rooms: [{ id: 'kitchen', name: 'Kitchen', x: 2, y: 2, w: 12, d: 10, h: 0.22, level: 1, type: 'service' }],
  elements: [], openings: [{ type: 'window', wall: 'south', x: 4, widthFt: 5, label: 'South Window 1' }],
  notes: '', levels: []
};

// set_footprint L
let r = applyBimOperations(baseSpec, { operations: [{ type: 'set_footprint', value: JSON.stringify([[0, 0], [40, 0], [40, 15], [24, 15], [24, 28], [0, 28]]) }] });
ok(Array.isArray(r.spec.shell.footprint) && r.spec.shell.footprint.length === 6, 'op set_footprint stores 6 corners');
ok(r.spec.shell.widthFt === 40 && r.spec.shell.depthFt === 28, 'op set_footprint sets bbox dims');

// move_wall_edge on legacy rect spec = resize, stays legacy
r = applyBimOperations(baseSpec, { operations: [{ type: 'move_wall_edge', wall: 'south', value: 6 }] });
ok(!r.spec.shell.footprint, 'rect edge move stays legacy (no footprint field)', JSON.stringify(r.spec.shell.footprint || null));
ok(r.spec.shell.depthFt === 34, 'rect south move -> depth 34', String(r.spec.shell.depthFt));

// move west edge outward: rooms/openings must shift with re-anchor
r = applyBimOperations(baseSpec, { operations: [{ type: 'move_wall_edge', wall: 'west', value: 6 }] });
ok(r.spec.shell.widthFt === 42, 'west out -> width 42', String(r.spec.shell.widthFt));
ok(near(r.spec.rooms[0].x, 8), 'room carried by re-anchor', String(r.spec.rooms[0].x));
ok(near(r.spec.openings[0].x, 10), 'south opening carried by re-anchor', String(r.spec.openings[0].x));

// split + nudge in one op = L
r = applyBimOperations(baseSpec, { operations: [{ type: 'split_wall_edge', wall: 'south', x: 10, y: 26, value: -8 }] });
ok(Array.isArray(r.spec.shell.footprint) && r.spec.shell.footprint.length === 8, 'split_wall_edge value -> 8-corner notch', JSON.stringify(r.spec.shell.footprint));

// set_shell width on the L scales proportionally
const lSpec = r.spec;
const r2 = applyBimOperations(lSpec, { operations: [{ type: 'set_shell', field: 'widthFt', value: '72' }] });
ok(near(r2.spec.shell.widthFt, 72), 'L width scale -> 72', String(r2.spec.shell.widthFt));
ok(Array.isArray(r2.spec.shell.footprint), 'L survives width scale');
ok(near(polygonArea(footprintPolygon(r2.spec)), polygonArea(footprintPolygon(lSpec)) * 2, 6), 'L area doubles on 2x width', String(polygonArea(footprintPolygon(r2.spec))));

// reset to rect
const r3 = applyBimOperations(lSpec, { operations: [{ type: 'set_footprint', value: 'rect' }] });
ok(!r3.spec.shell.footprint, 'set_footprint rect clears the field');

// legacy no-op: unrelated op leaves legacy spec footprint-free and dims exact
const r4 = applyBimOperations(baseSpec, { operations: [{ type: 'set_utility', field: 'windowQuality', value: 'triple' }] });
ok(!r4.spec.shell.footprint && r4.spec.shell.widthFt === 36 && r4.spec.shell.depthFt === 28, 'legacy spec untouched by unrelated ops');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
