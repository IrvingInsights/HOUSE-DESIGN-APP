// Phase 2 exit test: trace ONE drawing N times and compare the room layouts.
// The tiler makes placement deterministic, so runs whose READS agree (same
// rooms, same sizes) must land byte-identical layouts; runs may still differ
// when the AI reads different rooms/sizes (that is Phase 1's referee's job to
// flag, not a placement bug). The report separates the two.
//
//   node tools/trace_stability_test.mjs <set-substring> [runs]
//
// Needs the app server running. All runs persist:false — the live design is
// never touched. Each run costs a normal trace (~1-4 min + pennies).
import fs from 'node:fs';
import path from 'node:path';

const CORPUS = path.join(process.cwd(), '.data', 'trace-corpus');
const match = process.argv[2];
const runs = Math.max(2, Math.min(20, Number(process.argv[3]) || 3));
if (!match) {
  console.log('Usage: node tools/trace_stability_test.mjs <set-substring> [runs]');
  process.exit(1);
}
const pdf = fs.readdirSync(CORPUS).filter((f) => f.toLowerCase().endsWith('.pdf'))
  .find((f) => f.toLowerCase().includes(match.toLowerCase()));
if (!pdf) { console.log(`No corpus PDF matches "${match}"`); process.exit(1); }

const get = (url) => fetch(url).then((r) => r.json());
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const current = await get('http://127.0.0.1:5184/api/projects/current');
const b64 = fs.readFileSync(path.join(CORPUS, pdf)).toString('base64');

const layoutOf = (spec) => (spec.rooms || [])
  .map((r) => `${String(r.name).toLowerCase()}@${r.x},${r.y} ${r.w}x${r.d} L${r.level || 1}`)
  .sort().join('\n');
const readOf = (spec) => (spec.rooms || [])
  .map((r) => `${String(r.name).toLowerCase()} ${r.w}x${r.d} L${r.level || 1}`)
  .sort().join('\n');

const results = [];
for (let i = 0; i < runs; i += 1) {
  if (i) { console.log('  (pausing 90s between runs for API rate limits)'); await new Promise((r) => setTimeout(r, 90000)); }
  console.log(`\n=== run ${i + 1}/${runs} — ${pdf} ===`);
  const spec = structuredClone(current.state.spec);
  spec.rooms = []; spec.openings = []; spec.elements = []; spec.revision = 1;
  delete spec.shell.footprint; delete spec.shell.basementHeightFt; spec.shell.storeys = 1;
  const start = await post('http://127.0.0.1:5184/api/bim/apply', {
    async: true, persist: false, bypassCache: true,
    prompt: 'trace this design accurately', bim: spec, spec,
    attachedImages: [{ id: 'stab', name: pdf, src: `data:application/pdf;base64,${b64}`, size: b64.length, kind: 'pdf' }],
    chatMessages: []
  });
  if (!start.jobId) { console.log('  failed to start'); continue; }
  const t0 = Date.now();
  let job;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    job = await get(`http://127.0.0.1:5184/api/bim/job/${start.jobId}`);
    if (job.status !== 'running') break;
    if (Date.now() - t0 > 14 * 60 * 1000) { job = { status: 'timeout' }; break; }
  }
  if (job.status !== 'done') { console.log(`  run ${job.status}`); continue; }
  const outSpec = job.result.report.spec;
  const refused = String(job.result.plan?.source || '').startsWith('local');
  if (refused) { console.log('  skipped (AI refused)'); continue; }
  results.push({ run: i + 1, layout: layoutOf(outSpec), read: readOf(outSpec), secs: Math.round((Date.now() - t0) / 1000) });
  console.log(`  done in ${results[results.length - 1].secs}s — ${outSpec.rooms.length} rooms`);
}

if (results.length < 2) { console.log('\nNot enough completed runs to compare.'); process.exit(1); }
const layouts = new Map();
const reads = new Map();
results.forEach((r) => {
  layouts.set(r.layout, (layouts.get(r.layout) || []).concat(r.run));
  reads.set(r.read, (reads.get(r.read) || []).concat(r.run));
});
console.log(`\n${results.length} completed runs -> ${reads.size} distinct READS -> ${layouts.size} distinct LAYOUTS`);
for (const [read, runIds] of reads) {
  const layoutsForRead = new Set(results.filter((r) => runIds.includes(r.run)).map((r) => r.layout));
  console.log(`  read shared by runs [${runIds.join(', ')}] -> ${layoutsForRead.size} layout(s) ${layoutsForRead.size === 1 ? 'IDENTICAL ✓' : 'DIVERGED ✗ (placement bug!)'}`);
}
const placementDeterministic = [...reads.values()].every((runIds) => new Set(results.filter((r) => runIds.includes(r.run)).map((r) => r.layout)).size === 1);
console.log(placementDeterministic
  ? '\nPLACEMENT DETERMINISTIC: every run with the same read landed the same layout.'
  : '\nPLACEMENT BUG: identical reads produced different layouts — the tiler is not deterministic.');
process.exit(placementDeterministic ? 0 : 1);
