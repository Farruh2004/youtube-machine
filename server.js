import http from 'node:http';
import os from 'node:os';
import { HOST, PORT, BASE_URL } from './src/config.js';
import { load } from './src/store.js';
import { handle } from './src/routes.js';
import { resumeQueue } from './src/pipeline.js';
import { startScheduler } from './src/scheduler.js';
import { checkFfmpeg } from './src/media/ffmpeg.js';
import { resumeSources } from './src/highlights.js';
import { startTelegram, sendMessage } from './src/telegram.js';
import { startCompetitorSync } from './src/competitors.js';

load();

const ff = await checkFfmpeg();
if (!ff.ok) {
  console.warn(ff.error ? `⚠️  ${ff.error}` : `⚠️  ffmpeg’da yetishmayotgan filtrlar: ${ff.missing.join(', ')}`);
}

if (!['127.0.0.1', 'localhost', '::1'].includes(HOST) && !process.env.APP_PASSWORD) {
  console.warn('⚠️  HOST tashqi tarmoqqa ochiq, lekin APP_PASSWORD berilmagan. Portni faqat 127.0.0.1 ga chiqaring (masalan, docker -p 127.0.0.1:4300:4300) yoki parol qo‘ying.');
}

const server = http.createServer(handle);
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\nℹ️  Dastur allaqachon ishlab turibdi: ${BASE_URL}\n   Brauzerda shu manzilni oching.\n`);
    process.exit(0);
  }
  throw err;
});
server.listen(PORT, HOST, () => {
  console.log(`\n🎬 YouTube Machine ishga tushdi: ${BASE_URL}\n   To‘xtatish: Ctrl+C\n`);
  if (HOST === '0.0.0.0' && process.env.APP_PASSWORD) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
    // 100.64.0.0/10 — Tailscale shaxsiy tarmog'i: istalgan joydan, faqat sizning qurilmalaringiz
    const isTailscale = (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
    const ts = ips.filter(isTailscale);
    const lan = ips.filter((ip) => !isTailscale(ip));
    if (ts.length) {
      console.log('🌍 Istalgan joydan (Tailscale yoqilgan telefon/kompyuterdan) oching:');
      for (const ip of ts) console.log(`     http://${ip}:${PORT}`);
    }
    if (lan.length) {
      console.log('📱 Shu Wi‑Fi’dan oching:');
      for (const ip of lan) console.log(`     http://${ip}:${PORT}`);
    }
    console.log('   Login: istalgan so‘z, parol: siz bergan parol.\n');
    // Manzilni Telegram'ga ham yuboramiz (parol emas!) — telefondan bir bosishda ochish uchun
    if (ts.length) sendMessage(`🌍 YouTube Machine ishga tushdi.\nIstalgan joydan: http://${ts[0]}:${PORT}\n(Telefonda Tailscale yoqilgan bo‘lsin.)`).catch(() => {});
  }
  resumeQueue();
  resumeSources();
  startTelegram();
  startScheduler();
  startCompetitorSync();
});
