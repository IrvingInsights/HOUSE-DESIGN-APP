// Deterministic tests for the trace verify/repair decision + merge logic,
// plus the offline (local) planner's honesty rules.
import { traceLooksIncomplete, scrubDeferralSummary, mergeTracePlans, repairTraceGeometry, repairTowerStorey, localPlan, promptNeedsDrawing, cleanTraceElements, describeModelForAudit, sanitizeAuditOperations, filterOpsForPass, reclassifyOutdoorRooms, repairBasementRooms, scrubDeadOperations, manifestGaps, applyDeterministicRescues }
  from '../backend/planner.mjs';
import { applyBimOperations, isDimensionShorthandShellOp } from '../backend/bim-core.mjs';
import { sanitizeManifest, separateOverlappingRooms } from '../backend/planner.mjs';

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

// tower ABOVE a loft = a three-level stack: loft level 2, tower level 3
const stacked = repairTowerStorey({ summary: 'x', warnings: [], assumptions: [],
  operations: [
    { type: 'set_shell', field: 'storeys', value: '2' },
    { type: 'add_room', name: 'Loft', x: 14, y: 12, w: 10, d: 9 },
    { type: 'add_room', name: 'Tower Studio', x: 14, y: 13, w: 10, d: 8 }
  ] }, { shell: { wallHeightFt: 10 }, elements: [] });
const loftOut = stacked.operations.find((o) => o.name === 'Loft');
const towerOut = stacked.operations.find((o) => o.name === 'Tower Studio');
const p2 = stacked.operations.find((o) => o.name === 'Storey 2 extent');
const p3 = stacked.operations.find((o) => o.name === 'Storey 3 extent');
const storeys3 = stacked.operations.find((o) => o.type === 'set_shell' && o.field === 'storeys');
ok(loftOut.level === 2 && towerOut.level === 3, 'loft lifts to level 2, tower to level 3');
ok(Number(storeys3.value) === 3, 'storeys bumped to 3 for the stack');
ok(p2 && p2.level === 2 && p2.z === 10 && p3 && p3.level === 3 && p3.z === 20, 'one extent plate per upper level at its elevation');

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

// --- offline planner honesty (UX review 2026-07-10) --------------------------
// A drawing-dependent ask NEVER produces invented objects offline — the exact
// prompt Start-from-file prefills once became a custom object named "m".
const traceAsk = 'Start this design from the attached drawing: read the footprint, the rooms and their sizes, and the windows and doors, and build them.';
const honest = localPlan({ prompt: traceAsk, spec: { shell: { widthFt: 36, depthFt: 28 }, rooms: [], elements: [] }, attachedImages: [{ name: 'plan.pdf', src: 'data:application/pdf;base64,x' }] });
ok(honest.operations.length === 0 && /can't read|cannot read/i.test(honest.summary), 'offline trace ask: zero operations, honest summary');
ok(honest.questions.length > 0, 'offline trace ask: offers the manual path');
const honestNoFile = localPlan({ prompt: traceAsk, spec: { shell: {}, rooms: [], elements: [] }, attachedImages: [] });
ok(honestNoFile.operations.length === 0 && /no readable drawing/i.test(honestNoFile.summary), 'offline trace ask without attachment: zero operations');
ok(promptNeedsDrawing('trace the attached pdf') && !promptNeedsDrawing('arrange the rooms in the 2D planning surface') && !promptNeedsDrawing('add a bedroom 12x11'), 'promptNeedsDrawing matches drawing asks only');

// Loft + tower in one ask: both created with the asked-for sizes and stacked.
const stackedLocal = localPlan({ prompt: 'add a loft 18 × 14 over the east bay and a tower 10 × 10 above it', spec: { shell: { widthFt: 36, depthFt: 28, wallHeightFt: 10 }, rooms: [], elements: [] } });
const localLoft = stackedLocal.operations.find((o) => o.category === 'loft');
const localTower = stackedLocal.operations.find((o) => o.category === 'tower');
ok(localLoft && localLoft.w === 18 && localLoft.d === 14 && localLoft.level === 2, 'local loft: asked-for size on level 2');
ok(localLoft && /east bay/i.test(localLoft.name), 'local loft: named for its place, not "Kitchen Loft"');
ok(localTower && localTower.w === 10 && localTower.d === 10 && localTower.level === 3 && localTower.z === localLoft.z + localLoft.h, 'local tower: 10×10 on level 3, stacked on the loft');

// A tower-only retry that names the loft as a LOCATION must not re-create the
// loft (the duplicate-Kitchen-Loft trap).
const retry = localPlan({ prompt: 'add a tower 10 x 10 above the kitchen loft', spec: { shell: { widthFt: 36, depthFt: 28, wallHeightFt: 10 }, rooms: [], elements: [{ id: 'kitchen-loft', name: 'Kitchen Loft', category: 'loft', x: 20, y: 14, w: 14, d: 12, z: 10, h: 8, level: 2 }] } });
ok(!retry.operations.some((o) => o.category === 'loft'), 'tower retry: no second loft created');
const retryTower = retry.operations.find((o) => o.category === 'tower');
ok(retryTower && retryTower.level === 3 && retryTower.z === 18, 'tower retry: tower stacks on the existing loft (level 3, z 18)');

// The words of a request never become an object: "build them" ≠ element "m".
const noInvention = localPlan({ prompt: 'build them', spec: { shell: {}, rooms: [], elements: [] } });
ok(!noInvention.operations.some((o) => o.type === 'add_element' && String(o.name).replace(/[^a-zA-Z0-9]/g, '').length < 3), 'no single-letter objects invented from prompt words');

// --- trace element hygiene (2026-07-11) ---------------------------------------
// An element that duplicates a measured room is dropped; overlapping outdoor
// pads get re-laid in a rank instead of a pile.
const elPlan = cleanTraceElements({
  summary: 'x', warnings: [], assumptions: [],
  operations: [
    { type: 'set_shell', w: 24, d: 36 },
    { type: 'add_room', name: 'Greenhouse', x: 2, y: 28, w: 18, d: 8 },
    { type: 'add_element', name: 'Greenhouse', category: 'greenhouse', x: 27, y: 28 },
    { type: 'add_element', name: 'Covered Patio', category: 'deck', x: 24, y: 16 },
    { type: 'add_element', name: 'Outdoor Kitchen', category: 'deck', x: 24, y: 16 },
    { type: 'add_element', name: 'Stairs', category: 'structure', x: 9, y: 12 }
  ]
}, { rooms: [], elements: [], shell: { widthFt: 24, depthFt: 36 } });
ok(!elPlan.operations.some((o) => o.type === 'add_element' && o.name === 'Greenhouse'), 'element duplicating a measured room is dropped');
{
  const decks = elPlan.operations.filter((o) => o.type === 'add_element' && o.category === 'deck');
  const [a, b] = decks.map((o) => ({ x: Number(o.x), y: Number(o.y) }));
  ok(decks.length === 2 && (a.x !== b.x || Math.abs(a.y - b.y) >= 10), 'overlapping pads re-laid apart');
  ok(decks.every((o) => Number(o.x) >= 24 + 3), 're-laid pads sit beside the house, not inside it');
}
ok(elPlan.operations.some((o) => o.name === 'Stairs'), 'non-outdoor elements pass through untouched');

// Three-plus dimensionless elements flag the takeoff as incomplete.
const dimlessCheck = traceLooksIncomplete({
  summary: 'x', warnings: [], assumptions: [],
  operations: [
    { type: 'add_room', name: 'A', ...sized(0) }, { type: 'add_room', name: 'B', ...sized(1) },
    { type: 'add_opening', wall: 'south', widthFt: 3 },
    { type: 'add_element', name: 'P1', category: 'porch' },
    { type: 'add_element', name: 'P2', category: 'deck' },
    { type: 'add_element', name: 'P3', category: 'carport' }
  ]
}, { rooms: [], elements: [], shell: {} });
ok(dimlessCheck.unmeasuredElements === true && dimlessCheck.unmeasuredElementNames.length === 3, 'dimensionless elements flagged for the repair pass');

// ---- Audit-loop deterministic parts (the Gemini call itself is stochastic;
// only the snapshot + sanitizer are unit-testable). ----
{
  const snap = describeModelForAudit({
    shell: { widthFt: 24, depthFt: 28, roofType: 'shed', southWallHeightFt: 17, northWallHeightFt: 10, storeys: 2 },
    rooms: [{ id: 'kitchen', name: 'Kitchen', x: 2, y: 3, w: 10, d: 11, level: 1 }],
    openings: [{ wall: 'south', type: 'window', widthFt: 5, x: 4 }],
    elements: [{ id: 'stairs', category: 'structure', name: 'Stairs', x: 11, y: 13, w: 3, d: 7 }]
  });
  ok(snap.includes('kitchen | Kitchen | 2,3 | 10x11 | L1'), 'audit snapshot lists rooms with ids and dims');
  ok(snap.includes('opening-0 | south | window | 5 | 4'), 'audit snapshot lists openings as targetable ids');
  ok(snap.includes('stairs | structure | Stairs'), 'audit snapshot lists elements');
  ok(snap.includes('south wall 17 ft, north wall 10 ft'), 'audit snapshot carries the shed heights');
}
{
  const fixes = sanitizeAuditOperations([
    { type: 'move_object', targetId: 'kitchen', x: 3, y: 3 },
    { type: 'set_site', field: 'zip', value: '00000' },
    null,
    ...Array.from({ length: 30 }, (_, i) => ({ type: 'resize_object', targetId: 'r' + i, w: 10, d: 10 }))
  ]);
  ok(fixes.length === 20, 'audit fixes cap at 20 per round');
  ok(fixes[0].type === 'move_object' && !fixes.some((o) => o.type === 'set_site'), 'non-corrective op types are dropped');
}

// --- measurement strictness (the Columbia St failure, 2026-07-11) -------------
// "Added Living & Dining at 0' x 0'" — an add_room with no w/d becomes a silent
// 10x10 placeholder. Any zero-sized room flags the takeoff for re-measurement.
{
  const zeroRoom = traceLooksIncomplete({
    summary: 'Traced from A101.', warnings: [], assumptions: [],
    operations: [
      { type: 'add_room', name: 'Living & Dining', x: 0, y: 0, w: 0, d: 0 },
      { type: 'add_room', name: 'Kitchen', x: 14, y: 0, w: 12, d: 11 },
      { type: 'add_opening', wall: 'south', widthFt: 3 }
    ]
  }, { rooms: [] });
  ok(zeroRoom.incomplete && zeroRoom.unmeasuredRooms === true, 'add_room without w/d = unmeasuredRooms = incomplete');
  ok(zeroRoom.unmeasuredRoomNames.length === 1 && zeroRoom.unmeasuredRoomNames[0] === 'Living & Dining', 'unmeasured rooms named for the repair prompt');
  const measured = traceLooksIncomplete(good, { rooms: [] });
  ok(measured.unmeasuredRooms === false && measured.unmeasuredRoomNames.length === 0, 'fully measured takeoff: unmeasuredRooms stays quiet');
}

// --- dead-operation scrub ------------------------------------------------------
// "Updated Kitchen ." — update_object with a name but no field and no non-zero
// geometry is a no-op that still prints as an action. Nameless add_room too.
{
  const scrub = scrubDeadOperations({
    summary: 'x', warnings: ['w1'], assumptions: [],
    operations: [
      { type: 'update_object', name: 'Kitchen', field: '', value: '', x: 0, y: 0, z: 0, w: 0, d: 0, h: 0 }, // dead
      { type: 'update_object', name: 'Porch', field: 'roofType', value: 'shed' },                           // real: has field
      { type: 'update_object', name: 'Loft', w: 14, d: 12 },                                                // real: has geometry
      { type: 'add_room', name: '', w: 10, d: 10 },                                                         // dead: nameless
      { type: 'add_room', name: 'Kitchen', x: 2, y: 3, w: 12, d: 11 },                                      // real
      { type: 'resize_object', name: 'Kitchen', w: 12, d: 14 }                                              // other types untouched
    ]
  });
  ok(scrub.operations.length === 4, 'scrub drops fieldless update_object + nameless add_room only');
  ok(scrub.operations.some((o) => o.name === 'Porch') && scrub.operations.some((o) => o.type === 'update_object' && o.name === 'Loft'), 'updates with a field or real geometry survive');
  ok(scrub.warnings.some((w) => /Dropped 2 empty operations/.test(w)), 'scrub reports the dropped count in one warning');
  const clean = scrubDeadOperations({ summary: 'x', warnings: [], assumptions: [],
    operations: [{ type: 'add_room', name: 'Bath', x: 0, y: 0, w: 8, d: 6 }] });
  ok(clean.operations.length === 1 && clean.warnings.length === 0, 'scrub is silent when nothing is dead');
}

// --- drawing-manifest comparison (deterministic half of extractDrawingManifest) --
{
  const manifest = {
    sheets: ['A100', 'A101', 'A201'], storeysAboveGrade: 2, hasBasement: false,
    roomNames: ['Living Room', 'Kitchen', 'Bedroom 1', 'Bedroom 2', 'Bath'],
    windowCount: 10, doorCount: 3, notes: ''
  };
  const gapPlan = {
    summary: 'x', warnings: [], assumptions: [],
    operations: [
      { type: 'add_room', name: 'living-room', x: 0, y: 0, w: 14, d: 16 },   // matches via normalization
      { type: 'add_room', name: 'KITCHEN', x: 14, y: 0, w: 12, d: 11 },      // matches via normalization
      ...Array.from({ length: 5 }, () => ({ type: 'add_opening', wall: 'south', widthFt: 3 }))
    ]
  };
  const g = manifestGaps(gapPlan, { rooms: [], shell: {} }, manifest);
  ok(g.missingRooms.length === 3 && g.missingRooms.includes('Bedroom 1') && !g.missingRooms.includes('Living Room'), 'manifest missing-room detection normalizes names (living-room = Living Room)');
  ok(g.lowOpenings === true && g.expectedOpenings === 13 && g.plannedOpenings === 5, '5 of 13 openings < 60% threshold = lowOpenings');
  ok(g.storeysShort === true, 'manifest says 2 storeys, plan has 1 = storeysShort');
  ok(g.roomsCovered === 2 && g.sheetCount === 3, 'coverage counts feed the honest warning');
  // rooms already IN THE MODEL count as covered too
  const g2 = manifestGaps({ summary: 'x', warnings: [], assumptions: [], operations: [] },
    { rooms: [{ name: 'Bedroom #1' }], shell: {} }, manifest);
  ok(!g2.missingRooms.includes('Bedroom 1'), 'existing model rooms count toward manifest coverage');
  // enough openings + storeys set -> both flags stand down
  const okPlan = {
    summary: 'x', warnings: [], assumptions: [],
    operations: [
      { type: 'set_shell', field: 'storeys', value: '2' },
      ...manifest.roomNames.map((n, i) => ({ type: 'add_room', name: n, ...sized(i) })),
      ...Array.from({ length: 8 }, () => ({ type: 'add_opening', wall: 'south', widthFt: 3 }))
    ]
  };
  const g3 = manifestGaps(okPlan, { rooms: [], shell: {} }, manifest);
  ok(g3.missingRooms.length === 0 && g3.lowOpenings === false && g3.storeysShort === false, 'complete takeoff clears every manifest flag (8 >= 60% of 13)');
  ok(manifestGaps(okPlan, { rooms: [] }, null) === null, 'no manifest = null (pipeline behaves as today)');
  // traceLooksIncomplete folds the manifest in via its optional third arg
  const withManifest = traceLooksIncomplete(gapPlan, { rooms: [], shell: {} }, manifest);
  ok(withManifest.incomplete && withManifest.missingRooms === true && withManifest.lowOpenings === true, 'traceLooksIncomplete + manifest flags the same plan incomplete');
  const withoutManifest = traceLooksIncomplete(gapPlan, { rooms: [], shell: {} });
  ok(!withoutManifest.incomplete && withoutManifest.gaps === null, 'same plan without a manifest stays complete (old behavior preserved)');
}

// ---- Staged-read pass filtering + audit removal cap ----
{
  const ops = [
    { type: 'add_room', name: 'Kitchen', w: 10, d: 12 },
    { type: 'add_opening', wall: 'south', widthFt: 3 },
    { type: 'set_shell', field: 'w', value: '40' },
    null
  ];
  const roomsOnly = filterOpsForPass(ops, ['add_room']);
  ok(roomsOnly.length === 1 && roomsOnly[0].name === 'Kitchen', 'pass filter keeps only the whitelisted op types');
  ok(filterOpsForPass(ops, ['set_shell', 'set_roof']).length === 1, 'structure pass filter drops rooms and openings');
  ok(filterOpsForPass(null, ['add_room']).length === 0, 'pass filter tolerates a missing op list');
}
{
  const removals = Array.from({ length: 9 }, (_, i) => ({ type: 'remove_object', targetId: 'o' + i }));
  const kept = sanitizeAuditOperations([{ type: 'move_object', targetId: 'kitchen', x: 1, y: 1 }, ...removals]);
  ok(kept.filter((o) => o.type === 'remove_object').length === 4, 'audit rounds cap removals at 4');
  ok(kept.some((o) => o.type === 'move_object'), 'non-removal corrections survive the removal cap');
}

// ---- Corpus class fixes: outdoor rooms + basement levels + partition clamp ----
{
  const plan = { operations: [
    { type: 'add_room', name: 'Kitchen', x: 2, y: 2, w: 12, d: 10 },
    { type: 'add_room', name: 'SOUTH-ENTRY CARPORT', x: 30, y: 0, w: 18, d: 20 },
    { type: 'add_room', name: 'West Porch', x: -6, y: 4, w: 6, d: 8 },
    { type: 'add_room', name: 'Greenhouse', x: 0, y: 28, w: 18, d: 8 }
  ], warnings: [] };
  reclassifyOutdoorRooms(plan);
  const rooms = plan.operations.filter((o) => o.type === 'add_room');
  const els = plan.operations.filter((o) => o.type === 'add_element');
  ok(rooms.length === 1 && rooms[0].name === 'Kitchen', 'indoor rooms stay rooms');
  ok(els.length === 3, 'outdoor-named rooms become elements');
  ok(els.find((e) => /carport/i.test(e.name))?.category === 'carport', 'carport maps to its category');
  ok(els.find((e) => /greenhouse/i.test(e.name))?.category === 'greenhouse', 'greenhouse maps to its category');
  ok(plan.warnings.some((w) => /unenclosed spaces/i.test(w)), 'reclassification announced honestly');
}
{
  const plan = { operations: [
    { type: 'set_shell', field: 'basementHeightFt', value: '8' },
    { type: 'add_room', name: 'Basement Storage', x: 0, y: 0, w: 20, d: 20, level: 1 },
    { type: 'add_room', name: 'Kitchen', x: 2, y: 2, w: 12, d: 10, level: 1 }
  ], warnings: [] };
  repairBasementRooms(plan, { shell: {} });
  ok(plan.operations[1].level === -1, 'basement-named room dropped to level -1');
  ok(plan.operations[2].level === 1, 'ordinary rooms keep their level');
  const noB = { operations: [{ type: 'add_room', name: 'Basement Storage', level: 1 }], warnings: [] };
  repairBasementRooms(noB, { shell: {} });
  ok(noB.operations[0].level === 1, 'no basement in the takeoff = no re-leveling');
}
{
  const plan = { operations: [
    { type: 'set_shell', w: 36, d: 28 },
    { type: 'add_room', name: 'Kitchen', x: 2, y: 2, w: 12, d: 10 },
    { type: 'add_element', category: 'partition', name: 'Stray Partition', x: 60, y: -4, w: 10, d: 0.45 }
  ], warnings: [] };
  repairTraceGeometry(plan, { shell: { widthFt: 36, depthFt: 28 } });
  const part = plan.operations.find((o) => o.category === 'partition');
  ok(part.x + part.w <= 36.01 && part.x >= 0 && part.y >= 0, 'stray partition clamped into the shell');
}

// ---- Effective-position geometry rescue (grow sees where rooms END UP) ----
{
  const plan = { operations: [
    { type: 'set_shell', w: 30, d: 24 },
    { type: 'add_room', name: 'Bedroom 1', x: 2, y: 2, w: 12, d: 10 },
    { type: 'move_object', targetId: 'bedroom-1', x: 34, y: 20 }
  ], warnings: [] };
  repairTraceGeometry(plan, { shell: { widthFt: 30, depthFt: 24 } });
  const shellOp = plan.operations.find((o) => o.type === 'set_shell');
  ok(Number(shellOp.w) >= 46, 'shell grows to cover a room the audit MOVED (' + shellOp.w + ')');
}
{
  const plan = { operations: [
    { type: 'set_shell', w: 36, d: 28 },
    { type: 'add_room', name: 'Kitchen', x: 2, y: 2, w: 12, d: 10 },
    { type: 'add_element', category: 'partition', name: 'Hall Partition', x: 4, y: 8, w: 10, d: 0.45 },
    { type: 'move_object', targetId: 'hall-partition', x: 70, y: -9 }
  ], warnings: [] };
  repairTraceGeometry(plan, { shell: { widthFt: 36, depthFt: 28 } });
  const mv = plan.operations.find((o) => o.type === 'move_object');
  ok(mv.x <= 35 && mv.y >= 0, 'a move aimed at a partition clamps into the shell');
}

// ---- Junk-field set_shell = dimension shorthand (corpus fl0-v6 class) ------
// The audit emits set_shell ops like {field:'dimensions', value:'24x28', w:24,
// d:36}. The field ladder used to swallow them silently while the trace repair
// "grew" them — the shell stayed small and a room landed outside it.
const miniSpec = () => ({
  projectName: 'T', revision: 1,
  shell: { widthFt: 24, depthFt: 28, wallHeightFt: 10, southWallHeightFt: 10, northWallHeightFt: 10, roofType: 'gable', roofPitch: 0.32, storeys: 1 },
  systems: { envelope: 'straw bale' }, rooms: [], elements: [], openings: [], levels: [], walls: {}, notes: ''
});
{
  ok(isDimensionShorthandShellOp({ type: 'set_shell', w: 24, d: 36 }), 'shorthand: bare w/d');
  ok(isDimensionShorthandShellOp({ type: 'set_shell', field: 'dimensions', value: '24x28', w: 24, d: 36 }), 'shorthand: junk field + w/d');
  ok(isDimensionShorthandShellOp({ type: 'set_shell', field: 'dimensions', value: '24x28' }), 'shorthand: junk field + WxD value only');
  ok(!isDimensionShorthandShellOp({ type: 'set_shell', field: 'storeys', value: 2, w: 24, d: 28 }), 'NOT shorthand: real field keeps the ladder');
  ok(!isDimensionShorthandShellOp({ type: 'set_shell', field: 'roofType', value: 'shed' }), 'NOT shorthand: no dimensions at all');
}
{
  const r = applyBimOperations(miniSpec(), { operations: [
    { type: 'set_shell', field: 'dimensions', value: '24x28', w: 24, d: 36, h: 8, wall: 'none' }
  ] });
  ok(r.spec.shell.widthFt === 24 && r.spec.shell.depthFt === 36, `engine honors junk-field set_shell w/d (${r.spec.shell.widthFt}x${r.spec.shell.depthFt})`);
  const r2 = applyBimOperations(miniSpec(), { operations: [
    { type: 'set_shell', field: 'dimensions', value: '30x34' }
  ] });
  ok(r2.spec.shell.widthFt === 30 && r2.spec.shell.depthFt === 34, 'engine parses a "WxD" value when w/d are absent');
}
// The real fl0-v6 failing shape end-to-end: structure pass set_shell +
// rect set_footprint, measured rooms filling 24x28, then the audit appends a
// junk set_shell and a room hanging past the south wall. After the repair,
// APPLYING the plan must leave every ground room inside the shell.
{
  const plan = { operations: [
    { type: 'set_shell', w: 24, wall: 'straw_bale' },
    { type: 'set_footprint', value: '[[0,0],[24,0],[24,28],[0,28]]' },
    { type: 'add_room', name: 'GREAT ROOM', x: 0, y: 20, w: 16, d: 8 },
    { type: 'add_room', name: 'MASTER BEDROOM', x: 12, y: 0, w: 12, d: 17 },
    { type: 'set_shell', field: 'dimensions', value: '24x28', w: 24, d: 28, h: 8, wall: 'none' },
    { type: 'add_room', name: 'KITCHEN', x: 12, y: 17, w: 12, d: 19 }
  ], warnings: [] };
  repairTraceGeometry(plan, miniSpec());
  const applied = applyBimOperations(miniSpec(), plan);
  const shell = applied.spec.shell;
  const stray = (applied.spec.rooms || []).filter((r) => Number(r.level || 1) === 1
    && (r.x < -0.5 || r.y < -0.5 || r.x + r.w > shell.widthFt + 0.5 || r.y + r.d > shell.depthFt + 0.5));
  ok(stray.length === 0, `applied fl0-v6 shape: no room outside the ${shell.widthFt}x${shell.depthFt} shell (${stray.map((r) => r.name).join(', ') || 'clean'})`);
  ok(shell.depthFt >= 36, `shell actually grew to hold the audit-added room (${shell.depthFt})`);
}
// Footprint smaller than the rooms: the far edge stretches out to enclose,
// and interior jogs stay exactly where the drawing put them.
{
  const plan = { operations: [
    { type: 'set_footprint', value: '[[0,0],[24,0],[24,14],[18,14],[18,28],[0,28]]' },
    { type: 'add_room', name: 'Studio', x: 2, y: 24, w: 14, d: 10 }
  ], warnings: [] };
  repairTraceGeometry(plan, miniSpec());
  const corners = JSON.parse(plan.operations.find((o) => o.type === 'set_footprint').value);
  ok(Math.max(...corners.map((c) => c[1])) >= 34, 'footprint south edge stretched to enclose the room');
  ok(corners.some((c) => c[0] === 18 && c[1] === 14), 'interior jog corner untouched by the stretch');
  const applied = applyBimOperations(miniSpec(), plan);
  ok(applied.spec.shell.depthFt >= 34, `footprint-driven shell depth encloses the room (${applied.spec.shell.depthFt})`);
}
// The full rescue chain runs after the audit: an audit-added greenhouse
// "room" must come out reclassified as an outdoor element, not a stray room.
{
  const plan = { operations: [
    { type: 'set_shell', w: 24, d: 28 },
    { type: 'add_room', name: 'GREAT ROOM', x: 0, y: 20, w: 16, d: 8 },
    { type: 'add_room', name: 'SOLAR GREENHOUSE', x: 2, y: 28, w: 18, d: 8, level: 1 }
  ], warnings: [] };
  applyDeterministicRescues(plan, miniSpec());
  const roomAdds = plan.operations.filter((o) => o.type === 'add_room');
  ok(!roomAdds.some((o) => /greenhouse/i.test(o.name)), 'audit-added greenhouse is not a room after the rescue chain');
  ok(plan.operations.some((o) => o.type === 'add_element' && /greenhouse/i.test(o.name || '')), 'greenhouse reclassified to an outdoor element');
}

// ---- Attached structures snap flush to a wall (greenhouse in the yard) -----
{
  const plan = { operations: [
    { type: 'set_shell', w: 24, d: 28 },
    { type: 'add_element', category: 'porch', name: 'Daily Entry', x: 18, y: 28, w: 6, d: 8 },
    { type: 'add_element', category: 'greenhouse', name: 'Solar Greenhouse', x: 27, y: 28, w: 18, d: 8 },
    { type: 'add_element', category: 'carport', name: 'Carport', x: 30, y: 3, w: 18, d: 20 }
  ], warnings: [] };
  cleanTraceElements(plan, { shell: { widthFt: 24, depthFt: 28 }, rooms: [] });
  const gh = plan.operations.find((o) => o.category === 'greenhouse');
  ok(gh.y === 28 && gh.x >= 0 && gh.x + gh.w <= 24.01, `greenhouse snapped flush to the south wall (${gh.x},${gh.y})`);
  const porch = plan.operations.find((o) => o.category === 'porch');
  ok(porch.x === 18 && porch.y === 28, 'already-flush porch left alone');
  ok(!(gh.x < porch.x + porch.w && gh.x + gh.w > porch.x), 'greenhouse slid clear of the porch on the same face');
  const carport = plan.operations.find((o) => o.category === 'carport');
  ok(carport.x === 30 && carport.y === 3, 'freestanding carport not dragged to a wall');
}

// ---- Columbia REV1 nets: default-size runs, overlaps, misread manifest -----
{
  // Three rooms at literal 10x10 (the backend default) = unmeasured, even
  // though dimensions were technically written down.
  const lazy = { summary: 'Traced 6 rooms.', assumptions: [], warnings: [], operations: [
    { type: 'add_room', name: 'Basement', x: 0, y: 0, w: 40.5, d: 23, level: -1 },
    { type: 'add_room', name: 'Kitchen', x: 6.5, y: 0, w: 14.5, d: 12.5 },
    { type: 'add_room', name: 'Living Room', x: 21, y: 0, w: 19.5, d: 12.5 },
    { type: 'add_room', name: 'Bedroom', x: 2, y: 10.3, w: 10, d: 10 },
    { type: 'add_room', name: 'Bathroom', x: 11.5, y: 10.3, w: 10, d: 10 },
    { type: 'add_room', name: 'Bedroom 2', x: 16.75, y: 10.3, w: 10, d: 10 },
    ...Array.from({ length: 8 }, () => ({ type: 'add_opening', wall: 'south', widthFt: 3 }))
  ] };
  const check = traceLooksIncomplete(lazy, { rooms: [], shell: {} });
  ok(check.incomplete && check.unmeasuredRooms, 'three 10x10 default rooms flagged as unmeasured');
  ok(check.unmeasuredRoomNames.includes('Bathroom'), 'default-sized rooms named for the repair pass');
  ok(check.overlappingRooms && check.overlappingRoomNames.includes('Bathroom'), `overlapping rooms flagged (${check.overlappingRoomNames.join(', ')})`);
}
{
  // Rooms that tile cleanly raise neither flag.
  const clean = { summary: 'Traced.', assumptions: [], warnings: [], operations: [
    { type: 'add_room', name: 'Kitchen', x: 0, y: 0, w: 14, d: 12 },
    { type: 'add_room', name: 'Living', x: 14, y: 0, w: 12, d: 12 },
    { type: 'add_room', name: 'Bed', x: 0, y: 12, w: 10, d: 10 },
    ...Array.from({ length: 8 }, () => ({ type: 'add_opening', wall: 'south', widthFt: 3 }))
  ] };
  const check = traceLooksIncomplete(clean, { rooms: [], shell: {} });
  ok(!check.unmeasuredRooms && !check.overlappingRooms, 'tiled, measured rooms pass both nets');
}
{
  // A 2-room "index" is a misread — trust nothing rather than "covers 2 of 2".
  ok(sanitizeManifest({ roomNames: ['KITCHEN', 'BATH'] }) === null, '2-room manifest distrusted');
  ok(sanitizeManifest({ roomNames: ['A', 'B', 'C', 'D'] }) !== null, '4-room manifest kept');
  ok(sanitizeManifest(null) === null, 'null manifest stays null');
}
{
  // Two rooms on a 40x23 plan = enclosed spaces were skipped (unlabeled
  // as-builts): sparse coverage flags incomplete even when nothing overlaps.
  const sparse = { summary: 'Traced.', assumptions: [], warnings: [], operations: [
    { type: 'set_shell', w: 40.5, d: 23 },
    { type: 'add_room', name: 'Kitchen', x: 0, y: 0, w: 14, d: 12 },
    { type: 'add_room', name: 'Living Room', x: 14, y: 0, w: 12, d: 12 },
    ...Array.from({ length: 8 }, () => ({ type: 'add_opening', wall: 'south', widthFt: 3 }))
  ] };
  const check = traceLooksIncomplete(sparse, { rooms: [], shell: {} });
  ok(check.incomplete && check.sparseRooms, 'two rooms on a 40x23 plan = sparse coverage flagged');
  const full = { summary: 'Traced.', assumptions: [], warnings: [], operations: [
    { type: 'set_shell', w: 24, d: 20 },
    { type: 'add_room', name: 'Kitchen', x: 0, y: 0, w: 12, d: 10 },
    { type: 'add_room', name: 'Living', x: 12, y: 0, w: 12, d: 10 },
    { type: 'add_room', name: 'Bed', x: 0, y: 10, w: 12, d: 10 },
    ...Array.from({ length: 8 }, () => ({ type: 'add_opening', wall: 'south', widthFt: 3 }))
  ] };
  ok(!traceLooksIncomplete(full, { rooms: [], shell: {} }).sparseRooms, 'well-tiled plan not flagged sparse');
}

// ---- Deterministic de-overlap: piled rooms slide apart --------------------
{
  const plan = { operations: [
    { type: 'set_shell', w: 40.5, d: 23 },
    { type: 'add_room', name: 'Hallway', x: 10, y: 10, w: 12, d: 4 },
    { type: 'add_room', name: 'Bathroom', x: 11, y: 10, w: 6, d: 5 },
    { type: 'add_room', name: 'Kitchen', x: 0, y: 0, w: 14, d: 10 }
  ], warnings: [] };
  separateOverlappingRooms(plan, { shell: { widthFt: 40.5, depthFt: 23 } });
  const applied = applyBimOperations({ projectName: 'T', revision: 1, shell: { widthFt: 40.5, depthFt: 23, wallHeightFt: 10, storeys: 1, roofType: 'gable', roofPitch: 0.3 }, systems: {}, rooms: [], elements: [], openings: [], levels: [], walls: {} }, plan);
  const rooms = applied.spec.rooms;
  let piled = false;
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i];
      const b = rooms[j];
      const ov = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y));
      if (ov > 0.35 * Math.min(a.w * a.d, b.w * b.d)) piled = true;
    }
  }
  ok(!piled, 'overlapping rooms slid apart deterministically');
  ok((plan.warnings || []).some((w) => /slid/.test(w)), 'the slide is announced honestly');
}

// --- the referee (Phase 1): scoreTrace / plain-language report / capture ---
{
  const { scoreTrace, formatPlainLanguageScore, autoCaptureTrace } = await import('../backend/planner.mjs');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');

  // Object-form call ({spec, plan}) must judge the SAME spec as (spec, plan) —
  // the old inline checks read the wrong variable and passed vacuously.
  const badSpec = {
    shell: { widthFt: 30, depthFt: 20, basementHeightFt: 8 },
    rooms: [
      { name: 'Basement Den', x: 2, y: 2, w: 10, d: 8, level: 1 },
      { name: 'Kitchen', x: 14, y: 2, w: 10, d: 8, level: 1 },
      { name: 'Living', x: 2, y: 11, w: 22, d: 8, level: 1 }
    ],
    openings: [{ wall: 'south', x: 2, widthFt: 3 }, { wall: 'south', x: 8, widthFt: 3 }, { wall: 'north', x: 2, widthFt: 3 }, { wall: 'east', y: 2, widthFt: 3 }],
    elements: [{ name: 'Hall Wall', category: 'partition', x: 55, y: 2, w: 8, d: 0.5 }]
  };
  const plainPlan = { warnings: [], operations: [] };
  const twoArg = scoreTrace(badSpec, plainPlan);
  const objForm = scoreTrace({ spec: badSpec, plan: plainPlan });
  const nameOf = (checks, name) => checks.find((c) => c.name === name);
  ok(!nameOf(twoArg, 'basement-named rooms on the basement level').pass, 'referee catches mis-leveled basement room (two-arg)');
  ok(!nameOf(objForm, 'basement-named rooms on the basement level').pass, 'referee catches it in OBJECT form too (was vacuous)');
  ok(!nameOf(objForm, 'interior walls inside the shell').pass, 'referee catches stray partition in object form (was vacuous)');

  // Plain-language report: clean and doubtful wordings
  const clean = objForm.map((c) => ({ ...c, pass: true }));
  ok(/of \d+ checks passed\.$/.test(formatPlainLanguageScore(clean)), 'clean read reports plainly');
  ok(/tap Review to see them/.test(formatPlainLanguageScore(objForm)), 'doubtful read points at Review');

  // Auto-capture: PDFs land in captured/ (NOT the sweep folder), dedupe by
  // content hash, one result json per run.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-capture-'));
  const fakePdf = Buffer.from('%PDF-1.4 fake for capture test').toString('base64');
  const img = [{ name: 'My Plan.pdf', src: `data:application/pdf;base64,${fakePdf}` }];
  autoCaptureTrace(img, plainPlan, badSpec, objForm, tmp);
  await new Promise((r) => setTimeout(r, 5)); // distinct run timestamps
  autoCaptureTrace(img, plainPlan, badSpec, objForm, tmp);
  const capDir = path.join(tmp, '.data', 'trace-corpus', 'captured');
  const sweepDir = path.join(tmp, '.data', 'trace-corpus');
  const captured = fs.readdirSync(capDir);
  const topLevelPdfs = fs.readdirSync(sweepDir).filter((f) => f.endsWith('.pdf'));
  ok(captured.filter((f) => f.endsWith('.pdf')).length === 1, 'same drawing captured twice keeps ONE pdf (hash dedupe)');
  ok(captured.filter((f) => f.endsWith('.result.json')).length === 2, 'both runs keep their result json');
  ok(topLevelPdfs.length === 0, 'captures stay OUT of the corpus sweep folder');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
