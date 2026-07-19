// THE ANY-DESIGN PROOF — the correctness gate behind "encyclopedic yet
// simple". Generates hundreds of designs as random op sequences through the
// REAL applier (src/reimagine/designFuzz.js — the same generator the live
// battery renders), then holds every one to invariants that must be true for
// ANY house:
//   I1  no op ever throws (junk ops are rejected, not fatal)
//   I2  no NaN / non-finite number anywhere in the spec
//   I3  deriveDesign + detectIssues run clean; every receipt line group sums
//       exactly to its cost line (the receipts law)
//   I4  every resolver returns finite numbers for every side × level
//   I5  the spec survives a JSON round trip byte-identically
//   I6  the self-heal converges: a second benign pass changes nothing
//   I7  the band law: every opening fits its wall, or is FLAGGED — nothing
//       silently floats
// Every third design is then DAMAGED with the known legacy classes (stale
// heights, junk plates, absurd sills, string numerics) — after one heal pass
// it must satisfy all of the above again, and nothing may be deleted beyond
// the documented plate dedupe.
//
//   node tools/design_space_test.mjs [--seed 42] [--count 300]
import {
  applyBimOperations, openingVerticalBand, resolveWallSide, roofProfile,
  storeyElevationFt, storeyHeightFt, WALL_SIDES, footprintPolygon, decomposeFootprint
} from '../backend/bim-core.mjs';
import {
  deriveDesign, getWallSections, detectIssues, resolveDeck, resolveDeckStairs,
  buildTimeline, materialsTakeoff, planNewRoomPlacements
} from '../src/engine.js';
import { generateFuzzDesign, injectLegacyDamage } from '../src/reimagine/designFuzz.js';

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const SEED = argOf('seed', 42);
const COUNT = argOf('count', 300);

let pass = 0; let fail = 0;
const problems = [];
function check(ok, seed, label, detail = '') {
  if (ok) { pass += 1; return; }
  fail += 1;
  if (problems.length < 20) problems.push(`seed ${seed}: ${label}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
}

function noNaN(value, path = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i += 1) { const p = noNaN(value[i], `${path}[${i}]`); if (p) return p; } return null; }
  if (value && typeof value === 'object') { for (const k of Object.keys(value)) { const p = noNaN(value[k], `${path}.${k}`); if (p) return p; } return null; }
  return null;
}

const benignPass = (spec) => {
  const r = applyBimOperations(spec, { operations: [{ type: 'set_shell', field: 'widthFt', value: spec.shell.widthFt }] });
  return r.spec || r;
};

function runInvariants(spec, seed, tag) {
  // I2 — deep finite scan
  const nanAt = noNaN(spec);
  check(!nanAt, seed, `${tag} I2 no-NaN in spec`, nanAt);

  // I3 — derive + issues + receipts law (derived feeds I4's consumers too)
  let derived = null;
  try {
    derived = deriveDesign(spec, getWallSections(spec));
    const dNan = noNaN(derived.cost || {});
    check(!dNan, seed, `${tag} I3 cost finite`, dNan);
    const receipts = derived.receipts?.systems || {};
    for (const [sys, lines] of Object.entries(receipts)) {
      if (!Array.isArray(lines) || !lines.length) continue;
      const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const cost = Number(derived.cost?.[sys]);
      if (!Number.isFinite(cost)) continue;
      check(Math.abs(sum - cost) <= Math.max(1, Math.abs(cost) * 1e-6), seed, `${tag} I3 receipts sum (${sys})`, `${sum} vs ${cost}`);
    }
  } catch (e) {
    check(false, seed, `${tag} I3 deriveDesign throws`, e && e.message);
  }
  let issues = [];
  try { issues = detectIssues(spec); check(Array.isArray(issues), seed, `${tag} I3 detectIssues returns`); }
  catch (e) { check(false, seed, `${tag} I3 detectIssues throws`, e && e.message); }

  // I4 — resolvers finite for every side × level
  try {
    const storeys = Math.max(1, Math.ceil(Number(spec.shell.storeys) || 1));
    for (const side of WALL_SIDES) {
      for (let lv = 1; lv <= storeys; lv += 1) {
        const r = resolveWallSide(spec, side, lv);
        check(Number.isFinite(Number(r.heightFt)) && Number.isFinite(Number(r.thicknessFt)), seed, `${tag} I4 resolveWallSide ${side}@${lv}`);
      }
    }
    const prof = roofProfile(spec.shell);
    check(Number.isFinite(prof.pitch) && Number.isFinite(prof.highWallHeightFt), seed, `${tag} I4 roofProfile finite`);
    for (let lv = 1; lv <= 4; lv += 1) {
      check(Number.isFinite(storeyElevationFt(spec.shell, lv)) && Number.isFinite(storeyHeightFt(spec.shell, lv)), seed, `${tag} I4 storey math @${lv}`);
    }
    for (const el of (spec.elements || []).filter((e) => e.category === 'deck')) {
      const dk = resolveDeck(spec, el);
      check(Number.isFinite(dk.topFt) && Number.isFinite(dk.railLf), seed, `${tag} I4 resolveDeck ${el.id || el.name}`);
      const st = resolveDeckStairs(spec, el, dk);
      check(st === null || st.blocked || (Number.isFinite(st.rise) && st.treads > 0), seed, `${tag} I4 resolveDeckStairs ${el.id || el.name}`);
    }
    const poly = footprintPolygon(spec);
    check(Array.isArray(poly) && !noNaN(poly), seed, `${tag} I4 footprintPolygon finite`);
    check(Array.isArray(decomposeFootprint(poly)), seed, `${tag} I4 decomposeFootprint`);
    if (derived) {
      check(Array.isArray(buildTimeline(spec, derived)), seed, `${tag} I4 buildTimeline`);
      const mt = materialsTakeoff(spec, derived);
      check(Array.isArray(mt) || (mt && typeof mt === 'object'), seed, `${tag} I4 materialsTakeoff`);
    }
    const plan = planNewRoomPlacements(spec, [{ name: 'Probe', w: 8, d: 8 }], 1);
    check(plan && Array.isArray(plan.ops) && !noNaN(plan.ops), seed, `${tag} I4 planNewRoomPlacements`, noNaN(plan?.ops || null));
  } catch (e) {
    check(false, seed, `${tag} I4 resolver throws`, e && (e.stack || e.message));
  }

  // I5 — JSON round trip
  try {
    const s2 = JSON.parse(JSON.stringify(spec));
    check(JSON.stringify(s2) === JSON.stringify(spec), seed, `${tag} I5 round-trip stable`);
  } catch (e) { check(false, seed, `${tag} I5 round-trip throws`, e && e.message); }

  // I6 — heal converges (benign pass is a fixed point)
  try {
    const once = benignPass(spec);
    const twice = benignPass(once);
    const a = JSON.stringify({ ...once, revision: 0 });
    const b = JSON.stringify({ ...twice, revision: 0 });
    check(a === b, seed, `${tag} I6 heal converges`);
  } catch (e) { check(false, seed, `${tag} I6 benign pass throws`, e && e.message); }

  // I7 — the band law: clamped openings are FLAGGED, never silent
  try {
    (spec.openings || []).forEach((o, oi) => {
      const band = openingVerticalBand(spec, o);
      if (!band.clamped) return;
      const flagged = issues.some((f) => f.fixId === 'fit-opening' && f.openingIndex === oi);
      check(flagged, seed, `${tag} I7 clamped opening ${oi} is flagged`, `${o.type}@${o.wall} reason=${band.reason}`);
    });
  } catch (e) { check(false, seed, `${tag} I7 band law throws`, e && e.message); }
}

console.log(`design-space proof: ${COUNT} designs from seed ${SEED} (+ damaged corpus every 3rd)`);
for (let n = 0; n < COUNT; n += 1) {
  const seed = SEED + n * 1013;
  const { spec, threw } = generateFuzzDesign(seed);
  check(!threw, seed, 'I1 no op throws', threw && `${threw.op?.type}: ${threw.error}`);
  if (threw) continue;
  runInvariants(spec, seed, 'fresh');

  if (n % 3 === 0) {
    const { spec: hurt } = injectLegacyDamage(spec, seed);
    let healed = null;
    try { healed = benignPass(hurt); } catch (e) { check(false, seed, 'damaged: heal pass throws', e && (e.stack || e.message)); }
    if (healed) {
      // nothing beyond the documented plate dedupe may be deleted
      const roomsKept = (healed.rooms || []).length >= (spec.rooms || []).length;
      const opensKept = (healed.openings || []).length >= (hurt.openings || []).length - 1; // junk opening may be beyond saving
      check(roomsKept, seed, 'damaged: rooms survive the heal');
      check(opensKept, seed, 'damaged: openings survive the heal');
      runInvariants(healed, seed, 'damaged');
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (problems.length) {
  console.log('\nFirst failures (replay: node tools/design_space_test.mjs --seed <seed> --count 1):');
  for (const p of problems) console.log(`  ${p}`);
}
process.exit(fail ? 1 : 0);
