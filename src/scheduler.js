// Chiqarish jadvali: har kanalga kuniga bitta video, belgilangan soatda.
// Video publishAt dan `uploadLeadHours` soat oldin "private + publishAt" holatida yuklanadi,
// so'ng YouTube uni o'zi belgilangan vaqtda ochadi.
import path from 'node:path';
import { db, save, getChannel, projectDir } from './store.js';
import { uploadVideo, setThumbnail } from './youtube.js';
import { bus } from './events.js';

let uploading = false;

function localDateKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function slotOn(day, publishTime) {
  const [h, m] = String(publishTime || '18:00').split(':').map(Number);
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function takenDays(channelId, excludeProjectId) {
  const taken = new Set();
  for (const p of db().projects) {
    if (p.channelId !== channelId || p.id === excludeProjectId) continue;
    for (const o of p.outputs || []) {
      if (o.publishAt && o.upload?.status !== 'failed') taken.add(localDateKey(o.publishAt));
    }
  }
  return taken;
}

/** Kanal uchun keyingi bo'sh kunlik slotlar. */
export function nextSlots(channel, count, excludeProjectId = null) {
  const taken = takenDays(channel.id, excludeProjectId);
  const slots = [];
  const day = new Date();
  for (let i = 0; i < 366 && slots.length < count; i++) {
    const slot = slotOn(day, channel.publishTime);
    if (slot.getTime() > Date.now() + 60 * 60_000 && !taken.has(localDateKey(slot))) {
      slots.push(slot);
      taken.add(localDateKey(slot));
    }
    day.setDate(day.getDate() + 1);
  }
  return slots;
}

export function approve(project) {
  const channel = getChannel(project.channelId);
  const ready = (project.outputs || []).filter((o) => o.file && o.upload.status !== 'done');
  if (!ready.length) throw new Error('Tasdiqlash uchun tayyor video yo‘q.');
  const needSlots = ready.filter((o) => !o.publishAt || new Date(o.publishAt).getTime() < Date.now());
  // Uzun video avval, Shorts keyingi kuni — ikkalasi bir kunni egallamaydi.
  const rank = (o) => (o.kind === 'long' ? 0 : 1);
  needSlots.sort((a, b) => rank(a) - rank(b));
  const slots = nextSlots(channel, needSlots.length, project.id);
  // Shu loyihaning boshqa natijalari egallagan kunlarni ham hisobga olamiz
  const own = new Set(ready.filter((o) => !needSlots.includes(o)).map((o) => localDateKey(o.publishAt)));
  let k = 0;
  for (const o of needSlots) {
    while (k < slots.length && own.has(localDateKey(slots[k]))) k++;
    if (k < slots.length) o.publishAt = slots[k++].toISOString();
  }
  for (const o of ready) Object.assign(o.upload, { status: 'scheduled', error: null, progress: 0 });
  project.status = 'approved';
  project.approvedAt = new Date().toISOString();
  save();
}

export function unapprove(project) {
  for (const o of project.outputs || []) {
    if (o.upload.status !== 'done' && o.upload.status !== 'uploading') Object.assign(o.upload, { status: 'none', error: null });
  }
  project.status = 'review';
  save();
}

export function uploadNow(project, outputId) {
  const o = project.outputs.find((x) => x.id === outputId);
  if (!o?.file) throw new Error('Video tayyor emas.');
  if (o.upload.status === 'done' || o.upload.status === 'uploading') throw new Error('Video allaqachon yuklangan yoki yuklanmoqda.');
  o.publishAt = null;
  Object.assign(o.upload, { status: 'scheduled', error: null, progress: 0, now: true });
  if (project.status === 'review') project.status = 'approved';
  save();
  setImmediate(tick);
}

async function uploadOutput(project, output) {
  const channel = getChannel(project.channelId);
  if (!channel.youtube?.refreshToken) {
    Object.assign(output.upload, { status: 'waiting', error: `${channel.name} YouTube’ga ulanmagan. Sozlamalardan ulang.` });
    save();
    return;
  }
  Object.assign(output.upload, { status: 'uploading', error: null, progress: 0 });
  save();
  const log = (msg) => {
    project.log.push({ at: new Date().toISOString(), msg });
    save();
  };
  try {
    const dir = projectDir(project.id);
    let last = 0;
    const video = await uploadVideo(channel, output, path.join(dir, output.file), (pct) => {
      output.upload.progress = pct;
      if (pct - last >= 5) {
        last = pct;
        save();
      }
    });
    Object.assign(output.upload, { status: 'done', videoId: video.id, progress: 100, uploadedAt: new Date().toISOString(), now: false });
    log(`YouTube’ga yuklandi: https://youtu.be/${video.id} (${video.status?.privacyStatus}${video.status?.publishAt ? `, ochiladi: ${video.status.publishAt}` : ''})`);
    if (output.kind === 'long' && output.thumbnail) {
      try {
        await setThumbnail(channel, video.id, path.join(dir, output.thumbnail));
        log('Prevyu o‘rnatildi.');
      } catch (err) {
        log(`Prevyu o‘rnatilmadi (kanal telefon orqali tasdiqlangan bo‘lishi kerak): ${err.message}`);
      }
    }
    if (project.outputs.every((o) => !o.file || o.upload.status === 'done')) project.status = 'published';
    save();
    bus.emit('upload:done', project, output);
  } catch (err) {
    Object.assign(output.upload, { status: 'failed', error: err.message });
    log(`Yuklash xatosi: ${err.message}`);
    bus.emit('upload:failed', project, output);
  }
}

export async function tick() {
  if (uploading) return;
  uploading = true;
  try {
    const lead = Number(db().settings.uploadLeadHours || 3) * 3600_000;
    for (const project of db().projects) {
      for (const o of project.outputs || []) {
        const due = o.upload?.now || !o.publishAt || new Date(o.publishAt).getTime() - lead <= Date.now();
        const connected = Boolean(getChannel(project.channelId)?.youtube?.refreshToken);
        if ((o.upload?.status === 'scheduled' || (o.upload?.status === 'waiting' && connected)) && due) {
          await uploadOutput(project, o);
        }
      }
    }
  } finally {
    uploading = false;
  }
}

export function startScheduler() {
  setInterval(() => tick().catch((err) => console.error('Scheduler:', err)), 60_000);
  setTimeout(() => tick().catch(() => {}), 5_000);
}

/** Jadval ko'rinishi uchun: kelgusi kunlar bo'yicha har kanal slotlari. */
export function calendar(days = 14) {
  const { channels, projects } = db();
  const out = [];
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const key = localDateKey(day);
    const row = { date: key, channels: {} };
    for (const ch of channels) {
      const items = [];
      for (const p of projects.filter((x) => x.channelId === ch.id)) {
        for (const o of p.outputs || []) {
          if (o.publishAt && localDateKey(o.publishAt) === key) {
            items.push({ projectId: p.id, outputId: o.id, kind: o.kind, title: o.title, publishAt: o.publishAt, upload: o.upload.status });
          }
        }
      }
      row.channels[ch.id] = { slot: slotOn(day, ch.publishTime).toISOString(), items };
    }
    out.push(row);
    day.setDate(day.getDate() + 1);
  }
  return out;
}
