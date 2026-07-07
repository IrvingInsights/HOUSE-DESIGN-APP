import { OPENAI_IMAGE_MAX, OPENAI_STUDIO_MODEL } from './config.mjs';
import { callGemini, geminiParts, hasGemini } from './gemini.mjs';
import { getCached, makeCacheKey, setCached } from './cache.mjs';

function localStudioResponse(payload) {
  const spec = payload.spec || payload.bim || {};
  const prompt = String(payload.prompt || '');
  const attachedImages = payload.attachedImages || [];
  const shell = spec?.shell ? `${spec.shell.widthFt}' x ${spec.shell.depthFt}'` : 'unknown shell';
  const roof = spec?.shell?.roofType || 'unknown roof';
  const selected = payload.selected?.name || 'nothing selected';
  const roomCount = Array.isArray(spec.rooms) ? spec.rooms.length : 0;
  const openingCount = Array.isArray(spec.openings) ? spec.openings.length : 0;

  const text = attachedImages.length
    ? `I can discuss the current BIM model, but I still cannot truly inspect the attached image in fallback mode. Current model snapshot: ${shell}, roof ${roof}, ${roomCount} rooms, ${openingCount} openings, selected object ${selected}.`
    : `I read that as a design discussion prompt. Current model snapshot: ${shell}, roof ${roof}, ${roomCount} rooms, ${openingCount} openings, selected object ${selected}.`;

  return {
    source: 'local-studio-fallback',
    reply: `${text} Prompt received: "${prompt}".`,
    warnings: attachedImages.length ? ['Vision comparison is unavailable in fallback mode.'] : []
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
    selected
  };

  const content = [
    {
      type: 'input_text',
      text: `You are Studio, the conversational design intelligence for a natural building BIM dashboard.

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
    if (image.src?.startsWith('data:image/')) {
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
