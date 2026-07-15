// Time Machine timeline tests — dependency rules, order repair, schedule
// receipts, drag validation. Pure and offline:
//
//   node tools/timeline_test.mjs
//
// The rules under test are construction facts, not taste: a frame anchors to
// its foundation, straw stays dry under a roof, concrete cures before tons of
// masonry stand on it. If one of these assertions fails, the Time Machine has
// started allowing (or refusing) the wrong builds.

import {
  seedSpec, getWallSections, deriveDesign, buildTimeline,
  phaseDependencies, orderPhasesByDeps, scheduleTimeline, validatePhaseOrder
} from '../src/engine.js';
import { applyBimOperations } from '../backend/bim-core.mjs';

let passed = 0;
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
};

const applyOps = (spec, operations) => applyBimOperations(structuredClone(spec), { operations }).spec;
const wallsOp = (assembly) => ['north', 'south', 'east', 'west'].map((wall) => ({ type: 'set_wall_side', wall, field: 'assembly', value: assembly }));
const timelineOf = (spec) => {
  const derived = deriveDesign(spec, getWallSections(spec));
  const phases = buildTimeline(spec, derived);
  const deps = phaseDependencies(spec, phases);
  const ordered = orderPhasesByDeps(phases, deps);
  const schedule = scheduleTimeline(ordered, deps);
  return { phases, deps, ordered, schedule };
};
const idx = (ordered, id) => ordered.findIndex((p) => p.id === id);

// ---- 1. Timber frame + straw-bale infill: roof goes on BEFORE the bales ----
const frameStraw = applyOps(seedSpec, [{ type: 'set_frame', value: 'timber' }, ...wallsOp('straw-bale')]);
{
  const { deps, ordered, schedule } = timelineOf(frameStraw);
  check('frame+straw: walls need the roof (dry bales rule)', deps.some((d) => d.id === 'walls' && d.needs === 'roofing'));
  check('frame+straw: default order roofs before walls', idx(ordered, 'roofing') < idx(ordered, 'walls'),
    ordered.map((p) => p.id).join(' → '));
  check('frame+straw: default order framing after foundation', idx(ordered, 'foundation') < idx(ordered, 'framing'));
  check('frame+straw: default order satisfies every rule', schedule.every((row) => row.checks.every((c) => c.ok)),
    JSON.stringify(schedule.flatMap((row) => row.checks.filter((c) => !c.ok).map((c) => c.text))));
  check('frame+straw: occupancy is last', ordered[ordered.length - 1].id === 'occupancy');
}

// ---- 2. Load-bearing straw bale: the walls carry the roof ------------------
const loadBearing = applyOps(seedSpec, [{ type: 'set_frame', value: 'load-bearing' }, ...wallsOp('straw-bale')]);
{
  const { deps, ordered, schedule } = timelineOf(loadBearing);
  check('load-bearing: roof structure needs the walls', deps.some((d) => d.id === 'framing' && d.needs === 'walls'));
  check('load-bearing: NO roof-before-walls rule', !deps.some((d) => d.id === 'walls' && d.needs === 'roofing'));
  check('load-bearing: default order walls before roofing', idx(ordered, 'walls') < idx(ordered, 'roofing'),
    ordered.map((p) => p.id).join(' → '));
  check('load-bearing: default order satisfies every rule', schedule.every((row) => row.checks.every((c) => c.ok)));
}

// ---- 3. Conventional stick frame: classic order stands ---------------------
const conventional = applyOps(seedSpec, [{ type: 'set_frame', value: 'stick' }, ...wallsOp('framed')]);
{
  const { deps, ordered } = timelineOf(conventional);
  check('stick+framed: no dry-bales rule', !deps.some((d) => d.id === 'walls' && d.needs === 'roofing'));
  check('stick+framed: frame → walls → plaster ordering holds',
    idx(ordered, 'framing') < idx(ordered, 'walls') && idx(ordered, 'walls') < idx(ordered, 'plaster'));
}

// ---- 4. Masonry heater: cure time is real ----------------------------------
const heaterSpec = applyOps(frameStraw, [{ type: 'set_utility', field: 'heatSource', value: 'masonry' }]);
{
  const { phases, deps, ordered, schedule } = timelineOf(heaterSpec);
  check('heater: phase exists for a masonry heater', phases.some((p) => p.id === 'heater'));
  check('heater: needs cured foundation with a 4-week gap',
    deps.some((d) => d.id === 'heater' && d.needs === 'foundation' && d.gapWeeks === 4));
  check('heater: default order passes all checks', schedule.every((row) => row.checks.every((c) => c.ok)),
    JSON.stringify(schedule.flatMap((row) => row.checks.filter((c) => !c.ok).map((c) => c.text))));

  // Drag the heater to right after the foundation — too soon, concrete still curing.
  const orderIds = ordered.map((p) => p.id);
  const tooSoon = orderIds.filter((id) => id !== 'heater');
  tooSoon.splice(tooSoon.indexOf('foundation') + 1, 0, 'heater');
  const verdict = validatePhaseOrder(phases, tooSoon, deps);
  check('heater: dragging it right after the pour is refused', !verdict.ok);
  check('heater: the refusal explains itself in plain English',
    (verdict.problems[0]?.text || '').includes('cure') || (verdict.problems[0]?.text || '').includes('curing'),
    verdict.problems[0]?.text);
}

// ---- 5. Drag validation: illegal refused with a reason, legal accepted -----
{
  const { phases, deps, ordered } = timelineOf(frameStraw);
  const orderIds = ordered.map((p) => p.id);

  // Illegal: bales before the roof.
  const badOrder = orderIds.filter((id) => id !== 'walls');
  badOrder.splice(badOrder.indexOf('roofing'), 0, 'walls');
  const bad = validatePhaseOrder(phases, badOrder, deps);
  check('drag: bales before roof is refused', !bad.ok);
  check('drag: the reason names the rule', (bad.problems[0]?.text || '').toLowerCase().includes('straw'), bad.problems[0]?.text);

  // Legal: push plaster-prep work later — walls after utilities is allowed
  // on a frame build (the frame carries the roof either way).
  const okOrder = orderIds.filter((id) => id !== 'walls');
  okOrder.splice(okOrder.indexOf('utilities') + 1, 0, 'walls');
  const good = validatePhaseOrder(phases, okOrder, deps);
  check('drag: walls after rough-in is allowed (builder’s call)', good.ok,
    JSON.stringify(good.problems.map((p) => p.text)));
}

// ---- 6. Schedule math: weeks accumulate, receipts carry week numbers -------
{
  const { schedule } = timelineOf(frameStraw);
  check('schedule: starts at week 0', schedule[0].startWeek === 0);
  const chained = schedule.every((row, i) => i === 0 || row.startWeek === schedule[i - 1].endWeek);
  check('schedule: one crew — each phase starts when the last ends', chained);
  const total = schedule[schedule.length - 1].endWeek;
  const sum = schedule.reduce((acc, row) => acc + (Number(row.weeks) || 0), 0);
  check('schedule: total equals the sum of the parts', Math.abs(total - sum) < 0.11, `${total} vs ${sum}`);
  const someReceipt = schedule.flatMap((row) => row.checks).find((c) => c.ok);
  check('schedule: receipts speak in week numbers', /week \d/.test(someReceipt?.text || ''), someReceipt?.text);
}

// ---- 7. Unknown / partial orders never crash -------------------------------
{
  const { phases, deps } = timelineOf(frameStraw);
  const verdict = validatePhaseOrder(phases, ['nonsense', 'roofing'], deps);
  check('robustness: junk ids are ignored, missing phases appended', verdict.schedule.length === phases.length);
}

console.log(failed === 0 ? `timeline_test: ALL ${passed} CHECKS PASSED` : `timeline_test: ${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
