// THE ASK BATTERY — what the chat does when nobody is watching.
//
// The old build's chat could only ever be tested by typing into it, which is
// why its honesty rules ("say when the AI is down", "never pretend a drawing
// was read") were only as good as somebody remembering to check. The ladder
// now lives in src/studio/ask.js as a pure function, so every rung can be
// proven from the command line, with NO server and NO AI key:
//
//   - a plain "add a bedroom" is placed by the layout engine, not the AI
//   - duplicate openings are cleaned by the engine, not the AI
//   - an instruction to read a drawing with nothing attached is refused
//   - a drawing attached with nothing asked is not read on a guess
//   - when the engine cannot be reached, it SAYS SO and changes nothing
//   - when the AI service is out of credit, that is said too — never covered
//     over with a canned answer that reads like it worked
//
// Run: node tools/studio_ask_test.mjs
import { seedSpec } from '../src/engine.js';
import { askStudio, aiUnavailableNotice, isConnectionError, plainDescription } from '../src/studio/ask.js';

let pass = 0; let fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass += 1; console.log(`  ok  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};
const said = (r) => (r.messages || []).map((m) => m.text).join('\n');

// The browser's fetch does not exist here; every test that would reach the
// server installs its own, so an accidental real call fails loudly instead of
// hanging.
globalThis.fetch = async () => { throw new Error('failed to fetch'); };

const base = structuredClone(seedSpec);

console.log('the ask ladder:');

// 1 — rooms are placed by the layout engine, with no AI in the loop at all.
{
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('failed to fetch'); };
  const r = await askStudio({ prompt: 'add a bedroom', spec: base });
  check(Boolean(r.nextSpec), 'a room is added without the AI');
  check(!called, 'and the planner was never called for it');
  check((r.nextSpec?.rooms || []).length === base.rooms.length + 1, 'exactly one room appeared',
    `${base.rooms.length} -> ${(r.nextSpec?.rooms || []).length}`);
  check(/added/i.test(said(r)), 'and it says what it added');
}

// 2 — duplicate openings: the engine's own operation, no AI.
{
  const doubled = structuredClone(base);
  doubled.openings = [...doubled.openings, structuredClone(doubled.openings[0])];
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('failed to fetch'); };
  const r = await askStudio({ prompt: 'remove the duplicate windows', spec: doubled });
  check(Boolean(r.nextSpec), 'duplicate openings are cleaned up');
  check(!called, 'and that never touches the AI either');
  check((r.nextSpec?.openings || []).length < doubled.openings.length, 'one of the pair is gone',
    `${doubled.openings.length} -> ${(r.nextSpec?.openings || []).length}`);
}

// 3 — the truth gate: no drawing attached, so nothing was read.
{
  const r = await askStudio({ prompt: 'read this drawing and build the model', spec: base });
  check(!r.nextSpec, 'an instruction to read a drawing with none attached changes nothing');
  check(/no drawing attached/i.test(said(r)), 'and says exactly that', said(r).slice(0, 80));
}

// 4 — a drawing with no instruction is not acted on by guesswork.
{
  const r = await askStudio({ prompt: '', spec: base, attachments: [{ id: '1', name: 'plan.pdf', kind: 'pdf', src: 'data:application/pdf;base64,AA==' }] });
  check(!r.nextSpec, 'a drawing on its own is not read on a guess');
  check(/tell me what to do with it/i.test(said(r)), 'it asks what to do with it');
}

// 5 — the engine is off: say so, change nothing, blame nothing else.
{
  globalThis.fetch = async () => { throw new Error('Failed to fetch'); };
  const r = await askStudio({ prompt: 'move the kitchen to the north-east corner', spec: base });
  check(!r.nextSpec, 'nothing changes when the engine cannot be reached');
  check(/could not reach the design engine/i.test(said(r)), 'and it says the engine is the problem');
  check(!/could not turn/i.test(said(r)), 'never blames the request instead');
}

// 6 — the AI service is out of credit: that is said, not covered over.
{
  const spent = aiUnavailableNotice(['AI planner unavailable: 429 RESOURCE_EXHAUSTED quota']);
  check(Boolean(spent), 'an exhausted AI key produces a notice');
  check(/credit is used up/i.test(String(spent)), 'and says the credit ran out');
  const nokey = aiUnavailableNotice(['AI planner unavailable: 401 {"error":{"message":"Unauthorized","code":"no_matching_rule"}}']);
  check(/not set up/i.test(String(nokey)), 'a missing key says the app is not set up, not "unauthorized"');
  check(/.env.local/.test(String(nokey)), 'and says exactly which file to make');
  check(!/[{}]|no_matching_rule/.test(String(nokey)), 'and never dumps raw error text at the reader');
  const odd = aiUnavailableNotice(['AI planner unavailable: something odd {"raw":1}']);
  check(!/[{}]/.test(String(odd)), 'nor for any other failure');
  check(!aiUnavailableNotice(['some other warning']), 'and an unrelated warning does not');
}

// 7 — the planner answered but changed nothing: say that plainly.
{
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ plan: { warnings: [] }, report: { actions: [], spec: base, changedIds: [], warnings: [], assumptions: [], questions: [], summary: '' } })
  });
  const r = await askStudio({ prompt: 'do something ineffable to the roof', spec: base });
  check(!r.nextSpec, 'a plan with no actions changes nothing');
  check(/nothing was changed/i.test(said(r)), 'and says nothing was changed');
}

// 8 — the planner worked: exactly one new design comes back.
{
  const changed = structuredClone(base);
  changed.shell.widthFt = 40;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ plan: { warnings: [] }, report: { actions: ['Updated shell widthFt to 40.'], spec: changed, changedIds: ['shell'], warnings: [], assumptions: [], questions: [], summary: 'Widened the house.' } })
  });
  const r = await askStudio({ prompt: 'make the house 40 feet wide', spec: base });
  check(r.nextSpec?.shell?.widthFt === 40, 'the planner\'s design comes back');
  check(/widened|updated/i.test(said(r)), 'and the reply says what changed');
}

// 9 — connection errors are recognised however the browser words them.
{
  check(isConnectionError(new Error('Failed to fetch')), 'chrome wording');
  check(isConnectionError(new Error('NetworkError when attempting to fetch')), 'firefox wording');
  check(isConnectionError(new Error('Load failed')), 'safari wording');
  check(!isConnectionError(new Error('BIM apply failed with HTTP 500')), 'a server error is not a connection error');
}

// 10 — asking the team with no AI key: an honest note plus the app's own
// plain description, never a canned paragraph that reads like an answer.
{
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ source: 'studio-error', reply: '', warnings: ['Cannot read properties of undefined'] })
  });
  const r = await askStudio({ prompt: 'what is this house made of?', spec: base, target: 'team' });
  const text = said(r);
  check(/needs an AI key|not set up/i.test(text), 'it says the AI is not switched on');
  check(/\d+ by \d+ feet/.test(text), 'and still describes the house in plain words', text.slice(0, 90));
  check(!/\bBIM\b|snapshot|\bprompt\b/i.test(text), 'with no jargon in it', text.slice(0, 130));
  check(!r.nextSpec, 'and asking the team never changes the design');
  const plain = plainDescription(base);
  check(!/\bBIM\b|\bspec\b|\bshell\b/i.test(plain), 'the plain description carries no jargon either', plain.slice(0, 90));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
