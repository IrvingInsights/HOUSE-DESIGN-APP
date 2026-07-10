// Deterministic tests for the trace verify/repair decision + merge logic.
import { traceLooksIncomplete, scrubDeferralSummary, mergeTracePlans, repairTraceGeometry, repairTowerStorey }
  from '../backend/planner.mjs';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('FAIL  ' + l); } };
// varied, measured room sizes so the unmeasured-geometry check stays quiet
const sized = (i) => ({ x: (i % 3) * 10, y: Math.floor(i / 3) * 9, w: 8 + i, d: 9 + (i % 4) });

// --- incompleteness detection ---
const punted = { summary: 'Applied. Specific room layouts and openings are noted for future refinement.',
  operations: [{ type: 'set_shell', w: 40, d: 23 }, { type: 'add_room', name: 'Kitchen' }], assumptions: [], warnings: [] };
ok(traceLooksIncomplete(punted, { rooms: [] }).incomplete, 'punted plan (deferral phrase) = incomplete');

const noOpenings = { summary: 'Traced 7 rooms.', assumptions: [], warnings: [],
  operations: Array.from({ length: 7 }, (_, i) => ({ type: 'add_room', name: 'R' + i })) };
ok(traceLooksIncomplete(noOpenings, { rooms: [] }).incomplete, 'zero openings = incomplete');

const good = { summary: 'Traced: shell 40x23, 7 rooms, 12 openings.', assumptions: [], warnings: [],
  operations: [...Array.from({ length: 7 }, (_, i) => ({ type: 'add_room', name: 'R' + i, ...sized(i) })),
    ...Array.from({ length: 12 }, () => ({ type: 'add_opening', wall: 'south' }))] };
ok(!traceLooksIncomplete(good, { rooms: [] }).incomplete, 'full takeoff = complete');

const legitWarning = { summary: 'Traced: 6 rooms, 10 openings.', assumptions: [],
  warnings: ['The chimney is not fully modeled as a separate element.'],
  operations: [...Array.from({ length: 6 }, (_, i) => ({ type: 'add_room', name: 'R' + i, ...sized(i) })),
    ...Array.from({ length: 10 }, () => ({ type: 'add_opening' }))] };
ok(!traceLooksIncomplete(legitWarning, { rooms: [] }).incomplete, 'material warning (chimney) is NOT a layout deferral');

// --- garbage-geometry detection (the FL0 failure: 10 identical 9x10 rooms,
// some at negative coordinates, inside a 9x18.5 shell) ---
const unmeasured = { summary: 'Traced: 10 rooms, 8 openings.', assumptions: [], warnings: [],
  operations: [...Array.from({ length: 10 }, (_, i) => ({ type: 'add_room', name: 'U' + i, x: i - 7, y: 2, w: 9, d: 10 })),
    ...Array.from({ length: 8 }, () => ({ type: 'add_opening', wall: 'south' }))] };
const unCheck = traceLooksIncomplete(unmeasured, { rooms: [] });
ok(unCheck.incomplete && unCheck.badGeometry, 'identical default room sizes = badGeometry = incomplete');

const negativeRooms = { summary: 'ok', assumptions: [], warnings: [],
  operations: [{ type: 'add_room', name: 'A', x: -7, y: 2, w: 9, d: 10 }, { type: 'add_room', name: 'B', x: 3, y: 2, w: 12, d: 11 },
    { type: 'add_opening', wall: 'south' }] };
ok(traceLooksIncomplete(negativeRooms, { rooms: [] }).badGeometry, 'negative room coordinates = badGeometry');

// --- deterministic geometry rescue ---
const wonky = { summary: 'x', assumptions: [], warnings: [],
  operations: [
    { type: 'set_shell', w: 9, d: 18.5 },
    { type: 'add_room', name: 'A', x: -7, y: 2, w: 9, d: 10 },
    { type: 'add_room', name: 'B', x: 5, y: 18, w: 9, d: 10 },
    { type: 'add_element', name: 'Stairs', category: 'structure', x: 5, y: 13, w: 3, d: 9 },
    { type: 'add_element', name: 'Storey 2 extent', category: 'floor', level: 2, x: 0, y: 0, w: 10, d: 8 }
  ] };
const rescued = repairTraceGeometry(wonky, { shell: { widthFt: 9, depthFt: 18.5 } });
const roomA = rescued.operations.find((o) => o.name === 'A');
const roomB = rescued.operations.find((o) => o.name === 'B');
const stair = rescued.operations.find((o) => o.name === 'Stairs');
const plate = rescued.operations.find((o) => o.name === 'Storey 2 extent');
ok(roomA.x === 0 && roomA.y === 2, 'rescue re-anchors negative rooms to the NW origin');
ok(roomB.x === 12 && stair.x === 12, 'rescue shifts every explicitly-placed op by the same offset');
ok(plate.x === 0 && plate.y === 0, 'rescue leaves zero-filled element coords alone (0 = unset)');
const shellOp = rescued.operations.find((o) => o.type === 'set_shell' && Number(o.w));
ok(shellOp.w >= 21 && shellOp.d >= 28, 'rescue grows the planned shell to enclose the rooms');

const fine = { summary: 'x', assumptions: [], warnings: [],
  operations: [{ type: 'set_shell', w: 40, d: 23 }, { type: 'add_room', name: 'K', x: 0, y: 0, w: 12, d: 11 }] };
const fineOut = repairTraceGeometry(structuredClone(fine), { shell: { widthFt: 40, depthFt: 23 } });
ok(JSON.stringify(fineOut.operations) === JSON.stringify(fine.operations), 'rescue is a no-op on a healthy takeoff');

// --- badGeometry repair may correct shell dims; normal repair may not ---
const dimFix = mergeTracePlans(
  { summary: 'x', warnings: [], assumptions: [], operations: [{ type: 'add_room', name: 'K', x: 0, y: 0, w: 12, d: 11 }] },
  { warnings: [], assumptions: [], operations: [{ type: 'set_shell', field: 'widthFt', value: 24 }, { type: 'resize_object', name: 'K', w: 14, d: 12 }] },
  { rooms: [] }, null, { allowShellDims: true });
ok(dimFix.operations.some((o) => o.field === 'widthFt'), 'badGeometry repair may restate shell dims');
ok(dimFix.operations.some((o) => o.type === 'resize_object'), 'repair re-measure ops (resize_object) survive the merge');

// --- summary scrub ---
const scrubbed = scrubDeferralSummary({ summary: 'Done. Openings noted for future refinement.',
  operations: [{ type: 'add_room', name: 'A' }, { type: 'add_opening' }, { type: 'add_opening' }] });
ok(!/future refinement/i.test(scrubbed.summary) && /2 opening/.test(scrubbed.summary), 'scrub rewrites banned summary with real counts');

// --- merge ---
const first = { summary: 'x', warnings: ['w1'], assumptions: ['a1'],
  operations: [{ type: 'set_shell', field: 'storeys', value: '1' }, { type: 'set_footprint', value: '[[0,0]]' },
    { type: 'add_room', name: 'Kitchen' }, { type: 'add_room', name: 'Living Room' }] };
const repair = { warnings: ['w2'], assumptions: ['a1', 'a2'],
  operations: [
    { type: 'add_room', name: 'kitchen' },            // dup (normalized) -> dropped
    { type: 'add_room', name: 'Bedroom 1' },          // kept
    { type: 'add_room', name: '' },                   // empty -> dropped
    { type: 'add_opening', wall: 'south' },           // kept
    { type: 'set_shell', field: 'widthFt', value: '99' }, // non-storeys shell -> dropped
    { type: 'set_shell', field: 'storeys', value: '2' },  // kept
    { type: 'set_footprint', value: 'rect' }          // footprint churn -> dropped
  ] };
const merged = mergeTracePlans(first, repair, { rooms: [] });
const rooms = merged.operations.filter((o) => o.type === 'add_room').map((o) => o.name);
ok(rooms.length === 3 && rooms.includes('Bedroom 1') && !rooms.includes('kitchen'), 'merge dedups rooms by normalized name');
ok(merged.operations.some((o) => o.type === 'add_opening'), 'merge keeps repair openings');
ok(merged.operations.some((o) => o.type === 'set_shell' && o.field === 'storeys' && o.value === '2'), 'merge keeps storeys op');
ok(!merged.operations.some((o) => o.type === 'set_shell' && o.field === 'widthFt'), 'merge drops repair shell-width churn');
ok(!merged.operations.some((o) => o.type === 'set_footprint' && o.value === 'rect'), 'merge drops repair footprint churn');
ok(merged.warnings.length === 2 && merged.assumptions.length === 2, 'merge unions warnings + assumptions');
ok(/completed in two passes/.test(merged.summary), 'merge summary notes two passes');

// --- deterministic tower rescue ---
const towerPlan = { summary: 'x', assumptions: [], warnings: [],
  operations: [
    { type: 'set_shell', w: 24, d: 36, field: 'storeys', value: '2' },
    { type: 'add_room', name: 'Kitchen', x: 12, y: 19, w: 12, d: 9 },
    { type: 'add_room', name: 'Tower Studio', x: 14, y: 13, w: 10, d: 8 }
  ] };
const towered = repairTowerStorey(towerPlan, { shell: { wallHeightFt: 12 }, elements: [] });
const liftedRoom = towered.operations.find((o) => o.name === 'Tower Studio');
const towerPlate = towered.operations.find((o) => o.name === 'Storey 2 extent');
ok(liftedRoom.level === 2, 'tower room lifts to level 2 when storeys > 1');
ok(towerPlate && towerPlate.category === 'floor' && towerPlate.x === 14 && towerPlate.w === 10 && towerPlate.z === 12,
  'storey-extent plate generated over the tower bay at the wall-height elevation');
const oneStorey = repairTowerStorey({ summary: 'x', warnings: [], assumptions: [],
  operations: [{ type: 'add_room', name: 'Tower Studio', x: 1, y: 1, w: 8, d: 8 }] }, { shell: { storeys: 1 }, elements: [] });
ok(!oneStorey.operations.some((o) => o.name === 'Storey 2 extent'), 'single-storey plan: tower rescue stands down');

// AI-emitted plate missing its level/elevation gets normalized, not duplicated
const aiPlate = repairTowerStorey({ summary: 'x', warnings: [], assumptions: [],
  operations: [
    { type: 'set_shell', field: 'storeys', value: '2' },
    { type: 'add_room', name: 'Tower Studio', x: 14, y: 13, w: 10, d: 8, level: 2 },
    { type: 'add_element', name: 'Storey 2 extent', category: 'floor', x: 14, y: 13, w: 10, d: 8, level: 0, z: 0 }
  ] }, { shell: { wallHeightFt: 12 }, elements: [] });
const normPlate = aiPlate.operations.filter((o) => o.type === 'add_element');
ok(normPlate.length === 1 && normPlate[0].level === 2 && normPlate[0].z === 12, 'AI plate normalized to level 2 at wall-height elevation, no duplicate added');

// element dedupe across repair passes: no second 'Stairs'
const stairsDedup = mergeTracePlans(
  { summary: 'x', warnings: [], assumptions: [], operations: [{ type: 'add_element', name: 'Stairs', category: 'structure', x: 9, y: 13, w: 3, d: 6 }] },
  { warnings: [], assumptions: [], operations: [{ type: 'add_element', name: 'stairs', category: 'structure', x: 11, y: 13, w: 10, d: 10 }, { type: 'add_element', name: 'Carport', category: 'carport', x: 30, y: 3, w: 10, d: 18 }] },
  { rooms: [], elements: [] });
const stairCount = stairsDedup.operations.filter((o) => o.type === 'add_element' && /stairs/i.test(o.name)).length;
ok(stairCount === 1 && stairsDedup.operations.some((o) => o.name === 'Carport'), 'merge dedupes elements by name, keeps new ones');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
