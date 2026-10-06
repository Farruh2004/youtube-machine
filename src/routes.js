import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { PUBLIC_DIR, PROJECTS_DIR, PUBLIC_URL } from './config.js';
import { db, save, newId, getProject, getChannel, projectDir } from './store.js';
import { enqueue, initSteps, queueState } from './pipeline.js';
import { monthSummary, addCost, removeCost } from './costs.js';
import { approve, unapprove, uploadNow, calendar, nextSlots } from './scheduler.js';
import { authUrl, completeAuth, disconnect, channelReport, REDIRECT_URI, deepReport, retention, trends, unansweredComments, replyToComment, updateVideoTitle } from './youtube.js';
import { generateJson, textProviderReady } from './ai/llm.js';
import { speechReady, ttsReady } from './ai/speech.js';
import { insightsPrompt, trendsPrompt, commentRepliesPrompt } from './ai/prompts.js';
import { checkFfmpeg } from './media/ffmpeg.js';
import { testTelegram } from './telegram.js';
import { runDiagnosis, getDiagnosis, aiChannelAdvice, aiVideoDiagnosis } from './diagnose.js';
import * as comp from './competitors.js';
import { channelDir, normalizeScene, scenePrompt } from './workflows/explainer.js';
import { SFX_DIR, listSfx, listMusic, ensureBuiltinSfx } from './media/sfx.js';
import { imageProviderReady } from './ai/images.js';
import { verifyKey, keyChecks, SERVICES } from './keys.js';
import { SOURCES_DIR, sourceDir, getSource, createSource, analyzeSource, candidateToProject, deleteSource } from './highlights.js';

const SECRET_KEYS = ['anthropicKey', 'openaiKey', 'geminiKey', 'googleClientSecret', 'youtubeApiKey', 'elevenKey', 'telegramToken', 'githubToken'];
const MASK = '••••';
const UPLOAD_FIELDS = {
  audio: ['.mp3', '.wav', '.m4a', '.flac', '.ogg'],
  cover: ['.png', '.jpg', '.jpeg', '.webp'],
  clip: ['.mp4', '.mov', '.mkv', '.webm', '.avi'],
  voice: ['.mp3', '.wav', '.m4a'],
  bgvideo: ['.mp4', '.mov', '.webm', '.mkv'],
  character: ['.png', '.jpg', '.jpeg', '.webp'],
  music: ['.mp3', '.wav', '.m4a', '.ogg'],
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

let ffmpegStatus = null;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new HttpError(413, 'So‘rov juda katta');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Noto‘g‘ri JSON');
  }
}

function mustProject(id) {
  const p = getProject(id);
  if (!p) throw new HttpError(404, 'Loyiha topilmadi');
  return p;
}

function mustChannel(id) {
  const c = getChannel(id);
  if (!c) throw new HttpError(404, 'Kanal topilmadi');
  return c;
}

function publicSettings() {
  const s = { ...db().settings };
  for (const k of SECRET_KEYS) s[k] = s[k] ? `${MASK}${s[k].slice(-4)}` : '';
  s.customKeys = (s.customKeys || []).map((c) => ({ name: c.name, note: c.note || '', value: c.value ? `${MASK}${c.value.slice(-4)}` : '' }));
  return s;
}

function publicChannel(c) {
  const { youtube, ...rest } = c;
  return {
    ...rest,
    youtube: youtube ? { connected: true, title: youtube.title, channelId: youtube.channelId, connectedAt: youtube.connectedAt, expired: Boolean(youtube.expired) } : { connected: false },
  };
}

function setupChecklist() {
  const s = db().settings;
  return [
    { key: 'ffmpeg', label: 'ffmpeg o‘rnatilgan', ok: Boolean(ffmpegStatus?.ok), hint: ffmpegStatus?.error || (ffmpegStatus?.missing?.length ? `Yetishmayotgan filtrlar: ${ffmpegStatus.missing.join(', ')}` : '') },
    { key: 'text', label: 'Matn uchun AI kaliti (ssenariy, SEO, tahlil)', ok: textProviderReady(), hint: 'API kalitlar sahifasi' },
    { key: 'voice', label: 'Diktor ovozi kaliti (OpenAI, ElevenLabs yoki Google AI Studio)', ok: ttsReady(), hint: 'API kalitlar sahifasi' },
    { key: 'whisper', label: 'OpenAI kaliti (qo‘shiq matnini vokalga moslab vaqtlash)', ok: speechReady(), hint: 'API kalitlar sahifasi' },
    ...(db().channels.some((c) => c.type === 'explainer')
      ? [
          { key: 'images', label: 'Sahna rasmlari kaliti (OpenAI yoki Gemini)', ok: imageProviderReady(), hint: 'API kalitlar sahifasi' },
          ...db().channels.filter((c) => c.type === 'explainer').map((c) => ({ key: `char-${c.id}`, label: `${c.name}: personaj rasmi yuklangan`, ok: Boolean(c.characterFile), hint: 'Sozlamalar → Kanallar' })),
        ]
      : []),
    { key: 'google', label: 'Google OAuth mijozi (YouTube’ga yuklash)', ok: Boolean(s.googleClientId && s.googleClientSecret), hint: 'API kalitlar sahifasi' },
    { key: 'telegram', label: 'Telegram bot ulangan (ixtiyoriy)', ok: Boolean(s.telegramToken && s.telegramChatId), hint: 'API kalitlar sahifasi' },
    ...db().channels.map((c) => ({ key: `yt-${c.id}`, label: `${c.name}: YouTube’ga ulangan`, ok: Boolean(c.youtube?.refreshToken && !c.youtube.expired), hint: 'API kalitlar → Google OAuth' })),
  ];
}

function projectSummary(p) {
  return {
    id: p.id,
    channelId: p.channelId,
    type: p.type,
    title: p.title,
    format: p.format,
    status: p.status,
    error: p.error,
    createdAt: p.createdAt,
    cost: p.cost || 0,
    progress: p.steps?.length ? Math.round((p.steps.filter((s) => s.status === 'done').length / p.steps.length) * 100) : 0,
    currentStep: p.steps?.find((s) => s.status === 'running')?.label || null,
    outputs: (p.outputs || []).map((o) => ({ id: o.id, kind: o.kind, title: o.title, thumbnail: o.thumbnail, publishAt: o.publishAt, upload: o.upload, file: o.file })),
  };
}

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, re, keys, handler });
}

// ---------- Umumiy holat ----------
route('GET', '/api/dashboard', async () => {
  ffmpegStatus ||= await checkFfmpeg();
  const { channels, projects } = db();
  const counts = {};
  for (const p of projects) counts[p.status] = (counts[p.status] || 0) + 1;
  return {
    costs: monthSummary(),
    counts,
    queue: queueState(),
    checklist: setupChecklist(),
    channels: channels.map((c) => {
      const d = getDiagnosis(c.id);
      return { ...publicChannel(c), nextSlot: nextSlots(c, 1)[0] || null, diagnosis: d ? { score: d.score, flop: d.counts.flop, hit: d.counts.hit, at: d.at } : null };
    }),
    recent: projects.slice(-12).reverse().map(projectSummary),
  };
});

route('GET', '/api/settings', () => ({ settings: publicSettings(), channels: db().channels.map(publicChannel), redirectUri: REDIRECT_URI }));

route('PUT', '/api/settings', async (req) => {
  const body = await readJson(req);
  const s = db().settings;
  for (const [k, v] of Object.entries(body)) {
    if (!(k in s)) continue;
    if (SECRET_KEYS.includes(k) && typeof v === 'string' && v.startsWith(MASK)) continue;
    if (k === 'prices') s.prices = { ...s.prices, ...Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, Number(pv) || 0])) };
    else if (k === 'monthlyBudget' || k === 'uploadLeadHours') s[k] = Number(v) || 0;
    else if (k === 'customKeys') {
      // Yashirin (••••) qiymat kelsa, shu nomdagi eski kalit saqlanib qoladi
      const old = new Map((s.customKeys || []).map((c) => [c.name, c.value]));
      s.customKeys = (Array.isArray(v) ? v : [])
        .map((c) => ({ name: String(c.name || '').trim().slice(0, 60), note: String(c.note || '').slice(0, 200), value: String(c.value || '').trim() }))
        .filter((c) => c.name)
        .map((c) => ({ ...c, value: c.value.startsWith(MASK) ? old.get(c.name) || '' : c.value }));
    } else if (k === 'fixedMonthly') s.fixedMonthly = (v || []).filter((f) => f.name).map((f) => ({ name: String(f.name), amount: Number(f.amount) || 0 }));
    else s[k] = typeof v === 'string' ? v.trim() : v;
  }
  save();
  return { settings: publicSettings() };
});

route('PUT', '/api/channels/:id', async (req, { id }) => {
  const c = mustChannel(id);
  const body = await readJson(req);
  const allowed = ['name', 'handle', 'publishTime', 'shortsSeconds', 'defaultPrivacy', 'aiDisclosure', 'categoryId', 'language', 'baseTags', 'descriptionFooter', 'colors', 'shortsPerSong', 'karaoke', 'translateLyrics', 'bgMotion', 'fightEffects', 'smartCrop', 'nicheKeywords', 'niche', 'style', 'sceneSeconds', 'captionsLong', 'captionsShort', 'defaultFormat', 'captionStyle', 'sceneLabels', 'sfx', 'sfxGenerate', 'sfxVolume', 'musicAuto', 'musicVolume', 'voiceStyle'];
  for (const k of allowed) if (k in body) c[k] = body[k];
  c.shortsSeconds = Math.max(10, Math.min(180, Number(c.shortsSeconds) || 40));
  for (const k of ['sfxVolume', 'musicVolume']) if (k in body) c[k] = Math.max(0, Math.min(1.5, Number(body[k]) || 0));
  if ('captionStyle' in body) c.captionStyle = body.captionStyle === 'outline' ? 'outline' : 'pill';
  if ('sceneSeconds' in body) c.sceneSeconds = Math.max(3, Math.min(20, Number(body.sceneSeconds) || 7));
  if ('shortsPerSong' in body) c.shortsPerSong = Math.max(1, Math.min(5, Number(body.shortsPerSong) || 1));
  if (typeof c.baseTags === 'string') c.baseTags = c.baseTags.split(',').map((t) => t.trim()).filter(Boolean);
  save();
  return publicChannel(c);
});

const CHANNEL_DEFAULTS = {
  explainer: { colors: { primary: '#facc15', secondary: '#111827', background: '#ffffff' }, publishTime: '17:00', shortsSeconds: 50, categoryId: '27', sceneSeconds: 7, captionsLong: false, captionsShort: true, defaultFormat: 'long', aiDisclosure: false, baseTags: ['explained', 'facts', 'animation'], descriptionFooter: '🔔 Subscribe for a new explainer every day.' },
  music: { colors: { primary: '#8b5cf6', secondary: '#2563eb' }, publishTime: '18:00', shortsSeconds: 40, shortsPerSong: 3, karaoke: true, translateLyrics: true, bgMotion: true, categoryId: '10', aiDisclosure: true, baseTags: ['AI music'], descriptionFooter: '🎵 This song was created with AI.' },
  fight: { colors: { primary: '#ef4444', secondary: '#111827' }, publishTime: '19:00', shortsSeconds: 58, fightEffects: true, smartCrop: true, categoryId: '17', aiDisclosure: false, baseTags: ['fight breakdown'], descriptionFooter: '🥊 Original breakdown and commentary.' },
};

export function createChannel({ name, type = 'explainer', handle = '', language = 'en', niche = '', style = '' }) {
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) throw new HttpError(400, 'Kanal nomini kiriting');
  if (!CHANNEL_DEFAULTS[type]) throw new HttpError(400, 'Noma’lum kanal turi');
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kanal';
  let id = base;
  for (let i = 2; getChannel(id); i++) id = `${base}-${i}`;
  const channel = { id, name: clean, type, handle: String(handle || '').trim(), language, niche: String(niche || '').slice(0, 500), style: String(style || '').slice(0, 500), defaultPrivacy: 'public', ...structuredClone(CHANNEL_DEFAULTS[type]), youtube: null, createdAt: new Date().toISOString() };
  db().channels.push(channel);
  save();
  return channel;
}

route('POST', '/api/channels', async (req) => publicChannel(createChannel(await readJson(req))));

route('PUT', '/api/channels/:id/character', async (req, { id }, url) => {
  const c = mustChannel(id);
  const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
  if (!UPLOAD_FIELDS.character.includes(ext)) throw new HttpError(400, `Ruxsat etilgan formatlar: ${UPLOAD_FIELDS.character.join(', ')}`);
  const dir = channelDir(c.id);
  if (c.characterFile) fs.rmSync(path.join(dir, c.characterFile), { force: true });
  const name = `character${ext}`;
  await streamPipeline(req, fs.createWriteStream(path.join(dir, name)));
  c.characterFile = name;
  c.characterAt = new Date().toISOString();
  c.character = null;
  save();
  return publicChannel(c);
});

// ---------- Kanal fon musiqalari ----------
const AUDIO_UP = ['.mp3', '.wav', '.m4a', '.ogg'];
const safeName = (name) => path.basename(String(name || '')).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'fayl';

route('GET', '/api/channels/:id/music', (req, { id }) => ({ files: listMusic(channelDir(mustChannel(id).id)) }));

route('PUT', '/api/channels/:id/music', async (req, { id }, url) => {
  const c = mustChannel(id);
  const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
  if (!AUDIO_UP.includes(ext)) throw new HttpError(400, `Ruxsat etilgan formatlar: ${AUDIO_UP.join(', ')}`);
  const name = `music-${safeName(url.searchParams.get('name'))}${ext}`;
  await streamPipeline(req, fs.createWriteStream(path.join(channelDir(c.id), name)));
  return { files: listMusic(channelDir(c.id)) };
});

route('DELETE', '/api/channels/:id/music/:name', (req, { id, name }) => {
  const c = mustChannel(id);
  if (!listMusic(channelDir(c.id)).includes(name)) throw new HttpError(404, 'Fayl topilmadi');
  fs.rmSync(path.join(channelDir(c.id), name), { force: true });
  return { files: listMusic(channelDir(c.id)) };
});

// ---------- Ovoz effektlari kutubxonasi ----------
route('GET', '/api/sfx', async () => {
  await ensureBuiltinSfx();
  return { files: listSfx() };
});

route('PUT', '/api/sfx', async (req, params, url) => {
  const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
  if (!AUDIO_UP.includes(ext)) throw new HttpError(400, `Ruxsat etilgan formatlar: ${AUDIO_UP.join(', ')}`);
  fs.mkdirSync(SFX_DIR, { recursive: true });
  await streamPipeline(req, fs.createWriteStream(path.join(SFX_DIR, `${safeName(url.searchParams.get('name'))}${ext}`)));
  return { files: listSfx() };
});

route('DELETE', '/api/sfx/:name', (req, { name }) => {
  if (!listSfx().includes(name) || name.startsWith('builtin-')) throw new HttpError(404, 'Fayl topilmadi');
  fs.rmSync(path.join(SFX_DIR, name), { force: true });
  return { files: listSfx() };
});

route('POST', '/api/planned/:id/launch', async (req, { id }) => {
  const d = db();
  const p = (d.plannedChannels || []).find((x) => x.id === id);
  if (!p) throw new HttpError(404, 'Topilmadi');
  const body = await readJson(req);
  const type = ['explainer', 'music', 'fight'].includes(p.format) ? p.format : 'explainer';
  const channel = createChannel({ name: p.name, type, language: p.language, niche: [p.niche, p.audience && `Audience: ${p.audience}`].filter(Boolean).join('. '), style: p.style, handle: body.handle });
  // G'oyalar va raqobatchilar yangi kanalga o'tkaziladi
  for (const i of d.ideas || []) if (i.targetId === p.id) i.targetId = channel.id;
  for (const c of d.competitors || []) c.targetIds = (c.targetIds || []).map((t) => (t === p.id ? channel.id : t));
  d.plannedChannels = d.plannedChannels.filter((x) => x.id !== p.id);
  save();
  return publicChannel(channel);
});

route('POST', '/api/ideas/:id/produce', async (req, { id }) => {
  const idea = (db().ideas || []).find((i) => i.id === id);
  if (!idea) throw new HttpError(404, 'G‘oya topilmadi');
  const channel = getChannel(idea.targetId);
  if (!channel || channel.type !== 'explainer') throw new HttpError(400, 'Bu g‘oyani videoga aylantirish uchun maqsad — tushuntiruvchi (explainer) kanal bo‘lishi kerak.');
  const body = await readJson(req);
  const format = body.format === 'short' || idea.format === 'short' ? 'short' : 'long';
  const project = {
    id: newId('p'),
    channelId: channel.id,
    type: 'explainer',
    title: idea.title,
    format,
    status: 'draft',
    createdAt: new Date().toISOString(),
    inputs: { idea: [idea.title, idea.hook && `Hook: ${idea.hook}`, idea.angle && `Angle: ${idea.angle}`].filter(Boolean).join('\n'), targetMinutes: idea.lengthSec && format === 'long' ? String(Math.round(idea.lengthSec / 60)) : '', targetSeconds: idea.lengthSec && format === 'short' ? String(idea.lengthSec) : '' },
    content: {},
    analysis: null,
    outputs: [],
    log: [],
    cost: 0,
    steps: [],
  };
  // Ssenariy allaqachon yozilgan bo'lsa — sahnalarga aylantirib, AI'ga qayta pul to'lamaymiz
  const sc = idea.script;
  if (sc?.sections?.length) {
    project.content.script = {
      title: sc.title || idea.title,
      scenes: [...(sc.hook ? [{ narration: sc.hook, visual: idea.thumbnailConcept || sc.sections[0].visual }] : []), ...sc.sections.map((x) => ({ narration: x.narration, visual: x.visual })), ...(sc.cta ? [{ narration: sc.cta, visual: 'The mascot waves goodbye and points to a subscribe button' }] : [])].filter((x) => x.narration),
      thumbnailText: sc.thumbnailText || idea.thumbnailText,
      thumbnailConcept: sc.thumbnailConcept || idea.thumbnailConcept,
      description: sc.description || '',
      tags: sc.tags || [],
    };
  }
  initSteps(project);
  db().projects.push(project);
  projectDir(project.id);
  idea.status = 'used';
  idea.projectId = project.id;
  save();
  enqueue(project.id);
  return project;
});

// ---------- Loyihalar ----------
route('GET', '/api/projects', () => ({ projects: db().projects.slice().reverse().map(projectSummary) }));

route('POST', '/api/projects', async (req) => {
  const body = await readJson(req);
  const channel = mustChannel(body.channelId);
  const project = {
    id: newId('p'),
    channelId: channel.id,
    type: channel.type,
    title: String(body.title || '').trim() || (channel.type === 'music' ? body.inputs?.songTitle : channel.type === 'explainer' ? String(body.inputs?.idea || '').slice(0, 80) : body.inputs?.fighters) || 'Yangi loyiha',
    format: channel.type === 'music' ? 'both' : body.format === 'long' ? 'long' : 'short',
    status: 'draft',
    createdAt: new Date().toISOString(),
    inputs: sanitizeInputs(body.inputs),
    content: {},
    analysis: null,
    outputs: [],
    log: [],
    cost: 0,
    steps: [],
  };
  initSteps(project);
  db().projects.push(project);
  projectDir(project.id);
  save();
  return project;
});

function sanitizeInputs(inputs = {}) {
  const textFields = ['songTitle', 'genre', 'mood', 'lyricsLanguage', 'lyrics', 'fighters', 'event', 'notes', 'sourceRights', 'idea', 'ownScript', 'targetMinutes', 'targetSeconds'];
  return Object.fromEntries(textFields.filter((k) => k in inputs).map((k) => [k, String(inputs[k] ?? '').slice(0, 20000)]));
}

route('GET', '/api/projects/:id', (req, { id }) => mustProject(id));

route('PUT', '/api/projects/:id', async (req, { id }) => {
  const p = mustProject(id);
  const body = await readJson(req);
  if (body.title) p.title = String(body.title).slice(0, 200);
  if (body.inputs) Object.assign(p.inputs, sanitizeInputs(body.inputs));
  if (body.format && (p.type === 'fight' || p.type === 'explainer')) p.format = body.format === 'long' ? 'long' : 'short';
  if (body.content) {
    const c = body.content;
    if ('hook' in c || 'narration' in c) {
      if ('hook' in c) p.content.hook = String(c.hook);
      if ('narration' in c) p.content.narration = String(c.narration);
      p.content.scriptManual = true;
    }
    if ('lyricsLrc' in c) {
      p.content.lyricsLrc = String(c.lyricsLrc);
      p.content.lyricsManual = true;
    }
    if ('thumbnailText' in c) p.content.thumbnailText = String(c.thumbnailText).slice(0, 60);
    if (Array.isArray(c.scenes) && p.content.script?.scenes) {
      // Sahnalar tahriri: bo'sh matnli sahna o'chiriladi; o'zgargan sahnaning ovozi/rasmi qayta yaratiladi
      const old = p.content.script.scenes;
      // `from` — sahnaning avvalgi tartib raqami (o'chirish/qo'shishda kesh adashmasligi uchun)
      p.content.script.scenes = c.scenes
        .map((x, i) => {
          const prev = Number.isInteger(x.from) ? old[x.from] : 'from' in x ? null : old[i];
          const pick = (k) => (k in x ? x[k] : prev?.[k]);
          return { ...(prev || {}), ...normalizeScene({ narration: pick('narration'), visual: pick('visual'), label: pick('label'), highlight: pick('highlight'), sfx: pick('sfx'), voiceStyle: pick('voiceStyle') }) };
        })
        // Bo'sh sahna o'chadi (o'zingiz yuklagan rasm/ovozli sahna — matnsiz ham qoladi)
        .filter((x) => x.narration || x.imageManual || x.voiceManual);
      if (c.scenes.some((x) => 'sfx' in x)) p.content.script.sfxChosen = true;
    }
    if ('scriptTitle' in c && p.content.script) p.content.script.title = String(c.scriptTitle).slice(0, 100);
    if ('translationText' in c) {
      const lines = String(c.translationText).split(/\r?\n/);
      p.content.translation = lines.some((l) => l.trim()) ? { key: null, lines } : null;
      p.content.translationManual = Boolean(p.content.translation);
    }
    for (const k of ['keyMoment', 'focusX', 'focusY']) {
      if (k in c) p.content[k] = c[k] === '' || c[k] == null ? null : Math.max(0, Number(c[k]) || 0);
    }
    if ('effectsOff' in c) p.content.effectsOff = Boolean(c.effectsOff);
    if ('shortStart' in c) p.content.shortStart = c.shortStart === '' || c.shortStart == null ? null : Math.max(0, Number(c.shortStart) || 0);
  }
  for (const edit of body.outputs || []) {
    const o = p.outputs.find((x) => x.id === edit.id);
    if (!o) continue;
    if ('title' in edit) o.title = String(edit.title).slice(0, 100);
    if ('description' in edit) o.description = String(edit.description).slice(0, 5000);
    if ('tags' in edit) o.tags = (Array.isArray(edit.tags) ? edit.tags : String(edit.tags).split(',')).map((t) => t.trim()).filter(Boolean);
    if ('title' in edit || 'description' in edit || 'tags' in edit) o.metaManual = true;
    if ('privacy' in edit && ['public', 'unlisted', 'private'].includes(edit.privacy)) o.privacy = edit.privacy;
    if ('aiDisclosure' in edit) o.aiDisclosure = Boolean(edit.aiDisclosure);
    if ('publishAt' in edit) o.publishAt = edit.publishAt ? new Date(edit.publishAt).toISOString() : null;
  }
  save();
  return p;
});

route('DELETE', '/api/projects/:id', (req, { id }) => {
  const p = mustProject(id);
  const state = queueState();
  if (state.running === id || state.waiting.includes(id)) throw new HttpError(409, 'Loyiha hozir ishlanmoqda — tugashini kuting.');
  db().projects = db().projects.filter((x) => x.id !== p.id);
  fs.rmSync(path.join(PROJECTS_DIR, p.id), { recursive: true, force: true });
  save();
  return { ok: true };
});

route('PUT', '/api/projects/:id/upload', async (req, { id }, url) => {
  const p = mustProject(id);
  const field = url.searchParams.get('field');
  const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
  if (!UPLOAD_FIELDS[field]) throw new HttpError(400, 'Noma’lum fayl turi');
  if (!UPLOAD_FIELDS[field].includes(ext)) throw new HttpError(400, `Ruxsat etilgan formatlar: ${UPLOAD_FIELDS[field].join(', ')}`);
  const dir = projectDir(p.id);
  const name = `input-${field}${ext}`;
  const old = p.inputs[`${field}File`];
  if (old && old !== name) fs.rmSync(path.join(dir, old), { force: true });
  await streamPipeline(req, fs.createWriteStream(path.join(dir, name)));
  p.inputs[`${field}File`] = name;
  save();
  return { file: name };
});

route('DELETE', '/api/projects/:id/upload', (req, { id }, url) => {
  const p = mustProject(id);
  const field = url.searchParams.get('field');
  const name = p.inputs[`${field}File`];
  if (name) fs.rmSync(path.join(projectDir(p.id), name), { force: true });
  delete p.inputs[`${field}File`];
  save();
  return { ok: true };
});

// ---------- Tayyor materiallar (o'zingiz yasagan rasm va ovozlar) ----------
const IMPORT = { image: ['importImages', 'import-img', UPLOAD_FIELDS.cover], voice: ['importVoices', 'import-voice', UPLOAD_FIELDS.voice.concat(['.ogg', '.flac'])] };

route('PUT', '/api/projects/:id/import', async (req, { id }, url) => {
  const p = mustProject(id);
  const kind = IMPORT[url.searchParams.get('kind')];
  if (!kind || p.type !== 'explainer') throw new HttpError(400, 'Noma’lum fayl turi');
  const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
  if (!kind[2].includes(ext)) throw new HttpError(400, `Ruxsat etilgan formatlar: ${kind[2].join(', ')}`);
  const list = (p.inputs[kind[0]] ||= []);
  if (list.length >= 200) throw new HttpError(400, 'Juda ko‘p fayl');
  const name = `${kind[1]}-${String(list.length + 1).padStart(3, '0')}${ext}`;
  await streamPipeline(req, fs.createWriteStream(path.join(projectDir(p.id), name)));
  list.push(name);
  save();
  return { files: list };
});

route('DELETE', '/api/projects/:id/import', (req, { id }, url) => {
  const p = mustProject(id);
  const kind = IMPORT[url.searchParams.get('kind')];
  if (!kind) throw new HttpError(400, 'Noma’lum fayl turi');
  for (const f of p.inputs[kind[0]] || []) fs.rmSync(path.join(projectDir(p.id), f), { force: true });
  delete p.inputs[kind[0]];
  save();
  return { ok: true };
});

// Bitta sahnaning rasmini yoki ovozini o'zingiznikiga almashtirish (masalan, ChatGPT'da chizilgan rasm)
route('PUT', '/api/projects/:id/scenes/:index/:kind', async (req, { id, index, kind }, url) => {
  const p = mustProject(id);
  const sc = p.content.script?.scenes?.[Number(index)];
  if (!sc || !['image', 'voice'].includes(kind)) throw new HttpError(404, 'Sahna topilmadi');
  const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
  const allowed = kind === 'image' ? UPLOAD_FIELDS.cover : IMPORT.voice[2];
  if (!allowed.includes(ext)) throw new HttpError(400, `Ruxsat etilgan formatlar: ${allowed.join(', ')}`);
  const name = `manual-${kind === 'image' ? 'img' : 'voice'}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  await streamPipeline(req, fs.createWriteStream(path.join(projectDir(p.id), name)));
  const old = kind === 'image' ? sc.imageManual && sc.imageFile : sc.voiceManual && sc.voiceFile;
  if (old && old.startsWith('manual-')) fs.rmSync(path.join(projectDir(p.id), old), { force: true });
  if (kind === 'image') Object.assign(sc, { imageFile: name, imageManual: true, imageKey: null });
  else {
    Object.assign(sc, { voiceFile: name, voiceManual: true, voiceKey: null, wordsKey: null, words: null });
    // Umumiy ovoz rejimidan sahnalab ovozga o'tiladi
    p.content.fullVoice = null;
  }
  save();
  return p;
});

route('DELETE', '/api/projects/:id/scenes/:index/:kind', (req, { id, index, kind }) => {
  const p = mustProject(id);
  const sc = p.content.script?.scenes?.[Number(index)];
  if (!sc || !['image', 'voice'].includes(kind)) throw new HttpError(404, 'Sahna topilmadi');
  if (kind === 'image') Object.assign(sc, { imageManual: false, imageKey: null });
  else Object.assign(sc, { voiceManual: false, voiceKey: null });
  save();
  return p;
});

// Rasm va ovoz promptlari — ChatGPT / AI Studio'da qo'lda yaratish uchun nusxa
route('GET', '/api/projects/:id/prompts', (req, { id }) => {
  const p = mustProject(id);
  const channel = mustChannel(p.channelId);
  const scenes = p.content.script?.scenes || [];
  const orientation = p.format === 'short' ? 'portrait' : 'landscape';
  const voiceStyle = channel.voiceStyle || p.content.script?.voiceStyle || '';
  const text = scenes.map((sc, i) => [
    `=== ${i + 1}-sahna ${sc.label ? `— ${sc.label}` : ''}`,
    `RASM PROMPTI (${orientation === 'portrait' ? '9:16' : '16:9'}):`,
    scenePrompt({ visual: sc.visual, character: p.content.character?.description, channel, orientation }),
    '',
    `OVOZ (${[voiceStyle, sc.voiceStyle].filter(Boolean).join(' ') || 'friendly, curious explainer narrator'}):`,
    sc.narration,
  ].join('\n')).join('\n\n');
  return { text, scenes: scenes.length };
});

route('POST', '/api/projects/:id/run', async (req, { id }) => {
  const body = await readJson(req);
  try {
    enqueue(id, body.from || null, { regenerate: Boolean(body.regenerate) });
  } catch (err) {
    throw new HttpError(409, err.message);
  }
  return projectSummary(mustProject(id));
});

route('POST', '/api/projects/:id/approve', (req, { id }) => {
  const p = mustProject(id);
  if (!['review', 'approved', 'published'].includes(p.status)) throw new HttpError(409, 'Loyiha hali tayyor emas.');
  try {
    approve(p);
  } catch (err) {
    throw new HttpError(409, err.message);
  }
  return p;
});

route('POST', '/api/projects/:id/unapprove', (req, { id }) => {
  const p = mustProject(id);
  unapprove(p);
  return p;
});

route('POST', '/api/projects/:id/outputs/:oid/upload-now', (req, { id, oid }) => {
  const p = mustProject(id);
  try {
    uploadNow(p, oid);
  } catch (err) {
    throw new HttpError(409, err.message);
  }
  return p;
});

// ---------- Jadval, xarajat, tahlil ----------
route('GET', '/api/schedule', (req, params, url) => ({
  days: calendar(Math.min(60, Number(url.searchParams.get('days')) || 14)),
  channels: db().channels.map(publicChannel),
}));

route('GET', '/api/costs', (req, params, url) => monthSummary(url.searchParams.get('month') || undefined));

route('POST', '/api/costs', async (req) => {
  const body = await readJson(req);
  const amount = Number(body.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Summa musbat bo‘lishi kerak');
  addCost({ kind: body.kind || 'manual', amount, channelId: body.channelId || null, note: String(body.note || '').slice(0, 200) });
  return monthSummary();
});

route('DELETE', '/api/costs/:id', (req, { id }) => {
  removeCost(id);
  return monthSummary();
});

route('GET', '/api/analytics/:id', async (req, { id }) => {
  const c = mustChannel(id);
  try {
    return await channelReport(c);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('POST', '/api/analytics/:id/insights', async (req, { id }) => {
  const c = mustChannel(id);
  try {
    const report = await channelReport(c);
    return await generateJson({ ...insightsPrompt({ channel: c, report }), cost: { channelId: c.id } });
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('GET', '/api/analytics/:id/deep', async (req, { id }, url) => {
  const c = mustChannel(id);
  try {
    return await deepReport(c, Math.min(365, Number(url.searchParams.get('days')) || 28));
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('GET', '/api/analytics/:id/retention/:video', async (req, { id, video }) => {
  const c = mustChannel(id);
  try {
    return { points: await retention(c, video) };
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('POST', '/api/analytics/:id/trends', async (req, { id }) => {
  const c = mustChannel(id);
  const keywords = String(c.nicheKeywords || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!keywords.length) throw new HttpError(400, 'Avval Sozlamalar → Kanallar bo‘limida “Soha kalit so‘zlari”ni kiriting.');
  try {
    const videos = await trends(c, keywords);
    let analysis = null;
    if (videos.length && textProviderReady()) {
      try {
        analysis = await generateJson({ ...trendsPrompt({ channel: c, videos }), cost: { channelId: c.id } });
      } catch (err) {
        analysis = { summary: `AI tahlil bo‘lmadi: ${err.message}`, patterns: [], ideas: [] };
      }
    }
    return { keywords, videos, analysis };
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('GET', '/api/comments/:id', async (req, { id }) => {
  const c = mustChannel(id);
  try {
    return { comments: await unansweredComments(c) };
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('POST', '/api/comments/:id/drafts', async (req, { id }) => {
  const c = mustChannel(id);
  const { comments = [] } = await readJson(req);
  if (!comments.length) return { replies: [] };
  try {
    const r = await generateJson({ ...commentRepliesPrompt({ channel: c, comments: comments.slice(0, 30) }), cost: { channelId: c.id } });
    return { replies: Array.isArray(r.replies) ? r.replies.map(String) : [] };
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('POST', '/api/comments/:id/reply', async (req, { id }) => {
  const c = mustChannel(id);
  const { parentId, text } = await readJson(req);
  if (!parentId || !String(text || '').trim()) throw new HttpError(400, 'Javob matni bo‘sh');
  try {
    await replyToComment(c, parentId, text);
    return { ok: true };
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

// ---------- Raqobatchilar, g'oyalar, ssenariylar ----------
const wrap = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (err) {
    if (err.status) throw err;
    throw new HttpError(400, err.message);
  }
};

route('GET', '/api/competitors', () => {
  const d = db();
  return {
    competitors: (d.competitors || []).map(({ videos, ...c }) => ({ ...c, bestVideo: videos.slice().sort((a, b) => (b.outlier || 0) - (a.outlier || 0))[0] || null })),
    targets: comp.targets(),
    planned: d.plannedChannels || [],
    aiReady: textProviderReady(),
  };
});
route('POST', '/api/competitors', wrap(async (req) => comp.addCompetitor(await readJson(req))));
route('GET', '/api/competitors/:id', wrap((req, { id }) => {
  const c = comp.getCompetitor(id);
  if (!c) throw new HttpError(404, 'Topilmadi');
  return { competitor: c, targets: comp.targets(), aiReady: textProviderReady() };
}));
route('PUT', '/api/competitors/:id', wrap(async (req, { id }) => comp.updateCompetitor(id, await readJson(req))));
route('POST', '/api/competitors/:id/sync', wrap((req, { id }) => comp.syncCompetitor(id)));
route('POST', '/api/competitors/:id/ai', wrap((req, { id }) => comp.analyzeCompetitor(id)));
route('DELETE', '/api/competitors/:id', wrap((req, { id }) => {
  comp.deleteCompetitor(id);
  return { ok: true };
}));

route('POST', '/api/planned', wrap(async (req) => comp.savePlannedChannel(await readJson(req))));
route('DELETE', '/api/planned/:id', wrap((req, { id }) => {
  comp.deletePlannedChannel(id);
  return { ok: true };
}));

route('GET', '/api/ideas', () => ({
  ideas: db().ideas || [],
  targets: comp.targets(),
  competitors: (db().competitors || []).map((c) => ({ id: c.id, title: c.title, avatar: c.avatar, targetIds: c.targetIds, ready: Boolean(c.stats) })),
  aiReady: textProviderReady(),
}));
route('POST', '/api/ideas/generate', wrap(async (req) => ({ ideas: await comp.generateIdeas(await readJson(req)) })));
route('PUT', '/api/ideas/:id', wrap(async (req, { id }) => comp.updateIdea(id, await readJson(req))));
route('POST', '/api/ideas/:id/script', wrap((req, { id }) => comp.writeScript(id)));
route('DELETE', '/api/ideas/:id', wrap((req, { id }) => {
  comp.deleteIdea(id);
  return { ok: true };
}));

// ---------- Kanal tashxisi ----------
route('GET', '/api/diagnose/:id', (req, { id }) => {
  mustChannel(id);
  return { diagnosis: getDiagnosis(id), aiReady: textProviderReady() };
});

route('POST', '/api/diagnose/:id/run', async (req, { id }) => {
  const c = mustChannel(id);
  try {
    return { diagnosis: await runDiagnosis(c), aiReady: textProviderReady() };
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('POST', '/api/diagnose/:id/ai', async (req, { id }) => {
  const c = mustChannel(id);
  try {
    return await aiChannelAdvice(c);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('POST', '/api/diagnose/:id/video/:video', async (req, { id, video }) => {
  const c = mustChannel(id);
  try {
    return await aiVideoDiagnosis(c, video);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('POST', '/api/diagnose/:id/video/:video/title', async (req, { id, video }) => {
  const c = mustChannel(id);
  const { title } = await readJson(req);
  if (!String(title || '').trim()) throw new HttpError(400, 'Sarlavha bo‘sh');
  try {
    await updateVideoTitle(c, video, String(title).trim());
    const d = getDiagnosis(id);
    const v = d?.videos.find((x) => x.id === video);
    if (v) {
      v.titleHistory = [...(v.titleHistory || []), { from: v.title, to: String(title).trim(), at: new Date().toISOString() }];
      v.title = String(title).trim();
      save();
    }
    return { ok: true };
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

// ---------- To'liq jangdan lavha topish ----------
route('GET', '/api/sources', () => ({ sources: (db().sources || []).slice().reverse() }));

route('POST', '/api/sources', async (req) => createSource(await readJson(req)));

route('GET', '/api/sources/:id', (req, { id }) => {
  const src = getSource(id);
  if (!src) throw new HttpError(404, 'Topilmadi');
  return src;
});

route('PUT', '/api/sources/:id/upload', async (req, { id }, url) => {
  const src = getSource(id);
  if (!src) throw new HttpError(404, 'Topilmadi');
  const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
  if (!UPLOAD_FIELDS.clip.includes(ext)) throw new HttpError(400, `Ruxsat etilgan formatlar: ${UPLOAD_FIELDS.clip.join(', ')}`);
  const name = `source${ext}`;
  await streamPipeline(req, fs.createWriteStream(path.join(sourceDir(src.id), name)));
  src.file = name;
  save();
  analyzeSource(src.id);
  return src;
});

route('POST', '/api/sources/:id/analyze', async (req, { id }) => {
  const src = getSource(id);
  if (!src) throw new HttpError(404, 'Topilmadi');
  const body = await readJson(req);
  if (body.clipLength) src.clipLength = Math.max(8, Math.min(55, Number(body.clipLength) || 20));
  if (body.count) src.count = Math.max(1, Math.min(15, Number(body.count) || 6));
  try {
    analyzeSource(id);
  } catch (err) {
    throw new HttpError(409, err.message);
  }
  return src;
});

route('POST', '/api/sources/:id/candidates/:cid/create', async (req, { id, cid }) => {
  const body = await readJson(req);
  try {
    return await candidateToProject(id, cid, { format: body.format, channelId: body.channelId });
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

route('DELETE', '/api/sources/:id', (req, { id }) => {
  deleteSource(id);
  return { ok: true };
});

route('GET', '/api/keys', () => ({
  settings: publicSettings(),
  checks: keyChecks(),
  channels: db().channels.map(publicChannel),
  redirectUri: REDIRECT_URI,
}));

route('POST', '/api/keys/:service/verify', async (req, { service }) => {
  if (!SERVICES.includes(service)) throw new HttpError(404, 'Noma’lum xizmat');
  return verifyKey(service);
});

route('POST', '/api/telegram/test', async () => {
  try {
    return await testTelegram();
  } catch (err) {
    throw new HttpError(400, err.message);
  }
});

// ---------- YouTube ulanishi ----------
route('GET', '/api/youtube/auth/:id', (req, { id }, url, res) => {
  mustChannel(id);
  // Google kirishdan keyin REDIRECT_URI ga qaytaradi: oddiy rejimda bu 127.0.0.1 — faqat dastur turgan kompyuterning o'zida ishlaydi.
  // PUBLIC_URL berilgan (sayt) rejimda — shu manzildan.
  const sameHost = PUBLIC_URL ? new URL(PUBLIC_URL).host === req.headers.host : /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '');
  if (!sameHost) {
    res.writeHead(302, { location: `/#/keys?error=${encodeURIComponent('YouTube’ga ulashni dastur o‘rnatilgan kompyuterning o‘zida bajaring (telefon yoki boshqa kompyuterdan bo‘lmaydi). Ulangandan keyin hamma joydan ishlayveradi.')}` });
    res.end();
    return undefined;
  }
  try {
    res.writeHead(302, { location: authUrl(id) });
  } catch (err) {
    res.writeHead(302, { location: `/#/keys?error=${encodeURIComponent(err.message)}` });
  }
  res.end();
  return undefined;
});

route('POST', '/api/youtube/disconnect/:id', (req, { id }) => {
  mustChannel(id);
  disconnect(id);
  return { ok: true };
});

/** Google'ning texnik xatolarini oddiy tilga o'giradi va nima qilishni aytadi. */
export function friendlyGoogleError(msg) {
  const m = String(msg || '');
  const link = /https:\/\/console\.(developers|cloud)\.google\.com\/[^\s"]+/.exec(m)?.[0];
  if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(m)) {
    return `Google loyihangizda YouTube API yoqilmagan. Shu havolani oching va “Enable” bosing, so‘ng qayta ulang: ${link || 'https://console.cloud.google.com/flows/enableapi?apiid=youtube.googleapis.com,youtubeanalytics.googleapis.com'}`;
  }
  if (/^access_denied$/.test(m)) {
    return 'Google kirishni rad etdi. Ko‘pincha sabab: ilova “Testing” holatida. Google Cloud → Google Auth Platform → Audience → “Publish app” bosing (yoki Test users’ga emailingizni qo‘shing), so‘ng qayta ulang. Agar o‘zingiz “Cancel” bosgan bo‘lsangiz — shunchaki qayta urining.';
  }
  if (/invalid_client|unauthorized_client/i.test(m)) return 'Client ID yoki Client Secret noto‘g‘ri. Google Cloud’dan JSON faylni qayta yuklab, shu sahifaga tashlang.';
  if (/redirect_uri_mismatch/i.test(m)) return 'Kalit turi noto‘g‘ri: Google Cloud → Clients’da “Desktop app” turidagi yangi kalit yarating va uning JSON faylini shu yerga tashlang.';
  if (/youtubeSignupRequired|no.*channel/i.test(m)) return 'Tanlangan Google akkauntda YouTube kanal yo‘q. Ulashda kanal turgan akkauntni (yoki brend-kanalni) tanlang.';
  return m;
}

route('GET', '/oauth/callback', async (req, params, url, res) => {
  const channelId = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  let target;
  try {
    if (error) throw new Error(error);
    const yt = await completeAuth(channelId, code);
    target = `/#/keys?connected=${encodeURIComponent(yt.title)}`;
  } catch (err) {
    target = `/#/keys?error=${encodeURIComponent(friendlyGoogleError(err.message))}`;
  }
  res.writeHead(302, { location: target });
  res.end();
  return undefined;
});

// ---------- Fayllar ----------
function serveFile(req, res, file) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    let start;
    let end;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    } else {
      // "bytes=-500" — oxirgi 500 bayt
      start = Math.max(0, stat.size - Number(range[2]));
      end = stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const APP_PASSWORD = process.env.APP_PASSWORD || '';

/**
 * Kirish nazorati.
 * - Oddiy rejim: faqat shu kompyuterdagi brauzer (127.0.0.1/localhost), boshqa saytlardan so'rov yo'q.
 * - APP_PASSWORD berilsa (bulut serveri): har qanday manzil, lekin parol bilan (HTTP Basic).
 */
function authorize(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host || '';
  if (APP_PASSWORD) {
    if (origin && origin.replace(/^https?:\/\//, '') !== host) throw new HttpError(403, 'Ruxsat yo‘q');
    const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
    const pass = scheme === 'Basic' ? Buffer.from(encoded || '', 'base64').toString().split(':').slice(1).join(':') : '';
    const a = crypto.createHash('sha256').update(pass).digest();
    const b = crypto.createHash('sha256').update(APP_PASSWORD).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="YouTube Machine", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' });
      res.end('Parol kerak');
      return false;
    }
    return true;
  }
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) throw new HttpError(403, 'Ruxsat yo‘q');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new HttpError(403, 'Ruxsat yo‘q');
  return true;
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  try {
    if (!authorize(req, res)) return;

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const result = await r.handler(req, params, url, res);
      if (result !== undefined) send(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/channel-files/')) {
      const [, , channelId, name] = url.pathname.split('/');
      if (!/^[\w-]+$/.test(channelId || '') || !/^[\w.-]+$/.test(name || '') || name.startsWith('.')) throw new HttpError(400, 'Noto‘g‘ri yo‘l');
      const file = path.join(channelDir(channelId), name);
      if (!fs.existsSync(file)) throw new HttpError(404, 'Fayl topilmadi');
      serveFile(req, res, file);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/sfx-files/')) {
      const name = url.pathname.split('/')[2] || '';
      if (!listSfx().includes(name)) throw new HttpError(404, 'Fayl topilmadi');
      serveFile(req, res, path.join(SFX_DIR, name));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/sources/')) {
      const [, , sourceId, name] = url.pathname.split('/');
      if (!/^[\w-]+$/.test(sourceId || '') || !/^[\w.-]+$/.test(name || '') || name.startsWith('.')) throw new HttpError(400, 'Noto‘g‘ri yo‘l');
      const file = path.join(SOURCES_DIR, sourceId, name);
      if (!fs.existsSync(file)) throw new HttpError(404, 'Fayl topilmadi');
      serveFile(req, res, file);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      const [, , projectId, name] = url.pathname.split('/');
      if (!/^[\w-]+$/.test(projectId || '') || !/^[\w.-]+$/.test(name || '') || name.startsWith('.')) throw new HttpError(400, 'Noto‘g‘ri yo‘l');
      const file = path.join(PROJECTS_DIR, projectId, name);
      if (!fs.existsSync(file)) throw new HttpError(404, 'Fayl topilmadi');
      if (url.searchParams.has('download')) res.setHeader('content-disposition', `attachment; filename="${projectId}-${name}"`);
      serveFile(req, res, file);
      return;
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const rel = url.pathname === '/' ? 'index.html' : path.normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
      const file = path.join(PUBLIC_DIR, rel);
      if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        serveFile(req, res, file);
        return;
      }
    }
    throw new HttpError(404, 'Topilmadi');
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.message });
    else res.end();
  }
}
