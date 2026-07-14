// Golden-number battery — the anti-drift guardrail (spec findings #4, #5).
//
// The house-math (deriveDesign: costs, carbon, areas, loads; detectIssues;
// buildTimeline; materialsTakeoff) must NEVER change silently. This test pins
// the outputs of a few reference designs to a committed snapshot
// (tools/golden_numbers.json). Any change to a derived number fails the test
// loudly, naming the field and both values.
//
//   node tools/golden_numbers_test.mjs            # verify against the snapshot
//   node tools/golden_numbers_test.mjs --update   # intentional change: rewrite
//                                                  # the snapshot (shows in diff)
//
// Regenerating is deliberate and reviewable: the JSON diff is the record that a
// number moved and someone signed off. Do not --update to make a red bar green
// without understanding why the number changed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  seedSpec, getWallSections, deriveDesign, detectIssues, buildTimeline,
  materialsTakeoff, convertSpecApproach
} from '../src/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(HERE, 'golden_numbers.json');
const UPDATE = process.argv.includes('--update');

// Round floats so trivial FP jitter never trips the battery, while any real
// change to the math (a table value, a formula) still moves the 6th decimal.
const r6 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n);
const roundObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r6(v)]));

// The reference designs. Each exercises a different corner of the math:
//  - seed:       the shipped starter (framed walls, no explicit frame)
//  - standard:   the same house converted to conventional construction
//  - strawBale:  all-straw-bale infill on a timber frame (natural assemblies,
//                bale takeoff, and the bale-near-grade safety check)
function fixtures() {
  const seed = structuredClone(seedSpec);

  const standard = convertSpecApproach(structuredClone(seedSpec), 'standard');

  const strawBale = structuredClone(seedSpec);
  strawBale.walls = {
    north: { assembly: 'straw-bale' }, south: { assembly: 'straw-bale' },
    east: { assembly: 'straw-bale' }, west: { assembly: 'straw-bale' }
  };
  strawBale.systems = { ...strawBale.systems, frameGround: 'timber' };

  return { seed, standard, strawBale };
}

// The pinned surface: every number a user could audit, plus the shapes
// (issue titles, phase sequence, takeoff size) that frame those numbers.
function snapshotOf(spec) {
  const ws = getWallSections(spec);
  const d = deriveDesign(spec, ws);
  const numbers = Object.fromEntries(
    Object.entries(d).filter(([, v]) => typeof v === 'number')
  );
  const takeoff = materialsTakeoff(spec, d);
  return {
    cost: roundObj(d.cost || {}),
    numbers: roundObj(numbers),
    issues: detectIssues(spec).map((i) => `${i.severity}:${i.title}`),
    phases: buildTimeline(spec, d).map((p) => `${p.id}:${p.weeks}:${p.costPct}`),
    takeoffCount: Array.isArray(takeoff) ? takeoff.length : -1
  };
}

function build() {
  const f = fixtures();
  const out = {};
  for (const [name, spec] of Object.entries(f)) out[name] = snapshotOf(spec);
  return out;
}

// ---- deep compare with readable per-leaf reporting ----
function compareLeaves(path, expected, actual, out) {
  if (expected === null || typeof expected !== 'object') {
    const ok = JSON.stringify(expected) === JSON.stringify(actual);
    out.push({ path, ok, expected, actual });
    return;
  }
  if (Array.isArray(expected)) {
    const ok = JSON.stringify(expected) === JSON.stringify(actual);
    out.push({ path, ok, expected, actual, array: true });
    return;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual || {})]);
  for (const k of keys) compareLeaves(`${path}.${k}`, expected[k], actual ? actual[k] : undefined, out);
}

const current = build();

if (UPDATE || !existsSync(SNAPSHOT_PATH)) {
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(`${existsSync(SNAPSHOT_PATH) ? 'Wrote' : 'Created'} golden snapshot → ${SNAPSHOT_PATH}`);
  console.log(`${Object.keys(current).length} fixtures pinned. Review the JSON diff before committing.`);
  process.exit(0);
}

const golden = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
const leaves = [];
for (const name of new Set([...Object.keys(golden), ...Object.keys(current)])) {
  compareLeaves(name, golden[name], current[name], leaves);
}

let failed = 0;
for (const l of leaves) {
  if (l.ok) continue;
  failed++;
  if (l.array) {
    console.log(`  DRIFT  ${l.path}`);
    console.log(`         golden: ${JSON.stringify(l.expected)}`);
    console.log(`         now:    ${JSON.stringify(l.actual)}`);
  } else {
    console.log(`  DRIFT  ${l.path}: golden ${JSON.stringify(l.expected)} -> now ${JSON.stringify(l.actual)}`);
  }
}

const passed = leaves.length - failed;
console.log(`\n${passed} pinned values unchanged, ${failed} drifted.`);
if (failed) {
  console.log('The house-math changed. If this was intentional, re-run with --update');
  console.log('and commit the golden_numbers.json diff so the change is on the record.');
  process.exit(1);
}
console.log('Golden-number battery green — the math is locked.');
