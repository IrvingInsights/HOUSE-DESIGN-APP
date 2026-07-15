// Backend op smoke suite — every applyBimOperations op type round-trips
// against a fresh spec and asserts its effect. Runs headless (direct import,
// no server). Optionally add --http to also sanity-check the live server's
// /api/bim/apply with persist:false (never clobbers the current project).
//
//   node tools/op_smoke_test.mjs          # headless op sweep
//   node tools/op_smoke_test.mjs --http   # + live-server sanity (server must run)
import {
  applyBimOperations, footprintPolygon, polygonArea, hasCustomFootprint, hasSegmentedFootprint,
  WALL_ASSEMBLIES, FRAME_TYPES, FLOORING_TYPES, SUBFLOOR_TYPES, OPENING_TYPES,
  gradeElevationAt, maxFoundationExposureFt, resolveWallSide, footprintEdges,
  basementInfo, BASEMENT_LEVEL, PARTITION_TYPES
} from '../backend/bim-core.mjs';

function near(a, b, eps = 0.01) { return Math.abs(a - b) <= eps; }

let pass = 0, fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass += 1; console.log(`  ok  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
}
function freshSpec() {
  return {
    projectName: 'Smoke', revision: 1,
    shell: { widthFt: 36, depthFt: 28, wallHeightFt: 10, southWallHeightFt: 10, northWallHeightFt: 10, roofType: 'gable', roofPitch: 0.32, storeys: 1 },
    systems: { envelope: 'straw bale walls with lime plaster', structure: 'timber', water: 'well', energy: 'off-grid solar' },
    rooms: [
      { id: 'great-room', name: 'Great Room', x: 2, y: 2, w: 16, d: 14, h: 0.22, level: 1, type: 'living' },
      { id: 'bath', name: 'Bathroom', x: 20, y: 2, w: 8, d: 8, h: 0.22, level: 1, type: 'wet' }
    ],
    elements: [], openings: [{ type: 'window', wall: 'south', x: 6, widthFt: 5, label: 'South Window 1' }],
    levels: [], walls: {}, notes: ''
  };
}
function apply(spec, ops) { return applyBimOperations(spec, { operations: ops }); }

// --- shell -------------------------------------------------------------------
let r = apply(freshSpec(), [{ type: 'set_shell', field: 'widthFt', value: '44' }]);
ok(r.spec.shell.widthFt === 44, 'set_shell widthFt');
r = apply(freshSpec(), [{ type: 'set_shell', field: 'depthFt', value: '32' }]);
ok(r.spec.shell.depthFt === 32, 'set_shell depthFt');
r = apply(freshSpec(), [{ type: 'set_shell', w: 40.5, d: 23 }]);
ok(r.spec.shell.widthFt === 40.5 && r.spec.shell.depthFt === 23, 'set_shell shorthand w/d');
r = apply(freshSpec(), [{ type: 'set_shell', field: 'wallHeightFt', value: '12' }]);
ok(r.spec.shell.wallHeightFt === 12 && r.spec.shell.southWallHeightFt === 12, 'set_shell wallHeightFt mirrors S/N');
r = apply(freshSpec(), [{ type: 'set_shell', field: 'storeys', value: '2' }]);
ok(r.spec.shell.storeys === 2, 'set_shell storeys');
r = apply(freshSpec(), [{ type: 'set_shell', field: 'overhangFt', value: '3' }]);
ok(r.spec.shell.overhangFt === 3, 'set_shell overhangFt');
r = apply(freshSpec(), [{ type: 'set_shell', field: 'roofType', value: 'hip' }]);
ok(r.spec.shell.roofType === 'hip', 'set_shell roofType');
r = apply(freshSpec(), [{ type: 'set_shell', field: 'projectName', value: 'Cedar Hollow' }]);
ok(r.spec.projectName === 'Cedar Hollow', 'set_shell projectName');

// --- roof / wall height ------------------------------------------------------
r = apply(freshSpec(), [{ type: 'set_roof', roofType: 'shed', southWallHeightFt: 14, northWallHeightFt: 9 }]);
ok(r.spec.shell.roofType === 'shed' && r.spec.shell.wallHeightFt === 14, 'set_roof shed profile');
r = apply(freshSpec(), [{ type: 'set_wall_height', wall: 'south', h: 13 }]);
ok(r.spec.shell.southWallHeightFt === 13 && r.spec.shell.roofType === 'shed', 'set_wall_height south -> shed');
r = apply(freshSpec(), [{ type: 'set_overhang', wall: 'south', value: 4 }]);
ok(r.spec.shell.overhangs?.south === 4, 'set_overhang per side');
r = apply(freshSpec(), [{ type: 'set_overhang', wall: 'all', value: 2.5 }]);
ok(r.spec.shell.overhangFt === 2.5 && !r.spec.shell.overhangs, 'set_overhang all clears per-side');

// --- per-wall ----------------------------------------------------------------
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'east', field: 'assembly', value: 'cob' }]);
ok(r.spec.walls.east.assembly === 'cob', 'set_wall_side assembly');
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'north', field: 'heightFt', value: 14 }]);
ok(r.spec.walls.north.heightFt === 14 && r.spec.shell.northWallHeightFt === 14, 'set_wall_side height syncs shell');
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'west', field: 'thicknessFt', value: 2 }]);
ok(r.spec.walls.west.thicknessFt === 2, 'set_wall_side thickness');
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'north', field: 'omitted', value: true }]);
ok(r.spec.walls.north.omitted === true && r.spec.shell.omittedWalls.includes('north'), 'set_wall_side omitted syncs shell');
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'south', field: 'assembly', value: 'framed', level: 2 }]);
ok(r.spec.wallsUpper.south.assembly === 'framed', 'set_wall_side upper storey');
r = apply(freshSpec(), ['north', 'south', 'east', 'west'].map((wall) => ({ type: 'set_wall_side', wall, field: 'assembly', value: 'hemp-lime' })));
ok(['north', 'south', 'east', 'west'].every((s) => r.spec.walls[s].assembly === 'hemp-lime'), 'batched all-sides assembly (one dispatch)');
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'south', field: 'assembly', value: 'glazed' }]);
ok(r.spec.walls.south.assembly === 'glazed' && resolveWallSide(r.spec, 'south').assembly.rValue === 2, 'set_wall_side glazed glass wall resolves');

// --- site / utilities / systems ---------------------------------------------
r = apply(freshSpec(), [{ type: 'set_site', field: 'zip', value: '12147' }, { type: 'set_site', field: 'latitudeDeg', value: 42.6 }, { type: 'set_site', field: 'azimuthDeg', value: -20 }]);
ok(r.spec.site.zip === '12147' && r.spec.site.latitudeDeg === 42.6 && r.spec.site.azimuthDeg === -20, 'set_site fields');
r = apply(freshSpec(), [{ type: 'set_utility', field: 'waterSource', value: 'catchment' }]);
ok(r.spec.utilities.waterSource === 'catchment' && /catchment/.test(r.spec.systems.water), 'set_utility waterSource + systems text');
r = apply(freshSpec(), [{ type: 'set_utility', field: 'foundationType', value: 'stemwall' }, { type: 'set_utility', field: 'stemwallHeightFt', value: 2 }]);
ok(r.spec.utilities.foundationType === 'stemwall' && r.spec.utilities.stemwallHeightFt === 2, 'set_utility foundation + stem height');
r = apply(freshSpec(), [{ type: 'set_utility', field: 'windowQuality', value: 'triple' }, { type: 'set_utility', field: 'panelCount', value: 12 }, { type: 'set_utility', field: 'diyWalls', value: 'true' }]);
ok(r.spec.utilities.windowQuality === 'triple' && r.spec.utilities.panelCount === 12 && r.spec.utilities.diyWalls === true, 'set_utility window/panels/diy');
r = apply(freshSpec(), [{ type: 'set_utility', field: 'waterSource', value: 'nonsense' }]);
ok(r.spec.utilities.waterSource === 'well', 'set_utility rejects unknown enum');
r = apply(freshSpec(), [{ type: 'set_flooring', value: 'cork' }, { type: 'set_flooring', field: 'subfloor', value: 'insulated' }]);
ok(r.spec.flooring.type === 'cork' && r.spec.flooring.subfloor === 'insulated', 'set_flooring type + subfloor');
r = apply(freshSpec(), [{ type: 'set_frame', value: 'timber' }, { type: 'set_frame', value: 'stick', level: 2 }]);
ok(r.spec.frame.type === 'timber' && r.spec.frame.storeyTypes['2'] === 'stick', 'set_frame base + per-storey');
r = apply(freshSpec(), [{ type: 'set_reclaimed', system: 'windows', value: true }]);
ok(r.spec.reclaimed.windows === true, 'set_reclaimed');
r = apply(freshSpec(), [{ type: 'set_assembly', field: 'envelope', value: 'cob walls with earthen plaster' }]);
ok(/cob/.test(r.spec.systems.envelope), 'set_assembly envelope');

// --- openings ----------------------------------------------------------------
r = apply(freshSpec(), [{ type: 'add_opening', wall: 'east', openingType: 'french', widthFt: 5, positionFt: 8 }]);
ok(r.spec.openings.some((o) => o.wall === 'east' && o.type === 'french'), 'add_opening french doors');
r = apply(freshSpec(), [{ type: 'add_opening', wall: 'roof', openingType: 'skylight', widthFt: 3, x: 10, y: 8 }]);
ok(r.spec.openings.some((o) => o.wall === 'roof' && o.type === 'skylight'), 'add_opening skylight w/ plan coords');
r = apply(freshSpec(), [{ type: 'add_opening', wall: 'north', openingType: 'skylight', widthFt: 3 }]);
ok(r.spec.openings.some((o) => o.wall === 'roof'), 'skylight coerces to roof');

// --- rooms / elements / objects ----------------------------------------------
r = apply(freshSpec(), [{ type: 'add_room', name: 'Pantry', w: 8, d: 6, x: 2, y: 20 }]);
ok(r.spec.rooms.some((room) => room.name === 'Pantry'), 'add_room');
r = apply(freshSpec(), [{ type: 'add_element', name: 'Rocket Heater', category: 'thermal', x: 10, y: 10, w: 4, d: 3, h: 5 }]);
ok(r.spec.elements.some((el) => el.name === 'Rocket Heater'), 'add_element');
r = apply(freshSpec(), [{ type: 'add_level', level: 2, name: 'Level 02' }]);
ok(r.spec.levels.length > 0 && r.spec.elements.some((el) => el.category === 'floor'), 'add_level + floor plate');
r = apply(freshSpec(), [{ type: 'move_object', targetId: 'great-room', x: 4, y: 6 }]);
ok(r.spec.rooms.find((room) => room.id === 'great-room').x === 4, 'move_object');
r = apply(freshSpec(), [{ type: 'resize_object', targetId: 'bath', w: 10, d: 9 }]);
ok(r.spec.rooms.find((room) => room.id === 'bath').w === 10, 'resize_object');
r = apply(freshSpec(), [{ type: 'update_object', targetId: 'bath', field: 'name', value: 'Bath & Laundry' }]);
ok(r.spec.rooms.find((room) => room.id === 'bath').name === 'Bath & Laundry', 'update_object rename');
r = apply(freshSpec(), [{ type: 'remove_object', targetId: 'bath' }]);
ok(!r.spec.rooms.some((room) => room.id === 'bath'), 'remove_object');
r = apply(freshSpec(), [{ type: 'move_object', targetId: 'no-such-thing', x: 1, y: 1 }]);
ok(r.rejectedOperations.length === 1, 'unknown target rejected with warning');

// --- footprint (geometry pass) -------------------------------------------
const L_CORNERS = JSON.stringify([[0, 0], [40, 0], [40, 15], [24, 15], [24, 28], [0, 28]]);
r = apply(freshSpec(), [{ type: 'set_footprint', value: L_CORNERS }]);
ok(hasCustomFootprint(r.spec) && r.spec.shell.widthFt === 40, 'set_footprint L-shape');
ok(Math.abs(polygonArea(footprintPolygon(r.spec)) - (40 * 28 - 16 * 13)) < 0.5, 'L area exact');
const lSpec = r.spec;
r = apply(lSpec, [{ type: 'set_footprint', value: 'rect' }]);
ok(!r.spec.shell.footprint, 'set_footprint rect resets');
r = apply(freshSpec(), [{ type: 'move_wall_edge', wall: 'south', value: 6 }]);
ok(!r.spec.shell.footprint && r.spec.shell.depthFt === 34, 'move_wall_edge on rect = resize, stays legacy');
r = apply(freshSpec(), [{ type: 'move_wall_edge', wall: 'west', value: 4 }]);
ok(r.spec.shell.widthFt === 40 && r.spec.rooms[0].x === 6, 'west edge out carries rooms (re-anchor)');
r = apply(freshSpec(), [{ type: 'split_wall_edge', wall: 'south', x: 10, y: 26, value: -8 }]);
ok(hasCustomFootprint(r.spec) && footprintPolygon(r.spec).length === 8, 'split_wall_edge + nudge = notch');
r = apply(freshSpec(), [{ type: 'move_wall_edge', field: 'e2', value: 200 }]);
ok(r.spec.shell.depthFt <= 80 || r.rejectedOperations.length === 1 || r.warnings.length > 0, 'absurd edge move clamped or rejected');
r = apply(freshSpec(), [{ type: 'set_footprint', value: JSON.stringify([[0, 0], [10, 5], [10, 10]]) }]);
ok(r.rejectedOperations.length === 1, 'diagonal/short footprint rejected');

// --- openings hygiene (the duplicate plague) ----------------------------------
r = apply(freshSpec(), [
  { type: 'add_opening', wall: 'north', openingType: 'window', widthFt: 3, positionFt: 8 },
  { type: 'add_opening', wall: 'north', openingType: 'window', widthFt: 3, positionFt: 9 } // overlaps -> replaces
]);
ok(r.spec.openings.filter((o) => o.wall === 'north').length === 1, 'overlapping re-add replaces, not stacks');
r = apply(freshSpec(), [
  { type: 'add_opening', wall: 'north', openingType: 'window', widthFt: 3, positionFt: 4 },
  { type: 'add_opening', wall: 'north', openingType: 'window', widthFt: 3, positionFt: 12 }
]);
ok(r.spec.openings.filter((o) => o.wall === 'north').length === 2, 'separated windows both stay');
r = apply({ ...freshSpec(), openings: [
  { type: 'window', wall: 'south', x: 6, widthFt: 5, label: 'A' },
  { type: 'window', wall: 'south', x: 7, widthFt: 3, label: 'B' },
  { type: 'door', wall: 'south', x: 8, widthFt: 3, label: 'C' },
  { type: 'window', wall: 'east', y: 4, widthFt: 3, label: 'D' }
] }, [{ type: 'dedupe_openings' }]);
ok(r.spec.openings.length === 2 && r.spec.openings.some((o) => o.type === 'door'), 'dedupe keeps the door of an overlapping cluster + untouched walls', JSON.stringify(r.spec.openings));

// opening slide via update_object (the Plan drag path)
r = apply(freshSpec(), [{ type: 'update_object', targetId: 'opening-0', field: 'x', value: 12 }]);
ok(r.spec.openings[0].x === 12, 'update_object slides an opening along its wall (numeric x)', String(r.spec.openings[0].x));
// fixture on an upper floor keeps its level + elevation
r = apply(freshSpec(), [{ type: 'add_element', name: 'Loft Tub', category: 'water', x: 4, y: 4, z: 10.45, w: 5, d: 3, h: 2, level: 2 }]);
const tub = r.spec.elements.find((el) => el.name === 'Loft Tub');
ok(tub && tub.level === 2 && Math.abs(tub.z - 10.45) < 0.01, 'add_element keeps level 2 + elevation', JSON.stringify(tub && { level: tub.level, z: tub.z }));

// --- design approach -----------------------------------------------------------
r = apply(freshSpec(), [{ type: 'set_shell', field: 'designApproach', value: 'standard' }]);
ok(r.spec.shell.designApproach === 'standard', 'set designApproach standard');
ok(!r.issues.some((i) => /solar-side|dirty entry/i.test(i.title)), 'standard mode silences passive-solar/homestead flags', JSON.stringify(r.issues.map((i) => i.title)));
r = apply(freshSpec(), [{ type: 'set_shell', field: 'designApproach', value: 'weird' }]);
ok(r.spec.shell.designApproach === 'natural', 'unknown approach falls back to natural');

// --- topography ------------------------------------------------------------------
r = apply(freshSpec(), [
  { type: 'set_site', field: 'slopeFt', value: 9 },
  { type: 'set_site', field: 'slopeDir', value: 'south' },
  { type: 'set_site', field: 'gradeFt', value: 1.5 }
]);
ok(r.spec.site.slopeFt === 9 && r.spec.site.slopeDir === 'south' && r.spec.site.gradeFt === 1.5, 'set_site topography fields');
ok(near(gradeElevationAt(r.spec, 0, 0), -1.5), 'grade at uphill edge = -gradeFt', String(gradeElevationAt(r.spec, 0, 0)));
ok(near(gradeElevationAt(r.spec, 0, 28), -10.5), 'grade at downhill edge = -(gradeFt+slope)', String(gradeElevationAt(r.spec, 0, 28)));
ok(near(maxFoundationExposureFt(r.spec), 10.5), 'max exposure = grade + slope');
ok(near(gradeElevationAt(freshSpec(), 5, 5), -1.5), 'flat site grade = -gradeFt everywhere');

// --- basement (a real below-grade storey, level -1) ---------------------------
r = apply(freshSpec(), [{ type: 'set_shell', field: 'basementHeightFt', value: '8' }]);
ok(r.spec.shell.basementHeightFt === 8 && basementInfo(r.spec.shell).present, 'set_shell basementHeightFt');
r = apply(freshSpec(), [{ type: 'set_shell', field: 'basementHeightFt', value: '20' }]);
ok(r.spec.shell.basementHeightFt === 12, 'basement height clamps to 12');
r = apply(freshSpec(), [
  { type: 'set_shell', field: 'basementHeightFt', value: '8' },
  { type: 'add_room', name: 'Root Cellar', category: 'storage', x: 2, y: 2, w: 10, d: 8, level: -1 }
]);
ok(r.spec.rooms.find((rm) => rm.name === 'Root Cellar')?.level === BASEMENT_LEVEL, 'add_room at basement level -1 (not swallowed by zero-fill)');
r = apply(r.spec, [{ type: 'set_shell', field: 'basementHeightFt', value: '0' }]);
ok(!r.spec.shell.basementHeightFt && r.spec.rooms.find((rm) => rm.name === 'Root Cellar')?.level === 1, 'removing basement re-levels stranded rooms to ground');
r = apply(freshSpec(), [
  { type: 'set_shell', field: 'basementHeightFt', value: '8' },
  { type: 'add_room', name: 'Guest Bedroom', category: 'sleeping', x: 2, y: 2, w: 10, d: 10, level: -1 }
]);
ok(r.issues.some((issue) => /egress/i.test(issue.title)), 'basement bedroom flags egress');
r = apply(freshSpec(), [{ type: 'set_utility', field: 'foundationType', value: 'basement' }]);
ok(r.spec.shell.basementHeightFt === 8, 'foundationType basement aliases to the basement storey');
r = apply(r.spec, [{ type: 'set_shell', field: 'basementHeated', value: 'false' }]);
ok(r.spec.shell.basementHeated === false, 'basementHeated stores a real boolean');
r = apply(r.spec, [{ type: 'set_shell', field: 'basementHeightFt', value: '0' }]);
ok(!('basementHeated' in r.spec.shell), 'removing the basement clears basementHeated');

// --- interior partitions -------------------------------------------------------
r = apply(freshSpec(), [{ type: 'add_element', name: 'Kitchen Wall', category: 'partition', x: 10, y: 14, w: 12, d: 0, widthFt: 3, positionFt: 4 }]);
let part = r.spec.elements.find((el) => el.category === 'partition');
ok(part && part.d === PARTITION_TYPES.framed.thicknessFt && part.construction === 'framed', 'partition defaults: framed thickness on the short axis', JSON.stringify(part));
ok(part.doorWFt === 3 && part.doorAtFt === 4, 'partition door fields persist from widthFt/positionFt');
ok(part.h >= 7, 'partition defaults to full height');
r = apply(r.spec, [{ type: 'resize_object', targetId: part.id, w: 16, d: 0.45 }]);
ok(r.spec.elements.find((el) => el.id === part.id)?.d === 0.45, 'partition stays thin through resize (no 1ft fattening)');
r = apply(freshSpec(), [{ type: 'add_element', name: 'Cob Divider', category: 'partition', construction: 'cob', x: 4, y: 4, w: 0, d: 10 }]);
part = r.spec.elements.find((el) => el.category === 'partition');
ok(part && part.w === PARTITION_TYPES.cob.thicknessFt && part.doorWFt === 0, 'north-south cob partition: thickness on w, solid (no door)');

// --- kneewalls + sun glazing + frame + segment resize --------------------------
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'south', field: 'heightFt', value: 3 }]);
ok(r.spec.walls.south.heightFt === 3 && r.spec.shell.southWallHeightFt === 3, 'per-side kneewall height 3ft allowed');
r = apply(r.spec, [
  { type: 'set_wall_side', wall: 'south', field: 'sunGlazing', value: 'true' },
  { type: 'set_wall_side', wall: 'south', field: 'sunGlazingTiltDeg', value: 32 }
]);
ok(resolveWallSide(r.spec, 'south').sunGlazing === true && resolveWallSide(r.spec, 'south').sunGlazingTiltDeg === 32, 'sun glazing + tilt round-trip');
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'north', field: 'heightFt', value: 0.5 }]);
ok(r.spec.walls.north.heightFt === 2, 'kneewall clamps at 2ft floor');
r = apply(freshSpec(), [{ type: 'set_frame', field: 'baySpacingFt', value: '6' }]);
ok(r.spec.frame.baySpacingFt === 6, 'set_frame baySpacingFt');
// segment resize: notch the south wall into 3, then set the middle's length + start
r = apply(freshSpec(), [{ type: 'split_wall_edge', wall: 'south' }]);
r = apply(r.spec, [{ type: 'resize_wall_segment', field: 'e3', value: 10, positionFt: 4 }]);
{
  const segPoly = footprintPolygon(r.spec);
  const onSouth = segPoly.filter(([, py]) => py === 28).map(([px]) => px).sort((a, b) => a - b);
  ok(Boolean(r.spec.shell.footprint) && onSouth.includes(4) && onSouth.includes(14), 'segment resize slides the split points (10ft long, starts at 4)', JSON.stringify(segPoly));
  ok(segPoly.some(([px, py]) => px === 0 && py === 28) && segPoly.some(([px, py]) => px === 36 && py === 28), 'segment resize leaves the house corners alone', JSON.stringify(segPoly));
  const area = polygonArea(segPoly);
  ok(area > 0 && area <= 36 * 28, 'segment resize keeps a sane area', String(area));
}
r = apply(freshSpec(), [{ type: 'resize_wall_segment', wall: 'south', value: 10 }]);
ok(r.warnings.some((warning) => /custom outline|Split into 3/i.test(warning)), 'segment resize on a plain rectangle explains itself');

// --- exterior cladding ----------------------------------------------------------
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'south', field: 'cladding', value: 'lap' }]);
ok(r.spec.walls.south.cladding === 'lap' && resolveWallSide(r.spec, 'south').cladding === 'lap', 'set_wall_side cladding round-trips');
r = apply(freshSpec(), [{ type: 'set_wall_side', wall: 'south', field: 'cladding', value: 'vinyl-nonsense' }]);
ok(r.spec.walls.south.cladding === 'render', 'unknown cladding falls back to render');

// --- flat shed flags -----------------------------------------------------------
r = apply(freshSpec(), [{ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: 10, northWallHeightFt: 10 }]);
ok(r.issues.some((issue) => /flat/i.test(issue.title) && /drain/i.test(issue.title)), 'flat shed roof flags for drainage');
r = apply(freshSpec(), [{ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: 12, northWallHeightFt: 9 }]);
ok(!r.issues.some((issue) => /flat/i.test(issue.title)), 'a real shed fall stays quiet');

// --- per-storey height ---------------------------------------------------------
r = apply(freshSpec(), [
  { type: 'set_shell', field: 'storeys', value: '2' },
  { type: 'set_shell', field: 'upperStoreyHeightFt', value: '8' }
]);
ok(r.spec.shell.upperStoreyHeightFt === 8, 'upperStoreyHeightFt round-trips');
r = apply(r.spec, [{ type: 'set_shell', field: 'upperStoreyHeightFt', value: '30' }]);
ok(r.spec.shell.upperStoreyHeightFt === 14, 'upper storey height clamps to 14');

// --- shell must enclose the ground floor ---------------------------------------
r = apply(freshSpec(), [{ type: 'add_room', name: 'Carport', category: 'service', x: 40, y: 4, w: 12, d: 20 }]);
ok(r.issues.some((issue) => /outside the walls/i.test(issue.title)), 'indoor room outside the shell flags');
r = apply(freshSpec(), [{ type: 'add_room', name: 'Kitchen Garden', category: 'garden', x: 40, y: 4, w: 12, d: 20 }]);
ok(!r.issues.some((issue) => /outside the walls/i.test(issue.title)), 'outdoor spaces outside the shell stay quiet');

// --- vocab sanity: shared tables exist for every consumer ---------------------
ok(Object.keys(WALL_ASSEMBLIES).length === 11, 'WALL_ASSEMBLIES table (natural + standard + glazed)');
ok(WALL_ASSEMBLIES['ply-insulated'] && WALL_ASSEMBLIES.sips && WALL_ASSEMBLIES.icf, 'standard assemblies present');
ok(WALL_ASSEMBLIES['straw-bale'].green === true && !WALL_ASSEMBLIES.sips.green, 'green flags mark natural methods');
ok(WALL_ASSEMBLIES.glazed && WALL_ASSEMBLIES.glazed.rValue === 2, 'glazed glass-wall assembly present');
ok(Object.keys(FRAME_TYPES).length === 6, 'FRAME_TYPES table');
ok(Object.keys(FLOORING_TYPES).length === 6 && Object.keys(SUBFLOOR_TYPES).length === 4, 'floor tables');
ok(Object.keys(OPENING_TYPES).length === 11, 'OPENING_TYPES table');

// --- transaction truth (UX review 2026-07-10) --------------------------------
// All-sides assembly batch: one plan, four ops, every side ends up resolved to
// the same assembly (the global selector on the Walls page derives from these).
r = apply(freshSpec(), ['north', 'south', 'east', 'west'].map((wall) => ({ type: 'set_wall_side', wall, field: 'assembly', value: 'straw-bale' })));
{
  const keys = ['north', 'south', 'east', 'west'].map((side) => resolveWallSide(r.spec, side).assemblyKey);
  ok(keys.every((key) => key === 'straw-bale'), 'all-walls batch: every resolved side is straw-bale', keys.join(','));
  ok(new Set(keys).size === 1, 'all-walls batch: sides are not mixed after the batch');
}

// Loft + tower stack: the model must actually contain what the chat claims —
// storeys rise, each upper level gets an extent plate, the floor tab can exist.
r = apply(freshSpec(), [
  { type: 'add_loft', name: 'East Bay Loft', category: 'loft', x: 16, y: 10, z: 10, w: 18, d: 14, h: 8, level: 2 },
  { type: 'add_tower', name: 'Tower', category: 'tower', x: 20, y: 12, z: 18, w: 10, d: 10, h: 8, level: 3 }
]);
ok(r.spec.shell.storeys === 3, 'loft+tower: storeys raised to 3', String(r.spec.shell.storeys));
ok(r.spec.elements.some((el) => el.category === 'loft') && r.spec.elements.some((el) => el.category === 'tower'), 'loft+tower: both elements exist');
ok(r.spec.elements.some((el) => el.category === 'floor' && el.level === 2) && r.spec.elements.some((el) => el.category === 'floor' && el.level === 3), 'loft+tower: extent plates at levels 2 and 3');

// A retry must not create a duplicate loft — same name + stack category rejects.
{
  const once = apply(freshSpec(), [{ type: 'add_loft', name: 'Kitchen Loft', category: 'loft', x: 16, y: 10, z: 10, w: 14, d: 12, h: 8, level: 2 }]);
  const twice = applyBimOperations(once.spec, { operations: [{ type: 'add_loft', name: 'Kitchen Loft', category: 'loft', x: 16, y: 10, z: 10, w: 14, d: 12, h: 8, level: 2 }] });
  const lofts = twice.spec.elements.filter((el) => el.category === 'loft').length;
  ok(lofts === 1 && twice.rejectedOperations.length === 1, 'duplicate loft rejected with a visible warning', `lofts=${lofts}`);
}

// Nameless / one-letter objects are parse failures, never model objects.
r = apply(freshSpec(), [{ type: 'add_element', name: 'm', category: 'custom', w: 10, d: 10 }]);
ok(r.rejectedOperations.length === 1 && !r.spec.elements.some((el) => el.name === 'm'), 'one-letter element name rejected');
r = apply(freshSpec(), [{ type: 'add_room', name: 'x', w: 10, d: 10 }]);
ok(r.rejectedOperations.length === 1 && !r.spec.rooms.some((room) => room.name === 'x'), 'one-letter room name rejected');

// A room added on a floor the house lacks raises the storey count (tab truth);
// a story-and-a-half design (storeys 1.5) is left alone.
r = apply(freshSpec(), [{ type: 'add_room', name: 'Attic Studio', x: 4, y: 4, w: 12, d: 10, level: 2 }]);
ok(r.spec.shell.storeys === 2, 'level-2 room raises storeys 1 -> 2', String(r.spec.shell.storeys));
{
  const half = freshSpec();
  half.shell.storeys = 1.5;
  const out = applyBimOperations(half, { operations: [{ type: 'add_room', name: 'Loft Bedroom', x: 4, y: 4, w: 12, d: 10, level: 2 }] });
  ok(out.spec.shell.storeys === 1.5, 'level-2 room leaves a 1.5-storey design alone');
}

async function httpSanity() {
  const base = 'http://localhost:5184';
  const current = await fetch(`${base}/api/projects/current`).then((res) => res.json());
  const liveSpec = current?.state?.spec;
  ok(Boolean(liveSpec), 'http: current project loads');
  if (!liveSpec) return;
  const post = (operations) => fetch(`${base}/api/bim/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec: liveSpec, plan: { operations }, persist: false })
  }).then((res) => res.json());
  let out = await post([{ type: 'split_wall_edge', wall: 'south', value: -6 }]);
  ok(out.ok && hasCustomFootprint(out.report?.spec || {}), 'http: split_wall_edge round-trips (persist:false)', JSON.stringify(out.report?.actions || out.report?.warnings || out.error || '').slice(0, 160));
  out = await post([{ type: 'move_wall_edge', wall: 'east', value: 2 }]);
  ok(out.ok && JSON.stringify(out.report?.actions || []).includes('Moved the east wall'), 'http: move_wall_edge acknowledged', JSON.stringify(out.report?.actions || out.error || '').slice(0, 160));
}

// --- floor stacks: level is structural, plates stay sane ---------------------
{
  // "The tower is the 3rd floor": level update raises storeys + sets elevation
  let s = freshSpec();
  s.shell.storeys = 2;
  s.rooms.push({ id: 'tower-studio', name: 'Tower Studio', x: 20, y: 18, w: 10, d: 8, level: 2, z: 10 });
  let out = apply(s, [{ type: 'update_object', targetId: 'tower-studio', field: 'level', value: '3' }]);
  const tw = out.spec.rooms.find((r) => r.id === 'tower-studio');
  ok(tw.level === 3 && out.spec.shell.storeys === 3, 'update level 3 raises storeys to 3', `level=${tw.level} storeys=${out.spec.shell.storeys}`);
  ok(tw.z === 20, 'level-3 room lands at the storey elevation (20)', `z=${tw.z}`);

  // A floor plate for a phantom storey raises the count and gets a sane z
  s = freshSpec();
  s.shell.storeys = 2;
  out = apply(s, [{ type: 'add_element', category: 'floor', name: 'Third Floor Plate', x: 20, y: 18, w: 10, d: 8, z: 34, level: 3 }]);
  const plate3 = out.spec.elements.find((el) => el.category === 'floor' && Number(el.level) === 3);
  ok(plate3 && out.spec.shell.storeys === 3, 'level-3 plate raises storeys', `storeys=${out.spec.shell.storeys}`);
  ok(plate3 && plate3.z === 20, 'junk plate z (34) snapped to the storey elevation', `z=${plate3?.z}`);

  // A degenerate plate grows to cover its storey's rooms (the 4x4-plate bug)
  s = freshSpec();
  s.shell.storeys = 2;
  s.rooms.push({ id: 'tower-studio', name: 'Tower Studio', x: 14, y: 11, w: 10, d: 17, level: 2, z: 10 });
  s.elements.push({ id: 'storey-2-extent', name: 'Storey 2 extent', category: 'floor', x: 14, y: 11, w: 4, d: 4, h: 0.35, z: 10, level: 2 });
  out = apply(s, [{ type: 'move_object', targetId: 'tower-studio', x: 14, y: 11 }]);
  const plate2 = out.spec.elements.find((el) => el.id === 'storey-2-extent');
  ok(plate2 && plate2.w >= 10 && plate2.d >= 17, 'extent plate grows to cover its storey rooms', `${plate2?.w}x${plate2?.d}`);
}

// --- interior elements never default to the yard ------------------------------
{
  // A partition with no x (zero-filled op) used to park at shellW+3 — an
  // interior wall floating in the yard. Unset interior positions = origin.
  const out = apply(freshSpec(), [{ type: 'add_element', category: 'partition', name: 'Hall Wall', y: 8, w: 10 }]);
  const part = out.spec.elements.find((el) => el.category === 'partition');
  ok(part && part.x + part.w <= 36.01 && part.x >= 0, 'unplaced partition lands inside the shell', `x=${part?.x}`);
  const out2 = apply(freshSpec(), [{ type: 'add_element', category: 'shed', name: 'Garden Shed', w: 8, d: 6 }]);
  const shed = out2.spec.elements.find((el) => el.name === 'Garden Shed');
  ok(shed && shed.x >= 36, 'unplaced OUTDOOR element still parks beside the house', `x=${shed?.x}`);
}

// --- per-segment wall construction (frame vs infill sections) ----------------
{
  // Split the east wall into 3 coplanar sections. The outline stays a
  // rectangle, but the stored footprint means the wall now has pieces.
  let out = apply(freshSpec(), [{ type: 'split_wall_edge', wall: 'east' }]);
  ok(hasSegmentedFootprint(out.spec) && !hasCustomFootprint(out.spec), 'split-but-rectangular outline counts as segmented, not custom');
  let eastEdges = footprintEdges(out.spec).filter((edge) => edge.facing === 'east');
  ok(eastEdges.length === 3, 'east wall splits into 3 sections', `${eastEdges.length}`);

  // The middle section becomes a timber-frame bay; its neighbours stay bale.
  const middle = eastEdges[1];
  out = apply(out.spec, [{ type: 'set_wall_side', wall: middle.key, field: 'assembly', value: 'framed' }]);
  ok(resolveWallSide(out.spec, 'east', 1, middle.key).assemblyKey === 'framed', 'middle section runs its own construction');
  ok(resolveWallSide(out.spec, 'east', 1, eastEdges[0].key).assemblyKey === 'straw-bale', 'outer sections keep the side construction');
  ok(resolveWallSide(out.spec, 'east').assemblyKey === 'straw-bale', 'the side itself is untouched');

  // wall-eN target form + per-section thickness.
  out = apply(out.spec, [{ type: 'set_wall_side', wall: `wall-${middle.key}`, field: 'thicknessFt', value: 0.6 }]);
  ok(near(resolveWallSide(out.spec, 'east', 1, middle.key).thicknessFt, 0.6), 'wall-eN target form works');

  // Height stays a side-wide concept — a section height is rejected honestly.
  const rej = apply(out.spec, [{ type: 'set_wall_side', wall: middle.key, field: 'heightFt', value: 14 }]);
  ok(rej.rejectedOperations.length === 1 && rej.warnings.length >= 1, 'section height is rejected (side-wide field)');

  // The override FOLLOWS its wall when edges renumber (split another wall).
  const midSpan = (Math.min(middle.y0, middle.y1) + Math.max(middle.y0, middle.y1)) / 2;
  out = apply(out.spec, [{ type: 'split_wall_edge', wall: 'north' }]);
  const eastNow = footprintEdges(out.spec).filter((edge) => edge.facing === 'east');
  const midNow = eastNow.find((edge) => Math.abs((edge.y0 + edge.y1) / 2 - midSpan) < 0.1);
  ok(midNow && resolveWallSide(out.spec, 'east', 1, midNow.key).assemblyKey === 'framed', 'section construction follows the wall through renumbering', midNow?.key);
  ok(eastNow.filter((edge) => edge !== midNow).every((edge) => resolveWallSide(out.spec, 'east', 1, edge.key).assemblyKey === 'straw-bale'), 'neighbour sections stay side-built after renumbering');

  // Moving the middle section out (an east bump) keeps its construction.
  out = apply(out.spec, [{ type: 'move_wall_edge', field: midNow.key, value: 4 }]);
  const eastAfterMove = footprintEdges(out.spec).filter((edge) => edge.facing === 'east');
  const bumped = eastAfterMove.find((edge) => Math.abs((edge.y0 + edge.y1) / 2 - midSpan) < 0.1);
  ok(bumped && resolveWallSide(out.spec, 'east', 1, bumped.key).assemblyKey === 'framed', 'section construction survives moving that wall out', bumped?.key);

  // Reset to a rectangle clears section overrides (walls are whole again).
  out = apply(out.spec, [{ type: 'set_footprint', value: 'rect' }]);
  ok(!out.spec.wallSegments, 'plain rectangle clears section overrides');

  // Clearing the assembly hands one section back to its side.
  let out2 = apply(freshSpec(), [{ type: 'split_wall_edge', wall: 'east' }]);
  const mid2 = footprintEdges(out2.spec).filter((edge) => edge.facing === 'east')[1];
  out2 = apply(out2.spec, [{ type: 'set_wall_side', wall: mid2.key, field: 'assembly', value: 'framed' }]);
  out2 = apply(out2.spec, [{ type: 'set_wall_side', wall: mid2.key, field: 'assembly', value: '' }]);
  ok(resolveWallSide(out2.spec, 'east', 1, mid2.key).assemblyKey === 'straw-bale' && !out2.spec.wallSegments, 'assembly "" hands the section back to its side');
}

// --- trace referee score rides the plan onto the design -----------------------
{
  const score = { when: '2026-07-12T00:00:00Z', passed: 9, total: 11, checks: [
    { name: 'traced at least 2 rooms', pass: true, detail: '5 rooms' },
    { name: "rooms don't pile on each other", pass: false, detail: 'Kitchen, Living' }
  ] };
  const out = applyBimOperations(freshSpec(), { operations: [{ type: 'set_shell', field: 'widthFt', value: '40' }], traceScore: score });
  ok(out.spec.traceReview?.passed === 9 && out.spec.traceReview?.checks?.length === 2, 'plan.traceScore stamps spec.traceReview');
  const again = applyBimOperations(out.spec, { operations: [{ type: 'set_shell', field: 'depthFt', value: '30' }] });
  ok(again.spec.traceReview?.passed === 9, 'traceReview survives ordinary edits (until the next trace)');
}

// --- id wins over name: same-named foundation runs never snap together --------
{
  let s = apply(freshSpec(), [
    { type: 'add_element', name: 'Rubble trench run', category: 'foundation', construction: 'rubble', x: 2, y: 31, w: 12, d: 1.5, h: 0.3, level: 1 },
    { type: 'add_element', name: 'Rubble trench run 2', category: 'foundation', construction: 'rubble', x: 16, y: 31, w: 12, d: 1.5, h: 0.3, level: 1 }
  ]).spec;
  const a = s.elements[0], b = s.elements[1];
  // Drag B, but pass the SHARED name prefix — the worst case for the old
  // id-OR-name lookup that let A's name match beat B's id.
  const r = apply(s, [{ type: 'move_object', targetId: b.id, name: 'Rubble trench run', x: 20, y: 31 }]).spec;
  const a2 = r.elements.find((e) => e.id === a.id), b2 = r.elements.find((e) => e.id === b.id);
  ok(a2.x === 2 && b2.x === 20, 'move by id hits the right run — same-named runs never snap together', `A@${a2.x} B@${b2.x}`);
}

const wantHttp = process.argv.includes('--http');
(async () => {
  if (wantHttp) await httpSanity();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
