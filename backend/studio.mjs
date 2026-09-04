import { OPENAI_IMAGE_MAX, OPENAI_STUDIO_MODEL } from './config.mjs';
import { callGemini, geminiParts, hasGemini } from './gemini.mjs';
import { getCached, makeCacheKey, setCached } from './cache.mjs';

// WITH NO AI KEY, THE HONEST ANSWER IS "I CANNOT ANSWER THAT".
//
// This used to reply "I read that as a design discussion prompt. Current model
// snapshot: 28' x 32', roof shed, 19 rooms, 29 openings…" — jargon, addressed
// to a non-coder, and worse: it has the shape of an answer, so a question that
// was never read looks answered. The app's own rule is that a dead AI is said
// out loud, never covered over. So: no invented reply, a warning that names
// the real cause, and the plain facts of the house, which the app does know
// without any AI at all.
function localStudioResponse(payload) {
  const spec = payload.spec || payload.bim || {};
  const shell = spec?.shell || {};
  const rooms = Array.isArray(spec.rooms) ? spec.rooms.filter((r) => Number(r.level || 1) > 0) : [];
  const floorArea = rooms.reduce((sum, r) => sum + (Number(r.w) || 0) * (Number(r.d) || 0), 0);
  const storeys = Math.max(1, Math.round(Number(shell.storeys) || 1));
  const utilities = spec.utilities || {};
  // A stored value nobody typed ("masonry_heater") read out loud.
  const humanWord = (v) => (v ? String(v).replace(/_/g, ' ') : '');
  const HEAT = { wood_stove: 'a wood stove', masonry: 'a masonry heater', masonry_heater: 'a masonry heater', mini_split: 'a heat pump', none: 'nothing yet' };
  const facts = [
    `${Math.round(Number(shell.widthFt) || 0)} by ${Math.round(Number(shell.depthFt) || 0)} feet, ${storeys === 1 ? 'one floor' : storeys + ' floors'}, ${rooms.length} room${rooms.length === 1 ? '' : 's'} covering about ${Math.round(floorArea).toLocaleString()} square feet.`,
    `Roof: ${shell.roofType || 'not chosen yet'}. Heat: ${HEAT[utilities.heatSource] || humanWord(utilities.heatSource) || 'not chosen yet'}.`
  ].join(' ');
  return {
    source: 'local-studio-fallback',
    reply: '',
    facts,
    warnings: ['AI planner unavailable: no API key is configured on this computer.']
  };
}

export async function studioRespond(payload) {
  if (!hasGemini() && !process.env.OPENAI_API_KEY) return localStudioResponse(payload);

  const cacheKey = makeCacheKey({
    kind: 'studio',
    prompt: payload.prompt,
    revision: payload?.bim?.revision || payload?.spec?.revision,
    selectedObjectId: payload.selectedObjectId || payload?.selected?.id,
    imageNames: (payload.attachedImages || []).map((image) => image.name),
    roomCount: (payload?.bim?.rooms || payload?.spec?.rooms || []).length,
    openingCount: (payload?.bim?.openings || payload?.spec?.openings || []).length
  });
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, source: `${cached.source || 'ai-studio'}-cache` };

  const spec = payload.spec || payload.bim || {};
  const selected = payload.selected || null;
  const compactSpec = {
    projectName: spec?.projectName,
    revision: spec?.revision,
    shell: spec?.shell,
    systems: spec?.systems,
    rooms: spec?.rooms,
    elements: spec?.elements,
    openings: spec?.openings,
    // What the house is MADE of was never sent — so the AI, asked what the
    // walls were, could only say it had no idea. Everything a builder would
    // ask about goes with the question now.
    walls: spec?.walls,
    wallSegments: spec?.wallSegments,
    frame: spec?.frame,
    utilities: spec?.utilities,
    flooring: spec?.flooring,
    sourcing: spec?.sourcing,
    site: spec?.site,
    selected
  };

  const content = [
    {
      type: 'input_text',
      text: `You are Studio, the friendly expert inside a natural-building home design app. The person asking is not a builder or a coder: answer in plain words, never say "BIM" or "spec" or "model state", and name real materials and real trade-offs.

Your job here is not to force every message into a BIM edit. When the user asks for comparison, critique, interpretation, mismatch review, or plain-language analysis, answer conversationally and intelligently.

If an attached image is present, inspect it visually and compare it against the provided BIM state. Be concrete. Mention likely mismatches, missing elements, uncertain areas, and what you can or cannot reliably infer from the image.

Important:
- Do not claim a BIM change was made unless this request is explicitly about changing the model.
- If the image is ambiguous, say so plainly.
- Prefer concise, concrete observations.
- If you compare drawing vs model, organize your answer around differences in rooms, walls, roof, openings, massing, and site elements when relevant.

Current BIM state:
${JSON.stringify(compactSpec, null, 2)}

User prompt:
${payload.prompt}`
    }
  ];

  for (const image of (payload.attachedImages || []).slice(0, OPENAI_IMAGE_MAX)) {
    if (/^data:(image\/|application\/pdf|text\/)/.test(image.src || '')) {
      content.push({ type: 'input_image', image_url: image.src });
    }
  }

  if (hasGemini()) {
    const res = await callGemini({ parts: geminiParts(content) });
    if (!res.ok) {
      const fallback = localStudioResponse(payload);
      fallback.warnings.unshift(`Studio vision unavailable: ${res.status} ${res.errorText.slice(0, 160)}`);
      return fallback;
    }
    return setCached(cacheKey, {
      source: 'ai-studio-gemini',
      reply: res.text || 'I could not produce a useful Studio response.',
      warnings: []
    }, 5 * 60 * 1000);
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_STUDIO_MODEL,
      input: [{ role: 'user', content }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    const fallback = localStudioResponse(payload);
    const authBlocked = response.status === 401 || /no_matching_rule|unauthorized/i.test(errorText);
    fallback.warnings.unshift(
      authBlocked
        ? 'Studio vision is wired in the app, but the current OpenAI credentials are not authorized for model access in this environment.'
        : `Studio vision unavailable: ${response.status} ${errorText.slice(0, 160)}`
    );
    fallback.source = authBlocked ? 'studio-auth-blocked' : fallback.source;
    return fallback;
  }

  const data = await response.json();
  const reply = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text || '';
  return setCached(cacheKey, {
    source: 'ai-studio',
    reply: reply.trim() || 'I could not produce a useful Studio response.',
    warnings: []
  }, 5 * 60 * 1000);
}
