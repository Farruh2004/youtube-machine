// API kalitlarini tekshirish: har bir xizmatga eng arzon (yoki bepul) so'rov yuboriladi.
import fs from 'node:fs';
import path from 'node:path';
import { db, save } from './store.js';
import { ROOT } from './config.js';
import { GEMINI_BASE, geminiGenerate } from './ai/gemini.js';

const OAUTH_TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';

const TELEGRAM_API = process.env.TELEGRAM_API || 'https://api.telegram.org';
// Yangilanish manbai (yangilash.bat bilan bir xil): update-source.txt -> "egasi/repo branch"
export const UPDATE_REPO = (() => {
  try {
    return fs.readFileSync(path.join(ROOT, 'update-source.txt'), 'utf8').trim().split(/\s+/)[0] || 'Farruh2004/youtube-machine';
  } catch {
    return 'Farruh2004/youtube-machine';
  }
})();

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function fail(res, data, fallback) {
  const msg = data?.error?.message || data?.detail?.message || data?.description || data?.error_description || fallback;
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(String(msg)))) return { ok: false, detail: `Kalit noto‘g‘ri yoki ruxsat yo‘q (${res.status}): ${msg}` };
  return { ok: false, detail: `${res.status}: ${msg}` };
}

const CHECKS = {
  async anthropic(s) {
    if (!s.anthropicKey) return { ok: false, detail: 'Kalit kiritilmagan' };
    const { res, data } = await getJson('https://api.anthropic.com/v1/models?limit=20', {
      'x-api-key': s.anthropicKey,
      'anthropic-version': '2023-06-01',
    });
    if (!res.ok) return fail(res, data, 'Anthropic xatosi');
    return { ok: true, detail: `Ishlayapti. Mavjud modellar: ${(data.data || []).length} ta` };
  },

  async openai(s) {
    if (!s.openaiKey) return { ok: false, detail: 'Kalit kiritilmagan' };
    const { res, data } = await getJson('https://api.openai.com/v1/models', { authorization: `Bearer ${s.openaiKey}` });
    if (!res.ok) return fail(res, data, 'OpenAI xatosi');
    return { ok: true, detail: 'Ishlayapti' };
  },

  async gemini(s) {
    if (!s.geminiKey) return { ok: false, detail: 'Kalit kiritilmagan' };
    const { res, data } = await getJson(`${GEMINI_BASE}/v1beta/models?pageSize=1000`, { 'x-goog-api-key': s.geminiKey });
    if (!res.ok) return fail(res, data, 'Gemini xatosi');
    const models = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name) && !/(tts|image|embedding|audio|live)/.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }));
    // Tanlangan model haqiqatan ishlashini kichik so'rov bilan tekshiramiz: yopilgan bo'lsa, yangisiga o'zi o'tadi
    const before = s.geminiModel;
    const test = await geminiGenerate({ kind: 'text', settingKey: 'geminiModel', fallback: 'gemini-2.5-flash', body: { contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }], generationConfig: { maxOutputTokens: 256 } } });
    if (test.error) return { ok: false, detail: `Kalit ishlaydi, lekin “${test.model}” modeli javob bermadi: ${test.error}`, models };
    const switched = test.model !== before ? ` “${before}” yopilgan ekan — “${test.model}” modeliga o‘tkazildi.` : ` Model: ${test.model}.`;
    return { ok: true, detail: `Ishlayapti.${switched} ${models.length} ta matn modeli mavjud.`, models, model: test.model };
  },

  async elevenlabs(s) {
    if (!s.elevenKey) return { ok: false, detail: 'Kalit kiritilmagan' };
    const { res, data } = await getJson('https://api.elevenlabs.io/v1/voices', { 'xi-api-key': s.elevenKey });
    if (!res.ok) return fail(res, data, 'ElevenLabs xatosi');
    const voices = (data.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
    const chosen = voices.find((v) => v.id === s.elevenVoiceId);
    return {
      ok: true,
      detail: chosen ? `Ishlayapti. Tanlangan ovoz: ${chosen.name}` : `Ishlayapti. ${voices.length} ta ovoz topildi — ro‘yxatdan tanlang.`,
      voices,
    };
  },

  async youtubeKey(s) {
    if (!s.youtubeApiKey) return { ok: false, detail: 'Kalit kiritilmagan' };
    const { res, data } = await getJson(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=%40YouTube&key=${encodeURIComponent(s.youtubeApiKey)}`);
    if (!res.ok) return fail(res, data, 'YouTube API xatosi');
    return { ok: true, detail: 'Ishlayapti (ochiq statistika va trendlar uchun)' };
  },

  async google(s) {
    if (!s.googleClientId || !s.googleClientSecret) return { ok: false, detail: 'Client ID va Client Secret ikkalasi ham kerak' };
    if (!/\.apps\.googleusercontent\.com$/.test(s.googleClientId)) {
      return { ok: false, detail: 'Client ID odatda “…apps.googleusercontent.com” bilan tugaydi — to‘g‘ri nusxalanganini tekshiring.' };
    }
    // Haqiqiy tekshiruv: ataylab noto'g'ri kod yuboramiz. "invalid_client" — kalit xato, "invalid_grant" — kalit to'g'ri.
    try {
      const res = await fetch(`${OAUTH_TOKEN_URL}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: s.googleClientId, client_secret: s.googleClientSecret, code: 'tekshiruv', grant_type: 'authorization_code', redirect_uri: 'http://127.0.0.1' }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error === 'invalid_client' || data.error === 'unauthorized_client') {
        return { ok: false, detail: 'Google bu Client ID / Client Secret juftligini tanimadi. JSON faylni qaytadan yuklang yoki ikkalasini qayta nusxalang.' };
      }
    } catch {
      // internet yo'q — oddiy tekshiruv bilan cheklanamiz
    }
    const connected = db().channels.filter((c) => c.youtube?.refreshToken && !c.youtube.expired).length;
    return {
      ok: true,
      detail: connected ? `To‘g‘ri. ${connected} ta kanal ulangan.` : 'Kalit to‘g‘ri ✓ Endi pastdagi “YouTube’ga ulash” tugmasini bosing.',
    };
  },

  async github(s) {
    if (!s.githubToken) {
      const open = await getJson(`https://api.github.com/repos/${UPDATE_REPO}`, { accept: 'application/vnd.github+json', 'user-agent': 'youtube-machine' });
      return open.res.ok ? { ok: true, detail: `Token shart emas: ${UPDATE_REPO} ochiq repozitoriy, yangilash.bat tokensiz ishlaydi.` } : { ok: false, detail: 'Token kiritilmagan' };
    }
    const { res, data } = await getJson(`https://api.github.com/repos/${UPDATE_REPO}`, {
      authorization: `Bearer ${s.githubToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'youtube-machine',
    });
    if (res.status === 404) return { ok: false, detail: `Token ${UPDATE_REPO} repozitoriysini ko‘ra olmayapti — tokenda shu repozitoriy tanlanganini tekshiring.` };
    if (!res.ok) return fail(res, data, 'GitHub xatosi');
    return { ok: true, detail: `Ishlayapti: ${data.full_name}. Endi “yangilash.bat” dasturni o‘zi yangilaydi.` };
  },

  async telegram(s) {
    if (!s.telegramToken) return { ok: false, detail: 'Token kiritilmagan' };
    const { res, data } = await getJson(`${TELEGRAM_API}/bot${s.telegramToken}/getMe`);
    if (!res.ok || !data.ok) return fail(res, data, 'Telegram xatosi');
    return {
      ok: true,
      detail: s.telegramChatId ? `@${data.result.username} ulangan` : `Bot @${data.result.username} topildi. Telegram’da unga /start yozing.`,
      bot: data.result.username,
    };
  },
};

export const SERVICES = Object.keys(CHECKS);

export async function verifyKey(service) {
  const check = CHECKS[service];
  if (!check) throw new Error('Noma’lum xizmat');
  let result;
  try {
    result = await check(db().settings);
  } catch (err) {
    result = { ok: false, detail: err.name === 'TimeoutError' ? 'Javob kelmadi (internet aloqasini tekshiring)' : err.message };
  }
  const data = db();
  data.keyChecks ||= {};
  data.keyChecks[service] = { ok: result.ok, detail: result.detail, at: new Date().toISOString() };
  save();
  return result;
}

export function keyChecks() {
  return db().keyChecks || {};
}
