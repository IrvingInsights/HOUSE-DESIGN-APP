// A DRAWING READ MUST CONFESS IN THE ORDINARY PLACE.
//
// The reader is a statistical thing: the same plan read twice can differ, and
// no amount of prompting fixes that. The strategy the app settled on is to
// engineer around it — the app scores its own reading and shows the doubts.
// The rule that makes it work is this: doubts are NOT a special screen. They
// are ordinary "Worth a look" flags, in the panel that already exists, and
// the ones that can re-check themselves CLEAR THEMSELVES when the thing is
// fixed. A doubt that needs its own window is a doubt nobody reads.
//
// This battery holds that contract from the model's side, with no server and
// no AI key: given a design carrying a read's own report, the flags must
// appear, be readable, and go away when the underlying problem goes away.
//
// Run: node tools/trace_flags_test.mjs
import { seedSpec, detectIssues } from '../src/engine.js';

let pass = 0; let fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass += 1; console.log(`  ok  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};

const withReview = (checks, extra = {}) => ({
  ...structuredClone(seedSpec),
  traceReview: { score: checks.filter((c) => c.pass).length, of: checks.length, checks },
  ...extra
});

console.log('a read that doubts itself says so, where everything else is said:');

// 1 — a failed check becomes a flag in the ordinary list.
{
  const spec = withReview([
    { name: 'rooms measured', pass: true },
    { name: 'rooms inside the walls', pass: false, note: 'Two rooms sit outside the walls the drawing shows.' }
  ]);
  const flags = detectIssues(spec).filter((i) => i.severity !== 'pass');
  const clean = detectIssues(structuredClone(seedSpec)).filter((i) => i.severity !== 'pass');
  check(flags.length > clean.length, 'a failed read check adds a flag', `${clean.length} -> ${flags.length}`);
  const mine = flags.filter((f) => !clean.some((c) => c.title === f.title));
  check(mine.length > 0, 'and the flag is new, not a coincidence');
  check(mine.every((f) => typeof f.title === 'string' && f.title.length > 3), 'every one of them has something to read');
  check(mine.some((f) => /outside the walls|rooms inside/i.test(`${f.title} ${f.fix || ''}`)),
    'and it repeats the reader\'s own words, not a code', mine.map((f) => f.title).join(' | '));
}

// 2 — a read with nothing wrong adds nothing. A grade is not a complaint.
{
  const spec = withReview([
    { name: 'rooms measured', pass: true },
    { name: 'rooms inside the walls', pass: true }
  ]);
  const flags = detectIssues(spec).filter((i) => i.severity !== 'pass');
  const clean = detectIssues(structuredClone(seedSpec)).filter((i) => i.severity !== 'pass');
  check(flags.length === clean.length, 'a clean read adds no flags at all', `${clean.length} vs ${flags.length}`);
}

// 3 — the doubts clear when the read is replaced by a better one. This is
// what stops a design carrying a bad reading's ghost forever.
{
  const doubted = withReview([{ name: 'rooms inside the walls', pass: false, note: 'Rooms outside the walls.' }]);
  const before = detectIssues(doubted).filter((i) => i.severity !== 'pass').length;
  const reread = { ...doubted, traceReview: { score: 1, of: 1, checks: [{ name: 'rooms inside the walls', pass: true }] } };
  const after = detectIssues(reread).filter((i) => i.severity !== 'pass').length;
  check(after < before, 'a better reading clears the doubt it raised', `${before} -> ${after}`);
}

// 4 — no read at all is not a problem. Most designs never see a drawing.
{
  const flags = detectIssues(structuredClone(seedSpec));
  check(!flags.some((f) => /read|trace|drawing/i.test(f.title || '')), 'a design that never saw a drawing is never nagged about one');
}

// 5 — a malformed report must not throw. The reader is the thing most likely
// to hand back something odd, and a crash here takes the whole app down.
{
  for (const junk of [null, {}, { checks: null }, { checks: 'nonsense' }, { checks: [{}] }, { checks: [{ pass: false }] }]) {
    let threw = null;
    try { detectIssues({ ...structuredClone(seedSpec), traceReview: junk }); } catch (e) { threw = e; }
    check(!threw, `a broken read report (${JSON.stringify(junk).slice(0, 28)}) does not crash the checks`, threw?.message);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
