// Ovoz effektlari va fon musiqasi kutubxonasi.
// - data/sfx/ : effektlar. Bir nechta oddiy effekt (whoosh, pop, ding...) dasturning o'zida yasaladi — bepul.
//   O'zingiz yuklagan fayllar nomidan qidiriladi (masalan, "sizzle-frying.mp3" -> "sizzle").
//   ElevenLabs kaliti bo'lsa, topilmagan effekt AI bilan yaratiladi va kutubxonaga saqlanadi.
// - data/channels/<id>/music-*.mp3 : kanal fon musiqalari, har videoga bittasi tanlanadi.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config.js';
import { db } from '../store.js';
import { addCost, assertBudget } from '../costs.js';
import { ffmpeg } from './ffmpeg.js';

export const SFX_DIR = path.join(DATA_DIR, 'sfx');
const ELEVEN_BASE = process.env.ELEVEN_API_BASE || 'https://api.elevenlabs.io';
const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.ogg'];

// Kalitsiz ishlaydigan oddiy effektlar (ffmpeg bilan sintez qilinadi)
const BUILTIN = {
  'builtin-whoosh-swoosh-swish-fast-move-transition.wav': ['-f', 'lavfi', '-i', 'anoisesrc=d=0.55:c=pink:a=0.9', '-af', 'bandpass=f=1400:width_type=h:w=1800,afade=t=in:d=0.25,afade=t=out:st=0.25:d=0.3,volume=2.5'],
  'builtin-pop-bubble-appear-show.wav': ['-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*(500+1400*exp(-t*25))*t)*exp(-t*22)':d=0.18"],
  'builtin-ding-bell-idea-correct-fact.wav': ['-f', 'lavfi', '-i', "aevalsrc='0.5*(sin(2*PI*1320*t)+0.4*sin(2*PI*2640*t))*exp(-t*4)':d=0.9"],
  'builtin-click-tap-select.wav': ['-f', 'lavfi', '-i', 'anoisesrc=d=0.035:c=white:a=0.8', '-af', 'highpass=f=2500,afade=t=out:st=0.005:d=0.03'],
  'builtin-thud-hit-impact-punch-drop-boom.wav': ['-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*(60+90*exp(-t*18))*t)*exp(-t*7)':d=0.45"],
  'builtin-rise-riser-up-tension-build.wav': ['-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*(250+500*t)*t)*min(1,t*3)':d=0.9", '-af', 'afade=t=out:st=0.75:d=0.15'],
  'builtin-boing-bounce-funny-spring-cartoon.wav': ['-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*(180+60*sin(2*PI*14*t))*t)*exp(-t*3.5)':d=0.6"],
};

const SYNONYMS = { swoosh: 'whoosh', swish: 'whoosh', woosh: 'whoosh', zoom: 'whoosh', bubble: 'pop', blip: 'pop', chime: 'ding', bell: 'ding', sparkle: 'ding', twinkle: 'ding', tap: 'click', impact: 'thud', bonk: 'thud', slam: 'thud', riser: 'rise', spring: 'boing', bounce: 'boing' };
const tokens = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter((t) => t.length > 1).map((t) => SYNONYMS[t] || t);

export async function ensureBuiltinSfx() {
  fs.mkdirSync(SFX_DIR, { recursive: true });
  for (const [name, args] of Object.entries(BUILTIN)) {
    if (!fs.existsSync(path.join(SFX_DIR, name))) await ffmpeg([...args, '-ar', '44100', '-ac', '2', name], { cwd: SFX_DIR });
  }
}

export function listSfx() {
  if (!fs.existsSync(SFX_DIR)) return [];
  return fs.readdirSync(SFX_DIR).filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase())).sort();
}

/** AI ssenariy yozganda tanlashi uchun qisqa nomlar ro'yxati. */
export function sfxVocabulary() {
  const names = new Set(['whoosh', 'pop', 'ding', 'click', 'thud', 'rise', 'boing']);
  for (const f of listSfx()) {
    if (f.startsWith('builtin-')) continue;
    const t = tokens(f.replace(/^gen-/, '').replace(/-[0-9a-f]{8}\./, '.'))[0];
    if (t) names.add(t);
  }
  return [...names].slice(0, 40);
}

/** Effekt nomiga eng mos fayl: so'zlar ustma-ust tushishi bo'yicha. */
export function findSfx(query) {
  const q = tokens(query);
  if (!q.length) return null;
  let best = null;
  let bestScore = 0;
  for (const f of listSfx()) {
    const ft = tokens(f.replace(/^(builtin|gen)-/, ''));
    let score = q.filter((t) => ft.includes(t)).length * 2;
    if (ft[0] && q.includes(ft[0])) score += 1;
    // O'zingiz yuklagan fayl teng ochkoda ichki effektdan ustun
    if (score && !f.startsWith('builtin-')) score += 0.5;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best ? path.join(SFX_DIR, best) : null;
}

export function sfxGenerateReady() {
  return Boolean(db().settings.elevenKey);
}

/** ElevenLabs Sound Effects: matndan qisqa effekt yaratadi va kutubxonaga saqlaydi. */
export async function generateSfx(query, { cost = {} } = {}) {
  const s = db().settings;
  assertBudget();
  const res = await fetch(`${ELEVEN_BASE}/v1/sound-generation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': s.elevenKey, accept: 'audio/mpeg' },
    body: JSON.stringify({ text: `${query}, short cartoon sound effect for an explainer video`, duration_seconds: 1.5, prompt_influence: 0.6 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`ElevenLabs effekt: ${err.detail?.message || err.detail || res.status}`);
  }
  fs.mkdirSync(SFX_DIR, { recursive: true });
  const slug = tokens(query).slice(0, 4).join('-') || 'effect';
  const file = path.join(SFX_DIR, `gen-${slug}-${crypto.createHash('sha1').update(query).digest('hex').slice(0, 8)}.mp3`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  addCost({ kind: 'sfx', amount: Number(s.prices.elevenSfx) || 0, note: `Effekt: ${query}`, ...cost });
  return file;
}

/** Effektni topadi; topilmasa va ruxsat bo'lsa — yaratadi. */
export async function resolveSfx(query, { generate = false, cost = {}, log = () => {} } = {}) {
  if (!query) return null;
  const found = findSfx(query);
  if (found) return found;
  if (generate && sfxGenerateReady()) {
    try {
      return await generateSfx(query, { cost });
    } catch (err) {
      log(`Effekt yaratilmadi (${query}): ${err.message}`);
    }
  }
  return null;
}

// ---------- Kanal fon musiqalari ----------
export function listMusic(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith('music-') && AUDIO_EXT.includes(path.extname(f).toLowerCase())).sort();
}

/** Har loyiha uchun barqaror tanlov (qayta montajda musiqa almashmaydi). */
export function pickMusic(dir, seed) {
  const list = listMusic(dir);
  if (!list.length) return null;
  const n = parseInt(crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 8), 16);
  return path.join(dir, list[n % list.length]);
}
