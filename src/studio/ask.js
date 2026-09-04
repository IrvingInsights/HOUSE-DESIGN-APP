// THE ASK — one function that turns a sentence into a change to the house.
//
// It is deliberately PURE: it takes the design and what was said, and returns
// the next design plus what to say back. Nothing in here touches React state,
// which is why it can be tested from the command line without a browser (see
// tools/studio_ask_test.mjs) — the old build's version of this was 150 lines
// tangled into a component and could only ever be tested by hand.
//
// THE LADDER, in order, because each rung is faster and surer than the next:
//   1. a question is answered, never "applied"
//   2. a drawing with no instruction is refused, with the reason
//   3. duplicate windows/doors are cleaned by the engine — no AI needed
//   4. "add a bedroom" is placed by the layout engine — no AI needed
//   5. anything else goes to the planner, and comes back as ONE change
//   6. if the planner cannot be reached, that is SAID, never covered over
//
// The planner is always called with persist:false. The server plans and
// applies; this app remains the only thing that writes the design file. A
// second writer is how a design gets overwritten by a shape it never had.
import {
  requestServerAppliedBim, requestServerAppliedBimAsync, requestStudioResponse,
  parseLocalRoomAdds, planNewRoomPlacements, isConsultativePrompt,
  buildStudioConversationResponse, structuredPlanSummary, buildContextPacket,
  applyNaturalLanguageDesign, interpreterSummary, detectIssues
} from '../engine.js';
import { applyBimOperations } from '../../backend/bim-core.mjs';

export const you = (text, image) => ({ role: 'user', speaker: 'You', text, ...(image ? { image } : {}) });
export const studio = (text) => ({ role: 'studio', speaker: 'Studio', text });

export function isConnectionError(error) {
  return /failed to fetch|networkerror|load failed|connection refused|network request failed/i.test(String(error?.message || error));
}

// When the AI service itself failed, say so. A canned answer in its place is
// the worst outcome: it reads as the app working while nothing was read.
export function aiUnavailableNotice(warnings) {
  const hit = (warnings || []).find((w) => /(planner|studio vision) unavailable/i.test(String(w)));
  if (!hit) return null;
  const text = String(hit);
  // NOT SET UP is a different problem from OUT OF CREDIT, and both are
  // different from a service having a bad minute. Each gets its own sentence,
  // because each has a different thing to do about it. And none of them get
  // the raw error text: a wall of JSON in a chat bubble is not an answer.
  if (/401|unauthor|forbidden|no_matching_rule|invalid.*key|api[_ ]?key|missing key|PERMISSION_DENIED/i.test(text)) {
    return 'The AI part of the app is not set up on this computer, so nothing was read and nothing was changed. It needs a key file: copy .env.example to .env.local in the app folder and put a Gemini key in it (free at aistudio.google.com). Everything else in the app works without it.';
  }
  if (/depleted|RESOURCE_EXHAUSTED|quota|billing|prepay|429/i.test(text)) {
    return 'The AI service would not answer — its credit is used up or it is over its limit for now. Nothing was read and nothing was changed. Everything else in the app works normally without it.';
  }
  // Anything else: one short reason, never a dump.
  const reason = text.replace(/^.*unavailable:\s*/i, '').replace(/[{[][\s\S]*$/, '').trim().slice(0, 90);
  return `The AI service could not answer just now${reason ? ` (${reason})` : ''}. Nothing was changed. It is usually back in a few minutes.`;
}

const DEDUPE_RE = [
  /\b(remove|delete|clean\s?up|clear|get rid of|fix)\b[^.]*\b(duplicate|duplicated|excess|extra|overlap\w*|redundant)\b[^.]*\b(opening|window|door)/i,
  /\b(duplicate|excess|extra|overlapping)\b[^.]*\b(openings?|windows?|doors?)\b[^.]*\b(remove|delete|clean|clear|out)\b/i,
  /\bdedupe?\b.*\b(openings?|windows?|doors?)\b/i
];

// A drawing attached with no instruction is not a request. Saying "read this"
// out loud beats guessing at a full takeoff the person did not ask for.
const TRACE_WORDS = /\b(trace|read|build|takeoff|take off|model|import|from the (drawing|plan|pdf))\b/i;

export async function askStudio({
  prompt, spec, target = 'design', selected = null, addToTarget = 'auto',
  chatMessages = [], projectBrain = null, attachments = [], onNote
}) {
  const said = String(prompt || '').trim();
  const mine = [you(said, attachments[0]?.kind === 'image' ? attachments[0].src : undefined)];
  if (!said && !attachments.length) return { messages: [] };

  // 2 — the team, not the model: a question about how to build, answered.
  if (target === 'team') {
    try {
      const result = await requestStudioResponse({
        question: said, prompt: said, spec, bim: spec, selected,
        chatMessages: chatMessages.slice(-12), projectBrain
      });
      const answer = String(result?.answer || result?.reply || '').trim();
      // The app's own facts, when the server sends them instead of an answer.
      const down = aiUnavailableNotice(result?.warnings);
      // An empty answer with a warning attached is the AI having failed, and
      // it must read as that. The old build filled the silence with a canned
      // paragraph about "BIM edits" — jargon, and worse, it looked like a
      // real answer to a question nothing had actually read.
      if (!answer) {
        return { messages: [...mine, studio(`${down || AI_NOT_SET_UP}\n\n${String(result?.facts || '').trim() || plainDescription(spec)}`)] };
      }
      return { messages: [...mine, studio(answer)] };
    } catch (error) {
      if (isConnectionError(error)) return { messages: [...mine, studio(ENGINE_OFFLINE)] };
      return { messages: [...mine, studio(`${AI_NOT_SET_UP}\n\n${plainDescription(spec)}`)] };
    }
  }

  // 2b — a drawing on its own, with nothing asked of it.
  if (attachments.length && !said) {
    return { messages: [...mine, studio('Your drawing is attached. Tell me what to do with it — "read this drawing and build the model" for a full takeoff, or something narrower like "match this roof shape".')] };
  }
  // ...and an instruction to trace with nothing attached.
  if (!attachments.length && TRACE_WORDS.test(said) && /\b(drawing|plan|pdf|sketch|blueprint)\b/i.test(said)) {
    return { messages: [...mine, studio('There is no drawing attached — nothing was read. Use "Add a drawing" below, then ask again.')] };
  }

  // 3 — duplicate openings: the engine can do this exactly, no AI involved.
  if (DEDUPE_RE.some((re) => re.test(said))) {
    const report = applyBimOperations(spec, { operations: [{ type: 'dedupe_openings' }] });
    return {
      nextSpec: report.spec,
      messages: [...mine, studio(report.actions?.length
        ? `Cleaned up overlapping windows and doors. ${report.actions[0]}`
        : 'Nothing to clean up — no two openings share the same stretch of wall.')]
    };
  }

  // 3b — "make the kitchen 12 by 16": a size for a room that already exists
  // is exact arithmetic, not a judgement call, so it never goes to the AI.
  // (The AI once put the 16 in x and y and lost it — and said "12' x 0'".)
  const resize = !attachments.length ? parseLocalResize(said, spec) : null;
  if (resize) {
    const report = applyBimOperations(spec, { operations: [{ type: 'resize_object', targetId: resize.room.id, name: resize.room.name, w: resize.w, d: resize.d }] });
    return {
      nextSpec: report.spec, changedIds: [resize.room.id],
      messages: [...mine, studio(`Made ${resize.room.name} ${resize.w} by ${resize.d} feet.`)]
    };
  }

  // 4 — "add a bedroom and a bathroom": the layout engine places them.
  const localRooms = attachments.length ? null : parseLocalRoomAdds(said);
  if (localRooms && localRooms.length) {
    const level = Number(selected?.level) > 0 ? Number(selected.level) : 1;
    const plan = planNewRoomPlacements(spec, localRooms, level);
    if (plan.ops.length) {
      const report = applyBimOperations(spec, { operations: plan.ops });
      const unplaced = (plan.unplaced || []).length;
      return {
        nextSpec: report.spec,
        messages: [...mine, studio(`Added ${plan.names.join(', ')}.${unplaced ? ' There was no clear floor for all of them, so some landed overlapping — drag them apart, or grow the shape.' : ''}`)]
      };
    }
  }

  // 5 — the planner. A drawing takes minutes, so it runs as a background job
  // that reports its progress; a plain sentence is a single quick call.
  try {
    const payload = {
      prompt: said, bim: spec, spec, selected, selectedObjectId: selected?.id,
      addToTarget, attachedImages: attachments, chatMessages: chatMessages.slice(-12),
      projectBrain, contextPacket: buildContextPacket(spec, projectBrain, selected, said),
      persist: false
    };
    const result = attachments.length
      ? await requestServerAppliedBimAsync(payload, onNote)
      : await requestServerAppliedBim(payload);
    const report = result.report;
    const down = aiUnavailableNotice(result.plan?.warnings);
    if (report?.actions?.length) {
      return { nextSpec: report.spec, changedIds: report.changedIds, messages: [...mine, studio(structuredPlanSummary(report))] };
    }
    return {
      messages: [...mine, studio(down
        || (isConsultativePrompt(said, attachments)
          ? buildStudioConversationResponse(said, spec, selected, detectIssues(spec), attachments)
          : `Nothing was changed — I could not turn "${said}" into a safe change to the model. Try naming the thing and the number, like "make the kitchen 14 by 12" or "move the primary bedroom to the north-east corner".`))]
    };
  } catch (error) {
    // 6 — the engine is off. This is not about the request or the drawing,
    // and must never be reported as one.
    if (isConnectionError(error)) return { messages: [...mine, studio(ENGINE_OFFLINE)] };
    // The planner failed but the app's own parser may still understand a
    // simple instruction. If it does, apply it and say where it came from.
    const fallback = applyNaturalLanguageDesign(said, spec, attachments, addToTarget, selected);
    if (fallback?.actions?.length) {
      return {
        nextSpec: fallback.spec,
        messages: [...mine, studio(`The AI planner was unavailable (${error.message}), so the app read this itself:\n\n${interpreterSummary(fallback)}`)]
      };
    }
    return { messages: [...mine, studio(`Nothing was changed. The AI planner could not be reached: ${error.message}`)] };
  }
}

export const ENGINE_OFFLINE = 'I could not reach the design engine, so nothing was changed — this is not about your request. The engine is the black window that opened with the app; if it has closed, double-click start.bat in the app folder and try again.';

export const AI_NOT_SET_UP = 'The part of the app that answers questions needs an AI key, and there is none on this computer, so this answer is the app\'s own — not an expert reading your design. To switch the AI on, copy .env.example to .env.local in the app folder and put a Gemini key in it (free at aistudio.google.com).';

// What the app can say about a house on its own, in the words a person would
// use. No jargon, no invented opinions: only what is actually in the design.
export function plainDescription(spec) {
  const s = spec.shell || {};
  const u = spec.utilities || {};
  const rooms = (spec.rooms || []).filter((r) => Number(r.level || 1) > 0);
  const inside = rooms.reduce((sum, r) => sum + (Number(r.w) || 0) * (Number(r.d) || 0), 0);
  const walls = (spec.walls && Object.values(spec.walls).map((w) => w?.assembly).filter(Boolean)) || [];
  const wallWord = walls.length ? [...new Set(walls)].join(' and ').replace(/-/g, ' ') : 'not chosen yet';
  const storeys = Math.max(1, Math.round(Number(s.storeys) || 1));
  // A stored value nobody typed ("masonry_heater") read out loud.
  const humanWord = (v) => (v ? String(v).replace(/_/g, ' ') : '');
  const HEAT = { wood_stove: 'a wood stove', masonry: 'a masonry heater', masonry_heater: 'a masonry heater', mini_split: 'a heat pump', none: 'nothing yet' };
  const lines = [
    `What the design says right now: ${Math.round(Number(s.widthFt) || 0)} by ${Math.round(Number(s.depthFt) || 0)} feet, ${storeys === 1 ? 'one floor' : `${storeys} floors`}, about ${Math.round(inside).toLocaleString()} square feet of room laid out in ${rooms.length} room${rooms.length === 1 ? '' : 's'}.`,
    `Walls: ${wallWord}. Roof: ${s.roofType || 'not chosen'}.`,
    `Heat: ${HEAT[u.heatSource] || humanWord(u.heatSource) || 'not chosen'}. Water: ${humanWord(u.waterSource) || 'not chosen'}. Power: ${humanWord(u.powerMode) || 'not chosen'}.`
  ];
  return lines.join('\n');
}

// "make the kitchen 12 by 16", "resize the great room to 20 x 18 feet",
// "kitchen 14 by 12". The room is found by name in the design; the numbers
// are width then depth, the way a person says a room size.
export function parseLocalResize(text, spec) {
  const m = String(text || '').match(/^\s*(?:(?:make|resize|size|set|change)\s+)?(?:the\s+)?(.+?)\s+(?:to\s+|be\s+)?(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:by|x|×)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*\.?\s*$/i);
  if (!m) return null;
  const wanted = m[1].trim().toLowerCase();
  const w = Number(m[2]); const d = Number(m[3]);
  if (!(w > 0 && d > 0) || w > 200 || d > 200) return null;
  const rooms = spec?.rooms || [];
  const byName = rooms.find((r) => String(r.name || '').toLowerCase() === wanted)
    || rooms.find((r) => String(r.name || '').toLowerCase().includes(wanted))
    || rooms.find((r) => wanted.includes(String(r.name || '').toLowerCase()) && String(r.name || '').length > 2);
  return byName ? { room: byName, w, d } : null;
}
