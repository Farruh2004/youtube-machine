// To'liq jang videosidan eng qizg'in lahzalarni topish va ulardan Shorts loyihalari yaratish.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { db, save, newId, projectDir, getChannel } from './store.js';
import { ffmpeg, probe, loudnessCurve, pickWindows } from './media/ffmpeg.js';
import { motionProfile, intensityPerSecond } from './media/motion.js';
import { initSteps, enqueue } from './pipeline.js';

export const SOURCES_DIR = path.join(DATA_DIR, 'sources');

export function sourceDir(id) {
  const dir = path.join(SOURCES_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSource(id) {
  return (db().sources ||= []).find((s) => s.id === id);
}

export function createSource({ name, fighters = '', event = '', clipLength = 20, count = 6 }) {
  const src = {
    id: newId('s'),
    name: String(name || 'Jang').slice(0, 200),
    fighters: String(fighters).slice(0, 200),
    event: String(event).slice(0, 200),
    clipLength: Math.max(8, Math.min(55, Number(clipLength) || 20)),
    count: Math.max(1, Math.min(15, Number(count) || 6)),
    status: 'uploading',
    createdAt: new Date().toISOString(),
    file: null,
    candidates: [],
    error: null,
  };
  (db().sources ||= []).push(src);
  sourceDir(src.id);
  save();
  return src;
}

let analyzing = false;
const waiting = [];

export function analyzeSource(id) {
  const src = getSource(id);
  if (!src?.file) throw new Error('Video yuklanmagan');
  src.status = 'queued';
  src.error = null;
  save();
  waiting.push(id);
  setImmediate(next);
}

async function next() {
  if (analyzing) return;
  const id = waiting.shift();
  if (!id) return;
  analyzing = true;
  try {
    await analyze(getSource(id));
  } finally {
    analyzing = false;
    setImmediate(next);
  }
}

async function analyze(src) {
  if (!src) return;
  const dir = sourceDir(src.id);
  const file = path.join(dir, src.file);
  try {
    src.status = 'analyzing';
    save();
    const info = await probe(file);
    if (!info.hasVideo) throw new Error('Video oqimi topilmadi');
    src.duration = info.duration;
    src.width = info.width;
    src.height = info.height;
    // Uzun videoda tezlik uchun 4 kadr/soniya va kichik o'lcham yetarli
    const samples = await motionProfile(file, { fps: 4, width: 64, srcW: info.width, srcH: info.height });
    const loud = info.hasAudio ? await loudnessCurve(file) : null;
    const perSec = intensityPerSecond(samples, loud, info.duration);
    const len = Math.min(src.clipLength, Math.max(4, Math.floor(info.duration) - 1));
    const starts = pickWindows(perSec, len, src.count, 0, Math.max(0, perSec.length - len));
    const scored = starts.map((start) => {
      let sum = 0;
      for (let i = start; i < start + len; i++) sum += perSec[i] || 0;
      let peak = start;
      for (let i = start; i < start + len; i++) if ((perSec[i] || 0) > (perSec[peak] || 0)) peak = i;
      return { start, end: start + len, score: sum / len, peak };
    });
    const max = Math.max(...scored.map((c) => c.score), 0.0001);
    src.candidates = [];
    for (const [i, c] of scored.sort((a, b) => b.score - a.score).entries()) {
      const thumb = `cand-${i + 1}.jpg`;
      await ffmpeg(['-ss', String(c.peak + 0.5), '-i', src.file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', thumb], { cwd: dir });
      src.candidates.push({ id: `c${i + 1}`, start: c.start, end: c.end, peak: c.peak, score: Math.round((c.score / max) * 100), thumb, projectId: null });
    }
    src.status = 'ready';
    save();
  } catch (err) {
    src.status = 'failed';
    src.error = err.message;
    save();
  }
}

/** Tanlangan lavhani kesib, yangi FIGHTDOMAIN loyihasini yaratadi va navbatga qo'yadi. */
export async function candidateToProject(sourceId, candidateId, { format = 'short', channelId } = {}) {
  const src = getSource(sourceId);
  const cand = src?.candidates.find((c) => c.id === candidateId);
  if (!cand) throw new Error('Lavha topilmadi');
  const channel = getChannel(channelId) || db().channels.find((c) => c.type === 'fight');
  if (!channel || channel.type !== 'fight') throw new Error('Jang kanali topilmadi');
  const project = {
    id: newId('p'),
    channelId: channel.id,
    type: 'fight',
    title: `${src.fighters || src.name} — ${fmt(cand.start)}`,
    format: format === 'long' ? 'long' : 'short',
    status: 'draft',
    createdAt: new Date().toISOString(),
    inputs: {
      fighters: src.fighters || src.name,
      event: src.event,
      notes: '',
      // Faqat AI uchun kontekst — diktor matniga aylanmaydi
      clipContext: `Clip from ${fmt(cand.start)} to ${fmt(cand.end)} of the full fight; the most intense exchange is around ${fmt(cand.peak - cand.start + 2)} into the clip.`,
      sourceId: src.id,
    },
    content: {},
    analysis: null,
    outputs: [],
    log: [],
    cost: 0,
    steps: [],
  };
  initSteps(project);
  db().projects.push(project);
  const pdir = projectDir(project.id);
  // Kontekst uchun 2 soniya oldin va keyin; aniq kesish uchun qayta kodlanadi
  const from = Math.max(0, cand.start - 2);
  const length = cand.end - cand.start + 4;
  await ffmpeg(
    ['-ss', String(from), '-i', path.join(sourceDir(src.id), src.file), '-t', String(length), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', 'input-clip.mp4'],
    { cwd: pdir },
  );
  project.inputs.clipFile = 'input-clip.mp4';
  cand.projectId = project.id;
  save();
  enqueue(project.id);
  return project;
}

export function deleteSource(id) {
  const data = db();
  data.sources = (data.sources || []).filter((s) => s.id !== id);
  fs.rmSync(path.join(SOURCES_DIR, id), { recursive: true, force: true });
  save();
}

function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Dastur qayta ishga tushganda yarim qolgan tahlillarni davom ettiradi. */
export function resumeSources() {
  for (const src of db().sources || []) {
    if ((src.status === 'analyzing' || src.status === 'queued') && src.file) analyzeSource(src.id);
    else if (src.status === 'uploading') {
      src.status = 'failed';
      src.error = 'Yuklash tugallanmagan — videoni qayta yuklang.';
    }
  }
  save();
}
