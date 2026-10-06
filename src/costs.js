import { db, save, newId, getProject } from './store.js';

export class BudgetError extends Error {
  constructor() {
    super('Oylik byudjet tugagan — pullik AI chaqiruvlari to‘xtatildi.');
    this.name = 'BudgetError';
  }
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function addCost({ kind, amount, projectId = null, channelId = null, note = '' }) {
  if (!amount || amount <= 0) return;
  const rounded = Math.round(amount * 10000) / 10000;
  db().costs.push({ id: newId('c'), at: new Date().toISOString(), kind, amount: rounded, projectId, channelId, note });
  if (projectId) {
    const project = getProject(projectId);
    if (project) project.cost = Math.round(((project.cost || 0) + rounded) * 10000) / 10000;
  }
  save();
}

export function removeCost(id) {
  const { costs } = db();
  const idx = costs.findIndex((c) => c.id === id);
  if (idx >= 0) costs.splice(idx, 1);
  save();
}

export function monthSummary(month = monthKey()) {
  const { costs, settings, projects } = db();
  const entries = costs.filter((c) => c.at.slice(0, 7) === month);
  const variable = entries.reduce((sum, c) => sum + c.amount, 0);
  const fixed = (settings.fixedMonthly || []).reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const total = variable + fixed;
  const byKind = {};
  const byChannel = {};
  for (const c of entries) {
    byKind[c.kind] = (byKind[c.kind] || 0) + c.amount;
    if (c.channelId) byChannel[c.channelId] = (byChannel[c.channelId] || 0) + c.amount;
  }
  const videos = projects
    .filter((p) => p.createdAt.slice(0, 7) === month)
    .reduce((n, p) => n + (p.outputs || []).filter((o) => o.file).length, 0);
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = month === monthKey(now) ? now.getDate() : daysInMonth;
  const projected = fixed + (variable / Math.max(1, dayOfMonth)) * daysInMonth;
  return {
    month,
    budget: Number(settings.monthlyBudget || 0),
    variable: round(variable),
    fixed: round(fixed),
    total: round(total),
    remaining: round(Number(settings.monthlyBudget || 0) - total),
    projected: round(projected),
    videos,
    perVideo: videos ? round(total / videos) : null,
    byKind: mapRound(byKind),
    byChannel: mapRound(byChannel),
    entries: entries.slice().reverse(),
  };
}

/** Pullik chaqiruvdan oldin tekshiriladi: byudjet tugagan bo'lsa, ish bepul usulga o'tadi. */
export function assertBudget() {
  const s = monthSummary();
  if (s.budget > 0 && s.total >= s.budget) throw new BudgetError();
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function mapRound(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, round(v)]));
}
