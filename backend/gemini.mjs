import { GEMINI_MODEL } from './config.mjs';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function hasGemini() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Convert the OpenAI Responses `content` array (input_text / input_image)
// into Gemini `parts` (text / inlineData).
export function geminiParts(content) {
  const parts = [];
  for (const item of content) {
    if (item.type === 'input_text' && item.text) {
      parts.push({ text: item.text });
    } else if (item.type === 'input_image' && typeof item.image_url === 'string') {
      // Not just images: PDFs and plain-text documents ride the same rail —
      // Gemini accepts application/pdf and text/* as inlineData.
      const match = item.image_url.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.*)$/);
      if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }
  return parts;
}

// Gemini's responseSchema is a subset of JSON Schema and rejects a few keys
// (notably `additionalProperties`). Strip the unsupported ones recursively.
export function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (schema && typeof schema === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'additionalProperties' || key === '$schema' || key === 'strict') continue;
      // Gemini's responseSchema rejects enums that contain an empty string
      // (we use '' as a "not applicable" value). Drop those enum constraints;
      // the field stays a plain string. Keeps valid enums (e.g. operation type).
      if (key === 'enum' && Array.isArray(value) && value.includes('')) continue;
      out[key] = geminiSchema(value);
    }
    return out;
  }
  return schema;
}

// Single entry point for both planner and studio. Returns { ok, status, errorText, text }.
export async function callGemini({ parts, responseSchema, model = GEMINI_MODEL, maxOutputTokens = 32768 }) {
  const body = { contents: [{ role: 'user', parts }] };
  if (responseSchema) {
    // A full drawing takeoff can be dozens of operations — give the model
    // room (and keep it literal: low temperature for tracing work).
    // thinkingBudget 0: flash THINKS by default and thinking tokens bill at
    // the expensive output rate on every planner call — it drained a $25
    // prepayment in a day of tracing, stretched staged passes to 100-250s,
    // and starved the JSON reply into "unreadable" truncation. Structured
    // extraction against a schema doesn't need it. GEMINI_THINKING_BUDGET
    // overrides if a future model benefits. Chat calls (no schema) keep the
    // model's default.
    const thinkingBudget = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);
    body.generationConfig = {
      responseMimeType: 'application/json',
      responseSchema,
      maxOutputTokens,
      temperature: 0.2,
      thinkingConfig: { thinkingBudget }
    };
  }

  let response;
  try {
    response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY || '',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    return { ok: false, status: 0, errorText: String(error?.message || error), text: '' };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, errorText: await response.text(), text: '' };
  }

  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim();

  if (!text) {
    const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || 'empty response';
    return { ok: false, status: response.status, errorText: `Gemini returned no text (${reason})`, text: '' };
  }

  return { ok: true, status: response.status, errorText: '', text };
}
