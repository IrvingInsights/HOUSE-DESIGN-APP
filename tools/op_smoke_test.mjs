// Backend op smoke suite — every applyBimOperations op type round-trips
// against a fresh spec and asserts its effect. Runs headless (direct import,
// no server). Optionally add --http to also sanity-check the live server's
// /api/bim/apply with persist:false (never clobbers the current project).
//
//   node tools/op_smoke_test.mjs          # headless op sweep
//   node tools/op_smoke_test.mjs --http   # + live-server sanity (server must run)
import {
  applyBimOperations, footprintPolygon, polygonArea, hasCustomFootprint,
  WALL_ASSEMBLIES, FRAME_TYPES, FLOORING_TYPES, SUBFLOOR_TYPES, OPENING_TYPES,
  gradeElevationAt, maxFoundationExposureFt
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

// --- vocab sanity: shared tables exist for every consumer ---------------------
ok(Object.keys(WALL_ASSEMBLIES).length === 7, 'WALL_ASSEMBLIES table');
ok(Object.keys(FRAME_TYPES).length === 6, 'FRAME_TYPES table');
ok(Object.keys(FLOORING_TYPES).length === 6 && Object.keys(SUBFLOOR_TYPES).length === 4, 'floor tables');
ok(Object.keys(OPENING_TYPES).length === 11, 'OPENING_TYPES table');

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

const wantHttp = process.argv.includes('--http');
(async () => {
  if (wantHttp) await httpSanity();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
