// Raqobatchi kanallar: ochiq statistika, "outlier" videolar, sarlavha/davomiylik qoliplari,
// AI tahlili va shular asosida bizning kanallar uchun g'oya va ssenariylar.
import { db, save, newId } from './store.js';
import { resolveChannel, publicChannelVideos } from './youtube.js';
import { generateJson, fetchImage } from './ai/llm.js';
import { competitorAnalysisPrompt, ideasPrompt, scriptPrompt } from './ai/prompts.js';
import { median } from './diagnose.js';
import { bus } from './events.js';

const DAY = 86_400_000;
const STOP = new Set('the a an to of and in on for is are that this it with i my me we be can do at by from or as its it’s it\'s was will than into about when up out just all not no so if has have had they them their our us he she his her who which there here these those'.split(' '));
const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const DURATION_BUCKETS = [
  [0, 60, '≤1 daq'],
  [61, 180, '1–3 daq'],
  [181, 300, '3–5 daq'],
  [301, 600, '5–10 daq'],
  [601, 1200, '10–20 daq'],
  [1201, Infinity, '20+ daq'],
];

const state = () => {
  const d = db();
  d.competitors ||= [];
  d.ideas ||= [];
  d.plannedChannels ||= [];
  return d;
};

export const getCompetitor = (id) => state().competitors.find((c) => c.id === id);

// ---------- Maqsad kanallar (mavjud + rejalashtirilgan) ----------
export function targets() {
  const d = state();
  return [
    ...d.channels.map((c) => ({ id: c.id, name: c.name, kind: 'channel', type: c.type, language: c.language || 'en', style: c.style, niche: c.niche || (c.type === 'music' ? 'AI-generated songs (Suno): lyric videos and Shorts' : c.type === 'fight' ? 'Fight clips with original technical breakdown commentary' : '') })),
    ...d.plannedChannels.map((p) => ({ id: p.id, name: p.name, kind: 'planned', type: p.format || 'explainer', language: p.language || 'en', niche: p.niche, audience: p.audience, style: p.style })),
  ];
}

export function getTarget(id) {
  return targets().find((t) => t.id === id) || null;
}

export function savePlannedChannel(body) {
  const d = state();
  const fields = {
    name: String(body.name || '').trim().slice(0, 80),
    niche: String(body.niche || '').trim().slice(0, 500),
    audience: String(body.audience || '').trim().slice(0, 300),
    language: String(body.language || 'en').trim().slice(0, 20),
    style: String(body.style || '').trim().slice(0, 500),
    format: ['explainer', 'music', 'fight', 'other'].includes(body.format) ? body.format : 'explainer',
  };
  if (!fields.name || !fields.niche) throw new Error('Kanal nomi va mavzusini kiriting.');
  if (body.id) {
    const p = d.plannedChannels.find((x) => x.id === body.id);
    if (!p) throw new Error('Topilmadi');
    Object.assign(p, fields);
    save();
    return p;
  }
  const p = { id: newId('pl'), ...fields, createdAt: new Date().toISOString() };
  d.plannedChannels.push(p);
  save();
  return p;
}

export function deletePlannedChannel(id) {
  const d = state();
  d.plannedChannels = d.plannedChannels.filter((p) => p.id !== id);
  save();
}

// ---------- Statistik tahlil (bepul) ----------
function words(title) {
  return String(title)
    .toLowerCase()
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/[^\p{L}\p{N}'’\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function computeStats(videos, now = Date.now()) {
  for (const v of videos) {
    v.ageDays = Math.max(0.5, (now - new Date(v.publishedAt).getTime()) / DAY);
    v.viewsPerDay = Math.round(v.views / v.ageDays);
  }
  const mature = videos.filter((v) => v.ageDays >= 3);
  const pool = mature.length >= 3 ? mature : videos;
  const med = median(pool.map((v) => v.views)) || 0;
  for (const v of videos) v.outlier = med ? Math.round((v.views / med) * 10) / 10 : null;

  const byOutlier = videos.slice().sort((a, b) => (b.outlier || 0) - (a.outlier || 0));
  const topN = Math.max(3, Math.ceil(videos.length / 4));
  const top = byOutlier.slice(0, topN);
  const rest = byOutlier.slice(topN);

  const shorts = videos.filter((v) => v.isShort);
  const longs = videos.filter((v) => !v.isShort);

  const buckets = DURATION_BUCKETS.map(([lo, hi, label]) => {
    const vs = longs.concat(shorts).filter((v) => v.duration >= lo && v.duration <= hi && v.outlier != null);
    return { label, count: vs.length, medianViews: median(vs.map((v) => v.views)), avgOutlier: vs.length ? Math.round((vs.reduce((s, v) => s + v.outlier, 0) / vs.length) * 10) / 10 : null };
  }).filter((b) => b.count);
  const bestBucket = buckets.filter((b) => b.count >= 2).sort((a, b) => b.avgOutlier - a.avgOutlier)[0] || null;

  const dates = videos.map((v) => new Date(v.publishedAt).getTime()).sort((a, b) => b - a);
  const gaps = dates.slice(1, 30).map((d, i) => (dates[i] - d) / DAY);
  const last30 = videos.filter((v) => v.ageDays <= 30).length;

  const weekday = new Array(7).fill(0);
  for (const v of videos) weekday[new Date(v.publishedAt).getUTCDay()]++;
  const hours = videos.map((v) => new Date(v.publishedAt).getUTCHours());

  const share = (list, fn) => (list.length ? Math.round((list.filter(fn).length / list.length) * 100) : 0);
  const hasNumber = (t) => /\d/.test(t);
  const hasQuestion = (t) => /\?/.test(t);
  const hasYou = (t) => /\b(you|your|you're|you’re)\b/i.test(t);
  const hasCaps = (t) => /\b[A-Z]{3,}\b/.test(t);

  const openers = {};
  for (const v of videos) {
    const key = words(v.title).slice(0, 2).join(' ');
    if (!key) continue;
    openers[key] ||= { opener: key, count: 0, outliers: [] };
    openers[key].count++;
    if (v.outlier != null) openers[key].outliers.push(v.outlier);
  }
  const topOpeners = Object.values(openers)
    .filter((o) => o.count >= 2)
    .map((o) => ({ opener: o.opener, count: o.count, avgOutlier: o.outliers.length ? Math.round((o.outliers.reduce((s, x) => s + x, 0) / o.outliers.length) * 10) / 10 : null }))
    .sort((a, b) => (b.avgOutlier || 0) - (a.avgOutlier || 0))
    .slice(0, 8);

  // Kalit so'zlar: eng yaxshi chorakda ko'p, qolganlarida kam uchraydiganlar (lift)
  const freq = (list) => {
    const f = {};
    for (const v of list) for (const w of new Set(words(v.title))) if (!STOP.has(w) && w.length > 2) f[w] = (f[w] || 0) + 1;
    return f;
  };
  const fTop = freq(top);
  const fRest = freq(rest);
  const keywords = Object.entries(fTop)
    .filter(([, n]) => n >= 2)
    .map(([w, n]) => ({ word: w, top: n, lift: Math.round(((n / top.length) / (((fRest[w] || 0) + 1) / (rest.length + 1))) * 10) / 10 }))
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 12);

  return {
    analyzed: videos.length,
    medianViews: med,
    medianShorts: median(shorts.map((v) => v.views)),
    medianLong: median(longs.map((v) => v.views)),
    shortsCount: shorts.length,
    longCount: longs.length,
    medianDurationLong: median(longs.map((v) => v.duration)),
    buckets,
    bestBucket,
    uploadsLast30: last30,
    medianGapDays: gaps.length ? Math.round(median(gaps) * 10) / 10 : null,
    topWeekday: WEEKDAYS[weekday.indexOf(Math.max(...weekday))],
    medianHourUtc: hours.length ? median(hours) : null,
    titles: {
      avgLength: videos.length ? Math.round(videos.reduce((s, v) => s + v.title.length, 0) / videos.length) : 0,
      topAvgLength: top.length ? Math.round(top.reduce((s, v) => s + v.title.length, 0) / top.length) : 0,
      number: { top: share(top, (v) => hasNumber(v.title)), all: share(videos, (v) => hasNumber(v.title)) },
      question: { top: share(top, (v) => hasQuestion(v.title)), all: share(videos, (v) => hasQuestion(v.title)) },
      you: { top: share(top, (v) => hasYou(v.title)), all: share(videos, (v) => hasYou(v.title)) },
      caps: { top: share(top, (v) => hasCaps(v.title)), all: share(videos, (v) => hasCaps(v.title)) },
    },
    openers: topOpeners,
    keywords,
    topIds: top.map((v) => v.id),
  };
}

// ---------- Raqobatchilar ----------
export async function addCompetitor({ input, targetIds = [] }) {
  const info = await resolveChannel(input);
  const d = state();
  if (d.competitors.some((c) => c.youtubeId === info.youtubeId)) throw new Error(`${info.title} allaqachon qo‘shilgan.`);
  const comp = { id: newId('cp'), input: String(input).trim(), targetIds: targetIds.filter((t) => getTarget(t)), addedAt: new Date().toISOString(), ...info, videos: [], stats: null, ai: null, lastSync: null, newVideoIds: [] };
  d.competitors.push(comp);
  save();
  await syncCompetitor(comp.id);
  return getCompetitor(comp.id);
}

export async function syncCompetitor(id) {
  const comp = getCompetitor(id);
  if (!comp) throw new Error('Raqobatchi topilmadi');
  const info = await resolveChannel(comp.youtubeId);
  const videos = await publicChannelVideos(info.uploads, 200);
  const prevIds = new Set(comp.videos.map((v) => v.id));
  const fresh = comp.lastSync ? videos.filter((v) => !prevIds.has(v.id)) : [];
  comp.stats = computeStats(videos);
  Object.assign(comp, info, { videos, lastSync: new Date().toISOString(), newVideoIds: fresh.map((v) => v.id), lastError: null });
  save();
  if (fresh.length) bus.emit('competitor:new', comp, fresh);
  return comp;
}

export function updateCompetitor(id, body) {
  const comp = getCompetitor(id);
  if (!comp) throw new Error('Raqobatchi topilmadi');
  if (Array.isArray(body.targetIds)) comp.targetIds = body.targetIds.filter((t) => getTarget(t));
  if ('notes' in body) comp.notes = String(body.notes || '').slice(0, 1000);
  save();
  return comp;
}

export function deleteCompetitor(id) {
  const d = state();
  d.competitors = d.competitors.filter((c) => c.id !== id);
  save();
}

/** Kunlik avtomatik yangilash: yangi videolar haqida Telegram xabar beradi. */
export function startCompetitorSync() {
  const tick = async () => {
    for (const c of state().competitors) {
      if (c.lastSync && Date.now() - new Date(c.lastSync).getTime() < DAY) continue;
      try {
        await syncCompetitor(c.id);
      } catch (err) {
        c.lastError = err.message;
        save();
      }
    }
  };
  setInterval(() => tick().catch(() => {}), 6 * 3600_000);
  setTimeout(() => tick().catch(() => {}), 60_000);
}

export async function analyzeCompetitor(id) {
  const comp = getCompetitor(id);
  if (!comp?.stats) throw new Error('Avval raqobatchini yangilang.');
  const top = comp.videos.filter((v) => comp.stats.topIds.includes(v.id)).sort((a, b) => b.outlier - a.outlier);
  const images = [];
  for (const v of top.slice(0, 4)) {
    if (!v.thumbnail) continue;
    try {
      images.push(await fetchImage(v.thumbnail));
    } catch {
      // rasmsiz davom etamiz
    }
  }
  const result = await generateJson({ ...competitorAnalysisPrompt({ comp, top, images: images.length }), images, maxTokens: 4000, cost: { note: comp.title } });
  comp.ai = { ...result, at: new Date().toISOString() };
  save();
  return comp.ai;
}

// ---------- G'oyalar va ssenariylar ----------
function ownSummary(target) {
  if (target.kind !== 'channel') return null;
  const d = db().diagnoses?.[target.id];
  if (!d) return null;
  return {
    hits: d.videos.filter((v) => v.verdict === 'hit').slice(0, 5).map((v) => `${v.title} (${v.views})`),
    flops: d.videos.filter((v) => v.verdict === 'flop').slice(0, 5).map((v) => `${v.title} (${v.views})`),
  };
}

export async function generateIdeas({ targetId, competitorIds = [], count = 8, format = 'any', notes = '' }) {
  const target = getTarget(targetId);
  if (!target) throw new Error('Maqsad kanalni tanlang.');
  const comps = competitorIds.map(getCompetitor).filter((c) => c?.stats);
  if (!comps.length) throw new Error('Kamida bitta tahlil qilingan raqobatchini tanlang.');
  const n = Math.max(3, Math.min(15, Number(count) || 8));
  const result = await generateJson({
    ...ideasPrompt({ target, comps, count: n, format, notes: String(notes).slice(0, 800), own: ownSummary(target) }),
    maxTokens: 6000,
    cost: target.kind === 'channel' ? { channelId: target.id } : {},
  });
  const batch = newId('b');
  const created = (result.ideas || []).slice(0, n).map((x) => ({
    id: newId('i'),
    batch,
    targetId,
    competitorIds: comps.map((c) => c.id),
    title: String(x.title || '').slice(0, 120),
    hook: String(x.hook || ''),
    angle: String(x.angle || ''),
    format: x.format === 'short' ? 'short' : 'long',
    lengthSec: Number(x.lengthSec) || null,
    thumbnailText: String(x.thumbnailText || ''),
    thumbnailConcept: String(x.thumbnailConcept || ''),
    inspiredBy: String(x.inspiredBy || ''),
    why: String(x.why || ''),
    potential: Math.max(1, Math.min(10, Number(x.potential) || 5)),
    status: 'new',
    script: null,
    createdAt: new Date().toISOString(),
  }));
  state().ideas.unshift(...created);
  save();
  return created;
}

export function updateIdea(id, body) {
  const idea = state().ideas.find((i) => i.id === id);
  if (!idea) throw new Error('G‘oya topilmadi');
  if (['new', 'saved', 'used', 'rejected'].includes(body.status)) idea.status = body.status;
  if (typeof body.title === 'string' && body.title.trim()) idea.title = body.title.trim().slice(0, 120);
  save();
  return idea;
}

export function deleteIdea(id) {
  const d = state();
  d.ideas = d.ideas.filter((i) => i.id !== id);
  save();
}

export async function writeScript(id) {
  const idea = state().ideas.find((i) => i.id === id);
  if (!idea) throw new Error('G‘oya topilmadi');
  const target = getTarget(idea.targetId);
  if (!target) throw new Error('Maqsad kanal o‘chirilgan.');
  const comps = idea.competitorIds.map(getCompetitor).filter(Boolean);
  const script = await generateJson({
    ...scriptPrompt({ idea, target, comps }),
    maxTokens: 8000,
    cost: target.kind === 'channel' ? { channelId: target.id } : {},
  });
  idea.script = { ...script, at: new Date().toISOString() };
  if (idea.status === 'new') idea.status = 'saved';
  save();
  return idea;
}
