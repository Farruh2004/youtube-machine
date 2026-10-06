// Telegram bot: tayyor videolar haqida xabar beradi va telefondan tasdiqlash imkonini beradi.
// Ommaviy manzil kerak emas — bot "long polling" (getUpdates) orqali ishlaydi.
import fs from 'node:fs';
import path from 'node:path';
import { db, save, getProject, getChannel, projectDir } from './store.js';
import { bus } from './events.js';
import { approve } from './scheduler.js';
import { enqueue, queueState } from './pipeline.js';
import { monthSummary } from './costs.js';
import { runDiagnosis, getDiagnosis } from './diagnose.js';

const API = process.env.TELEGRAM_API || 'https://api.telegram.org';
const MAX_UPLOAD = 49 * 1024 * 1024; // Bot API orqali fayl yuborish chegarasi ~50 MB
let offset = 0;
let started = false;

const settings = () => db().settings;
const ready = () => Boolean(settings().telegramToken && settings().telegramChatId);

async function call(method, body, { form = false } = {}) {
  const token = settings().telegramToken;
  if (!token) throw new Error('Telegram token sozlanmagan');
  const res = await fetch(`${API}/bot${token}/${method}`, form
    ? { method: 'POST', body }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram: ${data.description || res.status}`);
  return data.result;
}

export async function sendMessage(text, extra = {}) {
  if (!ready()) return null;
  return call('sendMessage', { chat_id: settings().telegramChatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}

async function sendFile(method, field, file, caption, extra = {}) {
  const form = new FormData();
  form.append('chat_id', String(settings().telegramChatId));
  form.append(field, await fs.openAsBlob(file), path.basename(file));
  if (caption) {
    form.append('caption', caption.slice(0, 1000));
    form.append('parse_mode', 'HTML');
  }
  for (const [k, v] of Object.entries(extra)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  return call(method, form, { form: true });
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const label = (o) => (o.kind === 'long' ? 'Uzun video' : /^short\d+$/.test(o.id) ? `Shorts ${o.id.slice(5)}` : 'Shorts');

function reviewKeyboard(p) {
  return {
    inline_keyboard: [
      [{ text: '✅ Tasdiqlash', callback_data: `approve:${p.id}` }, { text: '🔁 Qayta montaj', callback_data: `rerun:${p.id}` }],
      [{ text: '🎬 Videolarni yuborish', callback_data: `send:${p.id}` }, { text: '📱 TikTok/Reels matni', callback_data: `social:${p.id}` }],
    ],
  };
}

async function notifyReview(p) {
  const ch = getChannel(p.channelId);
  const lines = p.outputs.filter((o) => o.file).map((o) => `• <b>${label(o)}</b>: ${esc(o.title)}`);
  const caption = `🎬 <b>${esc(ch?.name)}</b> — video tayyor\n<b>${esc(p.title)}</b>\n\n${lines.join('\n')}\n\nXarajat: $${(p.cost || 0).toFixed(2)}`;
  const thumb = p.outputs.find((o) => o.thumbnail)?.thumbnail;
  const file = thumb && path.join(projectDir(p.id), thumb);
  if (file && fs.existsSync(file)) await sendFile('sendPhoto', 'photo', file, caption, { reply_markup: reviewKeyboard(p) });
  else await sendMessage(caption, { reply_markup: reviewKeyboard(p) });
}

async function sendVideos(p) {
  for (const o of p.outputs.filter((x) => x.file)) {
    const file = path.join(projectDir(p.id), o.file);
    if (!fs.existsSync(file)) continue;
    if (fs.statSync(file).size > MAX_UPLOAD) {
      await sendMessage(`📦 ${label(o)}: fayl 50 MB dan katta — Telegram bot orqali yuborib bo‘lmaydi. Kompyuterdan yuklab oling.`);
      continue;
    }
    await sendFile('sendVideo', 'video', file, `${label(o)}: ${esc(o.title)}`, { supports_streaming: 'true' });
  }
}

/** TikTok va Instagram Reels uchun tayyor matn (videoni qo'lda joylash uchun). */
export function socialCaption(o) {
  const title = o.title.replace(/#shorts/gi, '').trim();
  const tags = (o.description.match(/#[\p{L}\p{N}_]+/gu) || []).filter((t) => !/^#shorts$/i.test(t)).slice(0, 5);
  return `${title}\n\n${[...new Set([...tags, '#fyp', '#reels'])].join(' ')}`;
}

async function sendSocial(p) {
  for (const o of p.outputs.filter((x) => x.file && x.kind === 'short')) {
    await sendMessage(`📱 <b>${label(o)}</b> — TikTok / Reels uchun matn (nusxa oling):\n\n<code>${esc(socialCaption(o))}</code>`);
  }
}

async function handleCallback(q) {
  const [action, id] = String(q.data || '').split(':');
  const p = getProject(id);
  const answer = (text) => call('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => {});
  if (!p) return answer('Loyiha topilmadi');
  try {
    if (action === 'approve') {
      if (p.status !== 'review') return answer('Bu loyiha hozir tasdiqlash holatida emas');
      approve(p);
      await answer('Tasdiqlandi ✅');
      const when = p.outputs.filter((o) => o.publishAt).map((o) => `• ${label(o)}: ${new Date(o.publishAt).toLocaleString('uz-UZ')}`).join('\n');
      await sendMessage(`✅ <b>${esc(p.title)}</b> jadvalga qo‘yildi:\n${when}`);
    } else if (action === 'rerun') {
      enqueue(p.id);
      await answer('Qayta montaj navbatga qo‘yildi');
    } else if (action === 'send') {
      await answer('Yuborilmoqda…');
      await sendVideos(p);
    } else if (action === 'social') {
      await answer('Matn yuborilmoqda');
      await sendSocial(p);
    } else {
      await answer('Noma’lum buyruq');
    }
  } catch (err) {
    await answer(err.message.slice(0, 180));
  }
}

async function handleMessage(m) {
  const s = settings();
  const text = String(m.text || '').trim();
  // Birinchi /start yuborgan chat — egasi. Boshqalarning xabarlari e'tiborsiz qoldiriladi.
  if (!s.telegramChatId && text.startsWith('/start')) {
    s.telegramChatId = String(m.chat.id);
    save();
    await sendMessage('👋 Bot ulandi! Endi video tayyor bo‘lganda shu yerga xabar keladi.\n\n/status — holat\n/next — yaqin jadval\n/tashxis — kanal tashxisi');
    return;
  }
  if (String(m.chat.id) !== String(s.telegramChatId)) return;
  if (text.startsWith('/status') || text.startsWith('/start')) {
    const { projects } = db();
    const count = (st) => projects.filter((p) => p.status === st).length;
    const c = monthSummary();
    const q = queueState();
    await sendMessage(
      `📊 <b>Holat</b>\nKo‘rib chiqish kutmoqda: ${count('review')}\nNavbatda/ishlanmoqda: ${q.waiting.length + (q.running ? 1 : 0)}\nXato: ${count('failed')}\n\n💵 Shu oy: $${c.total.toFixed(2)} / $${c.budget}`,
    );
    for (const p of projects.filter((x) => x.status === 'review').slice(-5)) await notifyReview(p);
  } else if (text.startsWith('/tashxis')) {
    for (const ch of db().channels) {
      let d;
      try {
        d = await runDiagnosis(ch);
      } catch (err) {
        d = getDiagnosis(ch.id);
        if (!d) {
          await sendMessage(`🩺 <b>${esc(ch.name)}</b>: ${esc(err.message)}`);
          continue;
        }
      }
      const top = d.channelIssues.filter((i) => i.severity !== 'info').slice(0, 3);
      const flops = d.videos.filter((v) => v.verdict === 'flop').slice(0, 5);
      await sendMessage(
        `🩺 <b>${esc(ch.name)}</b> — ${d.score}/100\n🚀 ${d.counts.hit} uchgan · 📉 ${d.counts.flop} uchmagan · 🆕 ${d.counts.new} yangi` +
          (top.length ? `\n\n<b>Kanal:</b>\n${top.map((i) => `• ${esc(i.title)}`).join('\n')}` : '') +
          (flops.length ? `\n\n<b>Uchmagan videolar:</b>\n${flops.map((v) => `• ${esc(v.title)} — ${esc(v.issues[0]?.title || 'sabab aniqlanmadi')}`).join('\n')}` : '') +
          '\n\nBatafsil va AI xulosasi: dasturda “Kanal tashxisi” sahifasi.',
      );
    }
  } else if (text.startsWith('/next')) {
    const items = [];
    for (const p of db().projects) {
      for (const o of p.outputs || []) {
        if (o.publishAt && new Date(o.publishAt) > new Date() && o.upload.status !== 'done') items.push({ p, o });
      }
    }
    items.sort((a, b) => new Date(a.o.publishAt) - new Date(b.o.publishAt));
    await sendMessage(items.length
      ? `📅 <b>Yaqin chiqishlar</b>\n${items.slice(0, 10).map(({ p, o }) => `• ${new Date(o.publishAt).toLocaleString('uz-UZ')} — ${esc(getChannel(p.channelId)?.name)}: ${esc(o.title)}`).join('\n')}`
      : 'Jadvalda video yo‘q.');
  } else {
    await sendMessage('Buyruqlar:\n/status — holat va tasdiqlash kutayotgan videolar\n/next — yaqin chiqish jadvali\n/tashxis — kanallar tashxisi: nega videolar uchmadi');
  }
}

async function pollLoop() {
  for (;;) {
    if (!settings().telegramToken) {
      await sleep(5000);
      continue;
    }
    try {
      const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) await handleMessage(u.message).catch((err) => console.error('Telegram:', err.message));
        if (u.callback_query && String(u.callback_query.message?.chat?.id) === String(settings().telegramChatId)) {
          await handleCallback(u.callback_query).catch((err) => console.error('Telegram:', err.message));
        }
      }
    } catch (err) {
      console.error('Telegram:', err.message);
      await sleep(10_000);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (fn) => (...args) => {
  if (ready()) fn(...args).catch((err) => console.error('Telegram:', err.message));
};

export function startTelegram() {
  if (started) return;
  started = true;
  bus.on('project:review', safe(notifyReview));
  bus.on('project:failed', safe((p) => sendMessage(`❌ <b>${esc(p.title)}</b>: ${esc(p.error)}`)));
  bus.on('upload:done', safe((p, o) => sendMessage(`📤 YouTube’ga yuklandi: <b>${esc(o.title)}</b>\nhttps://youtu.be/${o.upload.videoId}${o.publishAt ? `\nOchiladi: ${new Date(o.publishAt).toLocaleString('uz-UZ')}` : ''}`)));
  bus.on('competitor:new', safe((c, videos) => sendMessage(`🕵️ <b>${esc(c.title)}</b> yangi video chiqardi:\n${videos.slice(0, 5).map((v) => `• ${esc(v.title)} — https://youtu.be/${v.id}`).join('\n')}\n\nDasturda: Raqobatchilar → ${esc(c.title)}`)));
  bus.on('upload:failed', safe((p, o) => sendMessage(`⚠️ Yuklash xatosi: <b>${esc(o.title)}</b>\n${esc(o.upload.error)}`)));
  pollLoop();
}

export async function testTelegram() {
  if (!settings().telegramToken) throw new Error('Avval bot tokenini kiriting.');
  const me = await call('getMe');
  if (!settings().telegramChatId) return { bot: me.username, linked: false };
  await sendMessage('✅ YouTube Machine bilan aloqa ishlayapti.');
  return { bot: me.username, linked: true };
}
