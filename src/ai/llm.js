import { db } from '../store.js';
import { addCost, assertBudget } from '../costs.js';
import { OPENAI_BASE } from './images.js';
import { geminiGenerate } from './gemini.js';

// Testlarda soxta server ishlatish uchun almashtirsa bo'ladi
const ANTHROPIC_BASE = process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com';

export function textProviderReady() {
  const s = db().settings;
  if (s.textProvider === 'anthropic') return Boolean(s.anthropicKey);
  if (s.textProvider === 'openai') return Boolean(s.openaiKey);
  if (s.textProvider === 'gemini') return Boolean(s.geminiKey);
  return false;
}

/**
 * Matn modelidan JSON javob oladi. Kalit sozlanmagan bo'lsa yoki byudjet tugagan bo'lsa xato beradi —
 * chaqiruvchi tomon shablon bilan davom etadi.
 */
export async function generateJson({ system, prompt, maxTokens = 2500, cost = {}, images = [] }) {
  const s = db().settings;
  if (!textProviderReady()) throw new Error('Matn uchun AI kaliti sozlanmagan.');
  assertBudget();

  let text;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopError = null;
  if (s.textProvider === 'anthropic') {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': s.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: s.anthropicModel,
        // Yangi modellarda (Opus/Sonnet 5.x, Fable) fikrlash doim yoqiq va u ham token sarflaydi:
        // javob kesilib qolmasligi uchun joy ko'proq, oddiy JSON vazifa uchun effort past.
        max_tokens: alwaysThinks(s.anthropicModel) ? Math.max(maxTokens, 16000) : maxTokens,
        ...(alwaysThinks(s.anthropicModel) ? { output_config: { effort: 'low' } } : {}),
        system: `${system}\nReply with a single valid JSON object and nothing else.`,
        messages: [
          {
            role: 'user',
            content: images.length
              ? [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })), { type: 'text', text: prompt }]
              : prompt,
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Anthropic: ${data.error?.message || res.status}`);
    if (data.stop_reason === 'refusal') stopError = 'Anthropic: model so‘rovni rad etdi';
    if (data.stop_reason === 'max_tokens') stopError = 'Anthropic: javob uzunlik chegarasida kesildi';
    text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    inputTokens = data.usage?.input_tokens || 0;
    outputTokens = data.usage?.output_tokens || 0;
  } else if (s.textProvider === 'gemini') {
    const { data, error } = await geminiGenerate({
      kind: 'text',
      settingKey: 'geminiModel',
      fallback: 'gemini-2.5-flash',
      body: {
        systemInstruction: { parts: [{ text: `${system}\nReply with a single valid JSON object.` }] },
        contents: [{ role: 'user', parts: [...images.map((im) => ({ inlineData: { mimeType: im.mediaType, data: im.data } })), { text: prompt }] }],
        // Gemini 2.5+ modellar ichki fikrlashga ham shu chegaradan token sarflaydi
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: Math.max(maxTokens, 8192) },
      },
    });
    if (error) throw new Error(`Gemini: ${error}`);
    const cand = data.candidates?.[0];
    text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    inputTokens = data.usageMetadata?.promptTokenCount || 0;
    outputTokens = (data.usageMetadata?.candidatesTokenCount || 0) + (data.usageMetadata?.thoughtsTokenCount || 0);
    if (!cand || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(cand.finishReason)) stopError = 'Gemini: so‘rov rad etildi';
    if (cand?.finishReason === 'MAX_TOKENS') stopError = 'Gemini: javob uzunlik chegarasida kesildi';
  } else {
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.openaiKey}` },
      body: JSON.stringify({
        model: s.openaiTextModel,
        max_completion_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${system}\nReply with a single valid JSON object.` },
          {
            role: 'user',
            content: images.length
              ? [...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.data}` } })), { type: 'text', text: prompt }]
              : prompt,
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI: ${data.error?.message || res.status}`);
    text = data.choices?.[0]?.message?.content || '';
    inputTokens = data.usage?.prompt_tokens || 0;
    outputTokens = data.usage?.completion_tokens || 0;
  }

  const price = s.prices;
  addCost({
    kind: 'text',
    amount: (inputTokens / 1e6) * price.llmInputPer1M + (outputTokens / 1e6) * price.llmOutputPer1M,
    note: `${inputTokens}+${outputTokens} token`,
    ...cost,
  });
  // Rad etilgan yoki kesilgan javob ham pul sarflaydi — xarajat yozilgandan keyin xato beramiz
  if (stopError) throw new Error(stopError);
  return extractJson(text);
}

/** Rasmni (masalan, YouTube prevyusini) AI'ga yuborish uchun yuklab oladi. */
export async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Rasm yuklanmadi: ${res.status}`);
  const mediaType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  return { mediaType, data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

/** Fikrlashni o'chirib bo'lmaydigan modellar (Opus 5.x, Sonnet 5.x, Fable). */
export function alwaysThinks(model) {
  return /^claude-(opus-5|sonnet-5|fable)/.test(String(model || ''));
}

export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI javobida JSON topilmadi.');
  return JSON.parse(text.slice(start, end + 1));
}
