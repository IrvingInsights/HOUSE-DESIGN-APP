// Trace regression corpus: run the FULL trace pipeline against every drawing
// set in .data/trace-corpus/ (gitignored — drawings never leave this machine)
// and score UNIVERSAL invariants that hold for any house, with no per-drawing
// expected answers. Add any set that ever misbehaves; a fix must pass them all.
//
//   node tools/trace_corpus_test.mjs [--only <substring>]
//
// Needs the app server running (node server.mjs). Each set takes 3-8 minutes.
// All runs are persist:false — the live design is never touched.
import fs from 'node:fs';
import path from 'node:path';
import { request } from 'node:http';
import { scoreTrace } from '../backend/planner.mjs';

const CORPUS = path.join(process.cwd(), '.data', 'trace-corpus');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

if (!fs.existsSync(CORPUS)) {
  fs.mkdirSync(CORPUS, { recursive: true });
  console.log(`Corpus folder created: ${CORPUS}`);
  console.log('Drop drawing-set PDFs in it and run again. (It is inside .data/, so nothing is ever committed.)');
  process.exit(0);
}
const pdfs = fs.readdirSync(CORPUS).filter((f) => f.toLowerCase().endsWith('.pdf'))
  .filter((f) => !only || f.toLowerCase().includes(only.toLowerCase()));
if (!pdfs.length) {
  console.log(`No PDFs${only ? ` matching "${only}"` : ''} in ${CORPUS}`);
  process.exit(0);
}

const post = (url, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let text = '';
    res.on('data', (c) => { text += c; });
    res.on('end', () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } });
  });
  req.on('error', reject);
  req.end(data);
});
const get = (url) => fetch(url).then((r) => r.json());

const current = await get('http://127.0.0.1:5184/api/projects/current');
let totalFail = 0;
let skipped = 0;
let first = true;
for (const file of pdfs) {
  if (!first) {
    console.log('  (pausing 90s between sets to stay under API rate limits)');
    await new Promise((r) => setTimeout(r, 90000));
  }
  first = false;
  console.log(`\n=== ${file} ===`);
  const b64 = fs.readFileSync(path.join(CORPUS, file)).toString('base64');
  const spec = structuredClone(current.state.spec);
  spec.rooms = []; spec.openings = []; spec.elements = []; spec.revision = 1;
  delete spec.shell.footprint; delete spec.shell.basementHeightFt; spec.shell.storeys = 1;

  const start = await post('http://127.0.0.1:5184/api/bim/apply', {
    async: true, persist: false, bypassCache: true,
    prompt: 'trace this design accurately',
    bim: spec, spec,
    attachedImages: [{ id: 'corpus', name: file, src: `data:application/pdf;base64,${b64}`, size: b64.length, kind: 'pdf' }],
    chatMessages: []
  });
  if (!start.jobId) { console.log('  FAILED to start:', JSON.stringify(start).slice(0, 120)); totalFail += 1; continue; }
  const t0 = Date.now();
  let job;
  let seen = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    job = await get(`http://127.0.0.1:5184/api/bim/job/${start.jobId}`);
    (job.notes || []).slice(seen).forEach((n) => console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${n}`));
    seen = (job.notes || []).length;
    if (job.status !== 'running') break;
    if (Date.now() - t0 > 14 * 60 * 1000) { job = { status: 'timeout' }; break; }
  }
  if (job.status !== 'done') { console.log(`  JOB ${job.status}: ${job.error || ''}`); totalFail += 1; continue; }

  // An API refusal (rate limit / quota) is not a pipeline failure — report
  // it as SKIPPED instead of failing invariants the trace never got to run.
  const planWarnings = job.result.plan?.warnings || [];
  const refused = planWarnings.some((w) => /planner unavailable|429|quota|rate.?limit/i.test(w))
    || String(job.result.plan?.source || '').startsWith('local');
  if (refused) {
    console.log(`  SKIPPED — the AI service refused (rate limit/quota). Re-run later: node tools/trace_corpus_test.mjs --only ${file.replace('.pdf', '')}`);
    skipped += 1;
    continue;
  }

  const checks = scoreTrace({ spec: job.result.report.spec, plan: job.result.plan });
  const fails = checks.filter((c) => !c.pass);
  checks.forEach((c) => console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`));
  console.log(`  -> ${checks.length - fails.length}/${checks.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  if (fails.length) {
    // Evidence on failure: the full spec + plan that failed, on disk — one
    // dump replaces a diagnosis round (the digit-loop lesson).
    const dump = path.join(CORPUS, `${file.replace('.pdf', '')}.lastfail.json`);
    fs.writeFileSync(dump, JSON.stringify({ when: new Date().toISOString(), fails, spec: job.result.report.spec, plan: job.result.plan }, null, 2));
    console.log(`  evidence: ${dump}`);
  }
  totalFail += fails.length;
}
const tested = pdfs.length - skipped;
console.log(`\n${tested === 0 ? 'NOTHING TESTED — the AI service refused every set (quota); try again after it resets'
  : totalFail === 0 ? `CORPUS CLEAN across ${tested} tested set(s)` : `${totalFail} invariant failure(s) across ${tested} tested set(s)`}${skipped && tested ? ` (${skipped} skipped on rate limits — re-run those later)` : ''}`);
process.exit(totalFail ? 1 : 0);
