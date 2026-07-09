// Deterministic tests for the trace verify/repair decision + merge logic.
import { traceLooksIncomplete, scrubDeferralSummary, mergeTracePlans }
  from '../backend/planner.mjs';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('FAIL  ' + l); } };

// --- incompleteness detection ---
const punted = { summary: 'Applied. Specific room layouts and openings are noted for future refinement.',
  operations: [{ type: 'set_shell', w: 40, d: 23 }, { type: 'add_room', name: 'Kitchen' }], assumptions: [], warnings: [] };
ok(traceLooksIncomplete(punted, { rooms: [] }).incomplete, 'punted plan (deferral phrase) = incomplete');

const noOpenings = { summary: 'Traced 7 rooms.', assumptions: [], warnings: [],
  operations: Array.from({ length: 7 }, (_, i) => ({ type: 'add_room', name: 'R' + i })) };
ok(traceLooksIncomplete(noOpenings, { rooms: [] }).incomplete, 'zero openings = incomplete');

const good = { summary: 'Traced: shell 40x23, 7 rooms, 12 openings.', assumptions: [], warnings: [],
  operations: [...Array.from({ length: 7 }, (_, i) => ({ type: 'add_room', name: 'R' + i })),
    ...Array.from({ length: 12 }, () => ({ type: 'add_opening', wall: 'south' }))] };
ok(!traceLooksIncomplete(good, { rooms: [] }).incomplete, 'full takeoff = complete');

const legitWarning = { summary: 'Traced: 6 rooms, 10 openings.', assumptions: [],
  warnings: ['The chimney is not fully modeled as a separate element.'],
  operations: [...Array.from({ length: 6 }, (_, i) => ({ type: 'add_room', name: 'R' + i })),
    ...Array.from({ length: 10 }, () => ({ type: 'add_opening' }))] };
ok(!traceLooksIncomplete(legitWarning, { rooms: [] }).incomplete, 'material warning (chimney) is NOT a layout deferral');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
