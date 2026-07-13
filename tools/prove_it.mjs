// The proof battery (STRATEGY Phase 3): everything that must be true before
// the app goes to testers, in one command, with a plain-language report.
//
//   node tools/prove_it.mjs                      # the ship gate: 3 sweeps (~12 reads, cents)
//   node tools/prove_it.mjs --stability 20       # + the ONE-TIME placement marathon
//   node tools/prove_it.mjs --sweeps 1           # quick confidence pass
//
// Or just double-click PROVE-IT.bat. Runs the unit suites (seconds, free),
// then N full trace-corpus sweeps and K stability runs of one drawing
// (minutes each, pennies each — needs the Gemini key). Writes
// PROOF-REPORT.md next to the app. The server is started automatically if
// it isn't running. All AI runs are persist:false — designs are never touched.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
// Cost dial: the default battery is the CHEAP one (~12 drawing-reads, well
// under half a dollar). The 20-trace stability marathon is a ONE-TIME formal
// record — run `PROVE-IT.bat --stability 20` once, keep the report, done.
const SWEEPS = Math.max(1, Math.min(5, Number(arg('sweeps', 3)) || 3));
const stabilityArg = Number(arg('stability', 0));
const STABILITY_RUNS = Math.max(0, Math.min(20, Number.isFinite(stabilityArg) ? stabilityArg : 0));
const STABILITY_SET = arg('set', 'columbia-rev1');

const lines = [];
const say = (text) => { console.log(text); lines.push(text); };
const startedAt = new Date();

const run = (args, label) => {
  console.log(`\n>>> ${label}`);
  const res = spawnSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  process.stdout.write(out.split('\n').slice(-14).join('\n') + '\n');
  return { code: res.status, out };
};

// --- the server must be up for the AI runs -----------------------------------
const serverUp = async () => {
  try { const r = await fetch('http://127.0.0.1:5184/api/projects/current'); return r.ok; } catch { return false; }
};
if (!(await serverUp())) {
  console.log('Starting the app server…');
  spawn('node', ['server.mjs'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 15 && !(await serverUp()); i += 1) await new Promise((r) => setTimeout(r, 2000));
  if (!(await serverUp())) { console.log('Could not start the server — double-click start.bat first, then run this again.'); process.exit(1); }
}

say(`# Proof report — ${startedAt.toLocaleString()}`);
say('');
say('What this proves: the app reads drawings dependably (scored against 11');
say('checks with no per-drawing answer key), places rooms the same way every');
say('time, and its core logic passes every unit check. The bar to send it to');
say(`testers: every unit suite green, ${SWEEPS} corpus sweep(s) in a row with every`);
say('set at 10/11 or better, and no placement divergence in the stability runs.');
say('');

// --- 1. unit suites (free, seconds) ------------------------------------------
say('## 1. Unit suites');
let unitsGreen = true;
for (const suite of ['op_smoke_test.mjs', 'trace_repair_test.mjs', 'geom_core_test.mjs']) {
  const { code, out } = run([`tools/${suite}`], suite);
  const tail = (out.trim().split('\n').pop() || '').trim();
  const green = code === 0;
  unitsGreen = unitsGreen && green;
  say(`- ${suite}: ${green ? 'GREEN' : 'FAILED'} (${tail})`);
}
say('');

// --- 2. corpus sweeps ---------------------------------------------------------
say(`## 2. Drawing-reader sweeps (${SWEEPS})`);
let cleanSweeps = 0;
let sweepsWithSkips = 0;
for (let s = 1; s <= SWEEPS; s += 1) {
  if (s > 1) { console.log('\n(pausing 3 minutes between sweeps for API rate limits)'); await new Promise((r) => setTimeout(r, 180000)); }
  const { out } = run(['tools/trace_corpus_test.mjs'], `corpus sweep ${s}/${SWEEPS}`);
  const summary = (out.trim().split('\n').pop() || '').trim();
  // Judge by the summary line alone: real failures beat rate-limit skips,
  // and a fully-refused sweep (NOTHING TESTED) is quota, not failure.
  const failures = Number((/(\d+) invariant failure/.exec(summary) || [])[1] || 0) > 0;
  const skipped = Number((/\((\d+) skipped/.exec(summary) || [])[1] || 0) > 0 || /NOTHING TESTED/.test(summary);
  const clean = /CORPUS CLEAN/.test(summary) && !skipped;
  if (clean) cleanSweeps += 1;
  if (!failures && skipped) sweepsWithSkips += 1;
  say(`- Sweep ${s}: ${clean ? 'CLEAN' : failures ? 'FAILURES — the evidence is in .data/trace-corpus/*.lastfail.json' : 'INCOMPLETE — the AI service refused some sets (rate limits); re-run later'} — ${summary}`);
}
say('');

// --- 3. placement stability ----------------------------------------------------
if (STABILITY_RUNS >= 2) {
  say(`## 3. Placement stability (${STABILITY_RUNS} traces of ${STABILITY_SET})`);
  const { code, out } = run(['tools/trace_stability_test.mjs', STABILITY_SET, String(STABILITY_RUNS)], 'stability runs');
  const summaryLines = out.trim().split('\n').filter((l) => /distinct|IDENTICAL|DIVERGED|DETERMINISTIC|PLACEMENT BUG/.test(l));
  summaryLines.forEach((l) => say(`- ${l.trim()}`));
  say(`- Verdict: ${code === 0 ? 'placement never diverged' : 'PLACEMENT BUG — identical reads landed different layouts'}`);
  say('');
}

// --- verdict -------------------------------------------------------------------
const minutes = Math.round((Date.now() - startedAt.getTime()) / 60000);
say('## Verdict');
if (unitsGreen && cleanSweeps === SWEEPS) {
  say(`**READY.** Every suite green and all ${SWEEPS} sweep(s) clean (took ${minutes} min).`);
  say('Next: send TESTING.md and the GitHub link (or a fresh zip) to the testers.');
} else if (unitsGreen && sweepsWithSkips > 0 && cleanSweeps + sweepsWithSkips === SWEEPS) {
  say(`**ALMOST.** Suites green; ${cleanSweeps}/${SWEEPS} sweeps clean and ${sweepsWithSkips} cut short by AI rate limits (not failures). Run this again when the quota resets — overnight works well.`);
} else {
  say(`**NOT YET.** ${unitsGreen ? '' : 'A unit suite failed. '}${cleanSweeps}/${SWEEPS} sweeps clean. Every failed set leaves a <set>.lastfail.json beside its PDF in .data/trace-corpus/ — that file is the evidence to hand the next session.`);
}
say('');
say('Add any drawing to the tests forever by dropping its PDF into .data/trace-corpus/.');
say('Good reads from real use collect themselves in .data/trace-corpus/captured/ — move one up a level to promote it.');

fs.writeFileSync(path.join(process.cwd(), 'PROOF-REPORT.md'), lines.join('\n') + '\n');
console.log(`\nReport written: PROOF-REPORT.md (${minutes} min total)`);
process.exit(unitsGreen && cleanSweeps === SWEEPS ? 0 : 1);
