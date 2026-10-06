// Google Gemini so'rovlari: model eskirsa yoki yangi foydalanuvchilarga yopilsa
// (masalan, "gemini-2.5-flash is no longer available to new users"), dastur mavjud modellar
// ro'yxatidan mosini o'zi tanlaydi, sozlamaga saqlaydi va so'rovni qaytaradi.
import { db, save } from '../store.js';

// Testlarda soxta server ishlatish uchun almashtirsa bo'ladi
export const GEMINI_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';

const KIND_RULES = {
  // matn: oddiy "gemini-X-flash" (preview/lite/tts/image emas) eng yaxshi
  text: { must: (n) => !/(tts|image|embedding|audio|live|veo|imagen|aqa|gemma)/.test(n), prefer: [/flash$/, /flash/, /pro$/, /pro/] },
  image: { must: (n) => /image/.test(n) && !/imagen/.test(n), prefer: [/flash-image$/, /flash-image/, /image/] },
  tts: { must: (n) => /tts/.test(n), prefer: [/flash.*tts/, /tts/] },
};

let cache = { key: '', at: 0, models: [] };

export async function listGeminiModels(apiKey) {
  if (cache.key === apiKey && Date.now() - cache.at < 3600_000) return cache.models;
  const res = await fetch(`${GEMINI_BASE}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': apiKey } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini modellar ro‘yxati: ${data.error?.message || res.status}`);
  const models = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''));
  cache = { key: apiKey, at: Date.now(), models };
  return models;
}

const version = (n) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1]) || 0;
const unstable = (n) => /(preview|exp|lite|latest|-\d{2,}$)/.test(n);

/** Ro'yxatdan shu ish turi uchun eng yangi barqaror modelni tanlaydi. */
export function pickGeminiModel(models, kind, avoid = '') {
  const rule = KIND_RULES[kind];
  const list = models.filter((n) => n.startsWith('gemini') && rule.must(n) && n !== avoid);
  for (const re of rule.prefer) {
    const hits = list.filter((n) => re.test(n)).sort((a, b) => unstable(a) - unstable(b) || version(b) - version(a));
    if (hits.length) return hits[0];
  }
  return null;
}

const retired = (status, msg) => status === 404 || /no longer available|not found|is not supported|deprecated|retired|not available/i.test(msg);
// Vaqtinchalik: server band (503), limit (429), ichki xato (500)
const busy = (status, msg) => [429, 500, 503].includes(status) || /high demand|overloaded|try again later|unavailable|resource.?exhausted/i.test(msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const RETRY_DELAYS = process.env.GEMINI_RETRY_MS ? process.env.GEMINI_RETRY_MS.split(',').map(Number) : [3000, 8000, 20000];

/**
 * Gemini generateContent.
 * - Model yopilgan/eskirgan bo'lsa — yangisini topadi, sozlamaga saqlaydi va qaytadan so'raydi.
 * - Server band bo'lsa — biroz kutib qayta urinadi; baribir band bo'lsa — shu safar boshqa modeldan foydalanadi.
 * kind: 'text' | 'image' | 'tts'; settingKey: sozlamadagi model maydoni.
 */
export async function geminiGenerate({ kind, settingKey, fallback, body, log = () => {} }) {
  const s = db().settings;
  let model = String(s[settingKey] || fallback).replace(/^models\//, '');
  const call = async (m) => {
    const res = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': s.geminiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data, model: m, msg: String(data.error?.message || ''), error: res.ok ? null : String(data.error?.message || res.status) };
  };
  const alternative = async (avoid) => {
    try {
      return pickGeminiModel(await listGeminiModels(s.geminiKey), kind, avoid);
    } catch {
      return null;
    }
  };

  let r = await call(model);
  // 1) Yopilgan model -> doimiy almashtirish
  if (!r.res.ok && retired(r.res.status, r.msg)) {
    const suggested = [...r.msg.matchAll(/models\/([\w.-]+)/g)].map((m) => m[1]).find((n) => n !== model && KIND_RULES[kind].must(n));
    const next = suggested || (await alternative(model));
    if (!next) return r;
    log(`Gemini: “${model}” ishlamadi — “${next}” modeliga o‘tildi.`);
    s[settingKey] = next;
    save();
    model = next;
    r = await call(model);
  }
  // 2) Server band -> kutib qayta urinish
  for (const delay of RETRY_DELAYS) {
    if (r.res.ok || !busy(r.res.status, r.msg)) return r;
    log(`Gemini band (${r.res.status}) — ${Math.round(delay / 1000)} s dan keyin qayta urinilmoqda…`);
    await sleep(delay);
    r = await call(model);
  }
  // 3) Hamon band -> shu so'rov uchun boshqa model
  if (!r.res.ok && busy(r.res.status, r.msg)) {
    const other = await alternative(model);
    if (other) {
      log(`Gemini “${model}” band — bu safar “${other}” ishlatildi.`);
      const r2 = await call(other);
      if (r2.res.ok) return r2;
    }
    r.error = `${r.error} (Google serverlari hozir band — bir necha daqiqadan keyin “Qayta montaj” bosing)`;
  }
  return r;
}
