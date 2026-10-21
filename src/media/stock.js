// Stok video: sahna kalit so'zlari bo'yicha Pexels va Pixabay'dan bepul HD kliplar (MoneyPrinterTurbo uslubi).
// Ikkala xizmat ham bepul API kalit beradi; kliplardan tijoriy foydalanish mumkin, manbani ko'rsatish tavsiya etiladi.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db } from '../store.js';

// Testlarda soxta server ishlatish uchun almashtirsa bo'ladi
export const PEXELS = process.env.PEXELS_API_BASE || 'https://api.pexels.com';
export const PIXABAY = process.env.PIXABAY_API_BASE || 'https://pixabay.com/api';

export function stockReady() {
  const s = db().settings;
  return Boolean(s.pexelsKey || s.pixabayKey);
}

const TARGET_LONG_SIDE = 1920;

/** Bir nechta fayl variantidan keraklisini tanlaydi: 1080p atrofida, 4K emas (yuklash tez bo'lsin). */
function bestFile(files) {
  const ok = files.filter((f) => f.link && f.width && f.height);
  if (!ok.length) return null;
  const score = (f) => {
    const long = Math.max(f.width, f.height);
    return long >= 1080 && long <= 2160 ? Math.abs(long - TARGET_LONG_SIDE) : 10_000 + Math.abs(long - TARGET_LONG_SIDE);
  };
  return ok.sort((a, b) => score(a) - score(b))[0];
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

async function searchPexels(query, orientation, key) {
  const qs = new URLSearchParams({ query, orientation, size: 'medium', per_page: '20' });
  const data = await getJson(`${PEXELS}/videos/search?${qs}`, { authorization: key });
  return (data.videos || []).map((v) => {
    const f = bestFile((v.video_files || []).filter((x) => /mp4/.test(x.file_type || 'video/mp4')));
    return f && { provider: 'Pexels', id: `px${v.id}`, page: v.url, author: v.user?.name || '', duration: Number(v.duration) || 0, width: f.width, height: f.height, link: f.link };
  }).filter(Boolean);
}

async function searchPixabay(query, key) {
  const qs = new URLSearchParams({ key, q: query.slice(0, 100), per_page: '20', safesearch: 'true' });
  const data = await getJson(`${PIXABAY}/videos/?${qs}`);
  return (data.hits || []).map((h) => {
    const files = Object.values(h.videos || {}).map((x) => ({ link: x.url, width: x.width, height: x.height }));
    const f = bestFile(files);
    return f && { provider: 'Pixabay', id: `pb${h.id}`, page: h.pageURL, author: h.user || '', duration: Number(h.duration) || 0, width: f.width, height: f.height, link: f.link };
  }).filter(Boolean);
}

/** Ikkala xizmatdan qidiradi va mosligi bo'yicha saralaydi. */
export async function searchStock(query, { orientation = 'landscape', minDuration = 3 } = {}) {
  const s = db().settings;
  const tasks = [];
  if (s.pexelsKey) tasks.push(searchPexels(query, orientation, s.pexelsKey));
  if (s.pixabayKey) tasks.push(searchPixabay(query, s.pixabayKey));
  const settled = await Promise.allSettled(tasks);
  const results = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const errors = settled.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
  if (!results.length && errors.length) throw new Error(`Stok video: ${errors.join('; ')}`);
  const wantPortrait = orientation === 'portrait';
  const score = (c) => (c.height > c.width === wantPortrait ? 4 : 0) + (c.duration >= minDuration ? 3 : c.duration / minDuration) + Math.min(1, Math.max(c.width, c.height) / 1920);
  return results.sort((a, b) => score(b) - score(a));
}

// Deterministik "tasodif": bir loyiha va variant uchun har doim bir xil tanlov (qayta montajda klip almashmaydi)
const seeded = (seed) => parseInt(crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 8), 16);

/**
 * Sahna uchun klip tanlaydi: avval kalit so'zlar, topilmasa — soddaroq so'rovlar.
 * used — shu videoda ishlatilgan kliplar (bir klip ikki marta chiqmasin).
 */
export async function pickClip({ queries, orientation, minDuration, used, seed }) {
  for (const q of queries.filter(Boolean)) {
    const list = (await searchStock(q, { orientation, minDuration })).filter((c) => !used.has(c.id));
    if (!list.length) continue;
    const top = list.slice(0, Math.min(5, list.length));
    return { ...top[seeded(`${seed}|${q}`) % top.length], query: q };
  }
  return null;
}

export async function downloadClip(clip, outFile) {
  const res = await fetch(clip.link, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Klip yuklanmadi (${clip.provider}): HTTP ${res.status}`);
  fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

const STOP = new Set('the a an and or but of to in on at for with from by is are was were be been it its this that these those you your we our they their he she his her them as if then than so do does did not no yes can will just very more most much many some any all into out up down over under about what why how when where which who whom there here also only even like get got make made'.split(' '));

/** AI bo'lmasa: matndan kalit so'zlar (uzun, ma'noli so'zlar). */
export function fallbackKeywords(text, extra = '') {
  const words = String(text).toLowerCase().match(/[a-z][a-z-]{3,}/g) || [];
  const uniq = [...new Set(words.filter((w) => !STOP.has(w)))].sort((a, b) => b.length - a.length);
  const out = [];
  if (uniq.length >= 2) out.push(`${uniq[0]} ${uniq[1]}`);
  if (uniq.length) out.push(uniq[0]);
  if (extra) out.push(extra);
  return out;
}
