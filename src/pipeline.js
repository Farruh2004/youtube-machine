// Ishlab chiqarish navbati: loyihalar ketma-ket (bir vaqtda bittadan) qayta ishlanadi,
// chunki montaj kompyuter protsessorini to'liq band qiladi.
import { db, save, getProject, getChannel, projectDir } from './store.js';
import * as music from './workflows/music.js';
import * as fight from './workflows/fight.js';
import * as explainer from './workflows/explainer.js';
import { bus } from './events.js';

const WORKFLOWS = { music, fight, explainer };
const queue = [];
let running = null;

export function stepsFor(type) {
  return WORKFLOWS[type].STEPS;
}

export function initSteps(project) {
  project.steps = stepsFor(project.type).map((s) => ({ ...s, status: 'pending', startedAt: null, finishedAt: null, error: null, progress: 0 }));
}

/**
 * Loyihani navbatga qo'yadi. Odatda AI natijalari (matn, SEO, ovoz, vaqtlar) keshdan olinadi —
 * qayta montaj bepul. `regenerate: true` bo'lsa, AI hammasini qaytadan yozadi.
 */
export function enqueue(projectId, fromStep = null, { regenerate = false } = {}) {
  const project = getProject(projectId);
  if (!project) throw new Error('Loyiha topilmadi');
  if (running === projectId || queue.some((j) => j.projectId === projectId)) throw new Error('Loyiha allaqachon navbatda');
  if (regenerate) {
    project.content.regenerate = true;
    project.content.scriptManual = false;
    project.content.lyricsManual = false;
    for (const o of project.outputs || []) o.metaManual = false;
  }
  const keys = stepsFor(project.type).map((s) => s.key);
  const fromIdx = fromStep ? Math.max(0, keys.indexOf(fromStep)) : 0;
  // Oldingi bosqichlar natijalari (masalan, tahlil) mavjud bo'lmasa, boshidan boshlaymiz.
  const startIdx = fromIdx > 0 && !project.analysis ? 0 : fromIdx;
  if (!project.steps?.length) initSteps(project);
  project.steps.forEach((s, i) => {
    if (i >= startIdx) Object.assign(s, { status: 'pending', error: null, progress: 0, startedAt: null, finishedAt: null });
  });
  project.status = 'queued';
  project.error = null;
  save();
  queue.push({ projectId, startIdx });
  setImmediate(tick);
}

export function queueState() {
  return { running, waiting: queue.map((j) => j.projectId) };
}

async function tick() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = job.projectId;
  try {
    await runProject(job);
  } finally {
    const project = getProject(job.projectId);
    if (project) {
      delete project.content.regenerate;
      save();
    }
    running = null;
    setImmediate(tick);
  }
}

async function runProject({ projectId, startIdx }) {
  const project = getProject(projectId);
  if (!project) return;
  const channel = getChannel(project.channelId);
  const wf = WORKFLOWS[project.type];
  project.status = 'processing';
  save();
  const log = (msg) => {
    project.log.push({ at: new Date().toISOString(), msg });
    if (project.log.length > 300) project.log.splice(0, project.log.length - 300);
    save();
  };

  for (let i = startIdx; i < project.steps.length; i++) {
    const step = project.steps[i];
    let lastSave = 0;
    const ctx = {
      project,
      channel,
      settings: db().settings,
      dir: projectDir(project.id),
      costMeta: { projectId: project.id, channelId: project.channelId },
      log,
      progress: (pct) => {
        step.progress = pct;
        if (Date.now() - lastSave > 1500) {
          lastSave = Date.now();
          save();
        }
      },
    };
    Object.assign(step, { status: 'running', startedAt: new Date().toISOString(), error: null });
    save();
    try {
      await wf.run[step.key](ctx);
      Object.assign(step, { status: 'done', progress: 100, finishedAt: new Date().toISOString() });
      save();
    } catch (err) {
      Object.assign(step, { status: 'failed', error: err.message, finishedAt: new Date().toISOString() });
      project.status = 'failed';
      project.error = `${step.label}: ${err.message}`;
      log(`XATO — ${step.label}: ${err.message}`);
      bus.emit('project:failed', project);
      return;
    }
  }
  project.status = 'review';
  log('Tayyor. Videoni ko‘rib chiqing va tasdiqlang.');
  bus.emit('project:review', project);
}

/** Dastur qayta ishga tushganda yarim qolgan ishlarni davom ettiradi. */
export function resumeQueue() {
  for (const p of db().projects) {
    if (p.status === 'processing' || p.status === 'queued') {
      const idx = Math.max(0, (p.steps || []).findIndex((s) => s.status !== 'done'));
      p.status = 'failed';
      try {
        enqueue(p.id, p.steps?.[idx]?.key || null);
      } catch {
        // loyiha buzilgan bo'lsa, foydalanuvchi qo'lda qayta ishga tushiradi
      }
    }
  }
}
