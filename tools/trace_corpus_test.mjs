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

// ---- Universal invariants: true of ANY correctly traced dwelling ----
function scoreTrace({ spec, plan }) {
  const checks = [];
  const rooms = spec.rooms || [];
  const openings = spec.openings || [];
  const shellW = Number(spec.shell.widthFt) || 0;
  const shellD = Number(spec.shell.depthFt) || 0;
  const add = (name, pass, detail = '') => checks.push({ name, pass, detail });

  add('traced at least 2 rooms', rooms.length >= 2, `${rooms.length} rooms`);

  // Placeholder signature: most rooms sharing one identical size
  const sizes = new Map();
  rooms.forEach((r) => { const k = `${r.w}x${r.d}`; sizes.set(k, (sizes.get(k) || 0) + 1); });
  const biggestShare = rooms.length ? Math.max(...sizes.values()) / rooms.length : 0;
  add('rooms individually measured (no placeholder run)', rooms.length < 4 || biggestShare < 0.6,
    `${Math.round(biggestShare * 100)}% share one size`);

  // Ground rooms inside the shell
  const strays = rooms.filter((r) => Number(r.level || 1) === 1
    && (r.x < -0.5 || r.y < -0.5 || r.x + r.w > shellW + 0.5 || r.y + r.d > shellD + 0.5));
  add('every ground-floor room inside the shell', strays.length === 0, strays.map((r) => r.name).join(', '));

  // Rooms named for the basement live below grade (when a basement exists)
  const basement = Number(spec.shell.basementHeightFt) > 0;
  const misleveled = rooms.filter((r) => /basement/i.test(r.name || '') && Number(r.level || 1) !== -1);
  add('basement-named rooms on the basement level', !basement || misleveled.length === 0, misleveled.map((r) => r.name).join(', '));

  // Openings sanity floor: any dwelling has a door and windows
  add('a believable number of openings', openings.length >= Math.max(4, Math.min(rooms.length, 8)), `${openings.length} openings`);

  // Openings positioned within their wall
  const badPos = openings.filter((o) => {
    const along = o.wall === 'north' || o.wall === 'south' ? Number(o.x) || 0 : Number(o.y) || 0;
    const wallLen = o.wall === 'north' || o.wall === 'south' ? shellW : shellD;
    return o.wall !== 'roof' && (along < -0.5 || along + (Number(o.widthFt) || 3) > wallLen + 1);
  });
  add('openings sit within their walls', badPos.length === 0, `${badPos.length} out of range`);

  // Partitions inside the shell
  const strayParts = (spec.elements || []).filter((e) => e.category === 'partition'
    && (e.x < -0.5 || e.y < -0.5 || e.x + e.w > shellW + 1 || e.y + e.d > shellD + 1));
  add('interior walls inside the shell', strayParts.length === 0, strayParts.map((e) => e.name).join(', '));

  // Shell agrees with the drawing's own dimension strings (when indexed)
  const idx = (plan.warnings || []).find((w) => /drawing index/i.test(w)) || '';
  const devWarn = (plan.warnings || []).some((w) => /dimension strings say/i.test(w));
  add('shell matches the drawing index (or no index)', !devWarn, idx.slice(0, 60));

  // Self-check convergence: corrections must not grow round over round
  const roundFixes = (plan.warnings || [])
    .map((w) => /self-check round (\d+): corrected (\d+)/i.exec(w))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => Number(m[2]));
  add('self-check converging (fixes not growing)', roundFixes.length < 2 || roundFixes[1] <= roundFixes[0], roundFixes.join(' -> '));

  return checks;
}

const current = await get('http://127.0.0.1:5184/api/projects/current');
let totalFail = 0;
for (const file of pdfs) {
  console.log(`\n=== ${file} ===`);
  const b64 = fs.readFileSync(path.join(CORPUS, file)).toString('base64');
  const spec = structuredClone(current.state.spec);
  spec.rooms = []; spec.openings = []; spec.elements = []; spec.revision = 1;
  delete spec.shell.footprint; delete spec.shell.basementHeightFt; spec.shell.storeys = 1;

  const start = await post('http://127.0.0.1:5184/api/bim/apply', {
    async: true, persist: false,
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

  const checks = scoreTrace({ spec: job.result.report.spec, plan: job.result.plan });
  const fails = checks.filter((c) => !c.pass);
  checks.forEach((c) => console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`));
  console.log(`  -> ${checks.length - fails.length}/${checks.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  totalFail += fails.length;
}
console.log(`\n${totalFail === 0 ? 'CORPUS CLEAN' : `${totalFail} invariant failure(s)`} across ${pdfs.length} set(s)`);
process.exit(totalFail ? 1 : 0);
