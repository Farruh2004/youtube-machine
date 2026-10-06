// Tutun testi: API kalitlarisiz (bepul shablonlar bilan) ikkala kanal uchun to'liq montajni tekshiradi.
// Ishga tushirish: npm test
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.rmSync(TMP, { recursive: true, force: true });
process.env.YTM_DATA_DIR = TMP;
process.env.YTM_SAMPLE_CHANNELS = '1';

// Soxta Telegram serveri: bot chaqiruvlarini yozib boradi
const http = await import('node:http');
const tg = { calls: [], queue: [{ update_id: 1, message: { chat: { id: 42 }, text: '/start' } }] };
const tgServer = http.createServer((req, res) => {
  const method = req.url.split('/').pop();
  let body = '';
  req.on('data', (d) => {
    body += d;
  });
  req.on('end', () => {
    tg.calls.push({ method, body: req.headers['content-type']?.includes('json') ? body : '[multipart]' });
    const reply = (result) => res.end(JSON.stringify({ ok: true, result }));
    if (method === 'getUpdates') setTimeout(() => reply(tg.queue.splice(0)), 150);
    else if (method === 'getMe') reply({ username: 'test_bot' });
    else reply(true);
  });
});
await new Promise((r) => tgServer.listen(0, '127.0.0.1', r));
process.env.TELEGRAM_API = `http://127.0.0.1:${tgServer.address().port}`;

// Soxta YouTube (Data + Analytics), rasm va Anthropic serveri — kanal tashxisini tekshirish uchun
const now = Date.now();
const ago = (d) => new Date(now - d * 86_400_000).toISOString();
const fakeVideos = [
  { id: 'v1', title: 'Desert Rose — Emotional Arabic Pop', dur: 30, w: 270, h: 480, views: 5000, likes: 300, comments: 20, age: 10, desc: 'A long enough description about this emotional Arabic pop song made with AI, listen to the full version on the channel.' },
  { id: 'v2', title: 'Night Sky — Chill Song', dur: 25, w: 270, h: 480, views: 1000, likes: 40, comments: 3, age: 9, desc: 'A long enough description about this chill song made with AI, listen to the full version on the channel today.' },
  { id: 'v3', title: 'Golden Hour — Lo-fi', dur: 35, w: 270, h: 480, views: 900, likes: 35, comments: 2, age: 8, desc: 'A long enough description about this lo-fi song made with AI, listen to the full version on the channel today.' },
  { id: 'v4', title: 'Fight #boxing #ufc #mma #knockout', dur: 50, w: 480, h: 270, views: 20, likes: 1, comments: 0, age: 7, desc: '', blocked: Array.from({ length: 40 }, (_, i) => `C${i}`) },
  { id: 'v5', title: 'أغنية حزينة جديدة عن الحب', dur: 200, w: 480, h: 270, views: 30, likes: 2, comments: null, age: 6, desc: 'short', kids: true },
  { id: 'v6', title: 'Full Song — Desert Rose (Lyrics)', dur: 240, w: 480, h: 270, views: 100, likes: 5, comments: 1, age: 12, desc: 'A long enough description about this song with full lyrics made with AI, listen and subscribe for more songs.' },
  { id: 'v7', title: 'Full Song — Night Sky (Lyrics)', dur: 300, w: 480, h: 270, views: 120, likes: 6, comments: 1, age: 11, desc: 'A long enough description about this song with full lyrics made with AI, listen and subscribe for more songs.' },
  { id: 'v8', title: 'Brand New Teaser', dur: 20, w: 270, h: 480, views: 10, likes: 1, comments: 0, age: 1, desc: 'A long enough description about this new teaser song made with AI, listen to the full version on the channel today.' },
];
const llmRequests = [];
const openaiCalls = [];
const { execFileSync } = await import('node:child_process');
fs.mkdirSync(TMP, { recursive: true });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x88ccff:s=600x400', '-frames:v', '1', path.join(TMP, 'fake-scene.png')]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=220:d=1.6', '-ac', '1', path.join(TMP, 'fake-voice.mp3')]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=yellow:s=300x400', '-frames:v', '1', path.join(TMP, 'fake-character.png')]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=300:d=1.2', '-ac', '1', '-ar', '24000', '-f', 's16le', path.join(TMP, 'fake-voice.pcm')]);
const geminiBusy = { count: 0, done: false };
const googleServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (d) => {
    body += d;
  });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const p = url.pathname;
    if (p === '/yt/channels') {
      return res.end(JSON.stringify({ items: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', snippet: { title: 'Overtone AI', description: '', publishedAt: ago(30) }, statistics: { subscriberCount: '6', viewCount: '7000', videoCount: '8' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } }, brandingSettings: { channel: {} } }] }));
    }
    if (p === '/yt/playlistItems') return res.end(JSON.stringify({ items: fakeVideos.map((v) => ({ contentDetails: { videoId: v.id } })) }));
    if (p === '/yt/videos') {
      return res.end(JSON.stringify({ items: fakeVideos.map((v) => ({
        id: v.id,
        snippet: { title: v.title, description: v.desc, publishedAt: ago(v.age), categoryId: '10', tags: ['song'], thumbnails: { high: { url: `http://127.0.0.1:${googleServer.address().port}/img/${v.id}.jpg` } } },
        statistics: { viewCount: String(v.views), likeCount: String(v.likes), ...(v.comments == null ? {} : { commentCount: String(v.comments) }) },
        contentDetails: { duration: `PT${v.dur}S`, definition: 'hd', caption: 'false', ...(v.blocked ? { regionRestriction: { blocked: v.blocked } } : {}) },
        status: { privacyStatus: 'public', madeForKids: Boolean(v.kids) },
        player: { embedWidth: String(v.w), embedHeight: String(v.h) },
      })) }));
    }
    if (p.startsWith('/img/')) {
      res.setHeader('content-type', 'image/jpeg');
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    if (p === '/openai/v1/images/edits' || p === '/openai/v1/images/generations') {
      openaiCalls.push('image');
      return res.end(JSON.stringify({ data: [{ b64_json: fs.readFileSync(path.join(TMP, 'fake-scene.png')).toString('base64') }] }));
    }
    if (p === '/openai/v1/audio/transcriptions' && /timestamp_granularities\[\]"\r\n\r\nword/.test(body)) {
      openaiCalls.push('words');
      const ws = ['Scene', 'says', 'something', 'true', 'and', 'short.'];
      return res.end(JSON.stringify({ text: ws.join(' '), words: ws.map((word, i) => ({ word, start: 0.2 + i * 0.22, end: 0.4 + i * 0.22 })) }));
    }
    if (p === '/oauth-token') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: new URLSearchParams(body).get('client_id') === 'bad.apps.googleusercontent.com' ? 'invalid_client' : 'invalid_grant' }));
    }
    if (p === '/gemini/v1beta/models/gemini-2.5-flash:generateContent') {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: { code: 404, message: 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features.' } }));
    }
    if (p === '/gemini/v1beta/models/gemini-flaky:generateContent' && !geminiBusy.done) {
      geminiBusy.count++;
      if (geminiBusy.count >= 2) geminiBusy.done = true;
      res.statusCode = 503;
      return res.end(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.' } }));
    }
    if (p === '/gemini/v1beta/models/gemini-flaky:generateContent' || p === '/gemini/v1beta/models/gemini-3.8-flash:generateContent') {
      openaiCalls.push('gemini-text');
      return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }));
    }
    if (p.startsWith('/gemini/v1beta/models/') && body.includes('"AUDIO"')) {
      openaiCalls.push('gemini-tts');
      return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: fs.readFileSync(path.join(TMP, 'fake-voice.pcm')).toString('base64') } }] } }] }));
    }
    if (p === '/eleven/v1/sound-generation') {
      openaiCalls.push('sfx');
      res.setHeader('content-type', 'audio/mpeg');
      return res.end(fs.readFileSync(path.join(TMP, 'fake-voice.mp3')));
    }
    if (p === '/openai/v1/audio/speech') {
      openaiCalls.push('tts');
      res.setHeader('content-type', 'audio/mpeg');
      return res.end(fs.readFileSync(path.join(TMP, 'fake-voice.mp3')));
    }
    if (p === '/anthropic/v1/messages') {
      const parsed = JSON.parse(body);
      llmRequests.push(parsed);
      const content = parsed.messages[0].content;
      const text = typeof content === 'string' ? content : content.find((c) => c.type === 'text').text;
      const answer = text.includes('Describe the character in the attached image')
        ? { description: 'A round yellow mascot with black glasses and thick outlines.' }
        : text.includes('Write the full video script, split into illustrated scenes')
        ? { title: 'Why You Yawn', scenes: [1, 2, 3, 4].map((n) => ({ narration: `Scene ${n} says something true and short.`, visual: `mascot pose ${n}` })), thumbnailText: 'WHY YAWN?', thumbnailConcept: 'mascot yawning', description: 'About yawning.', hashtags: ['#facts'], tags: ['yawn'] }
        : text.includes('Annotate these scenes')
        ? { title: 'Onion Tears', scenes: [{ label: 'Onion vs you', highlight: ['cry'], sfx: 'pop' }, { label: 'Chemical attack', highlight: ['chemical'], sfx: 'sizzle frying' }, { label: 'Wash it out', highlight: ['wash'], sfx: '' }], thumbnailText: 'WHY CRY?', thumbnailConcept: 'man crying at onion', description: 'Onions.', hashtags: ['#onion'], tags: ['onion'] }
        : text.includes('Analyze this competitor')
        ? { summary: 'Tushuntiruvchi kanal', formula: 'Savol + personaj', titlePatterns: [{ pattern: 'Signs You ___', example: 'Signs', why: 'qiziqish' }], thumbnailStyle: ['sariq personaj'], topicClusters: [], whatToCopy: ['qisqa gaplar'], whatToAvoid: ['qo‘rqitish'], gaps: ['uyqu'] }
        : text.includes('Generate video ideas')
        ? { ideas: [1, 2, 3].map((n) => ({ title: `Idea ${n}`, hook: 'Did you know?', angle: 'yangi', format: 'long', lengthSec: 240, thumbnailText: 'WOW', thumbnailConcept: 'personaj', inspiredBy: 'Signs', why: '5x', potential: 9 - n })) }
        : text.includes('Write the full script for a new song')
        ? { title: 'Song', songConcept: 'sevgi', sunoStyle: 'arabic pop, emotional', lyrics: '[Verse]\nla la\n[Chorus]\nhey', thumbnailText: 'LOVE', description: 'd', tags: ['t'] }
        : text.includes('Write the full script for this video')
        ? { title: 'Script', hook: 'Did you know?', sections: [{ heading: 'Intro', narration: 'Your body does this.', visual: 'yellow character points' }, { heading: 'Fact', narration: 'Here is why.', visual: 'diagram' }], cta: 'Subscribe', estimatedSeconds: 240, thumbnailText: 'WOW', description: 'd', tags: ['t'] }
        : text.includes('Diagnose why this video')
        ? { verdict: 'Gorizontal va bloklangan', reasons: [{ reason: 'Content ID', evidence: '40 davlat', confidence: 'yuqori' }], thumbnail: 'ok', hook: 'tezroq', betterTitles: ['Brutal Knockout Breakdown'], fixes: ['vertikal qiling'], reupload: 'ha' }
        : { summary: 'Kanal yangi', whyNotGrowing: [{ reason: 'Format', evidence: 'v4', fix: 'vertikal', impact: 'yuqori' }], actionPlan: [{ step: 'Shorts', why: 'ishlayapti' }], winningPatterns: ['Shorts'], titleFormula: 'Title — Mood Song', thumbnailAdvice: ['katta matn'], nextVideos: [{ title: 'Idea', why: 'sabab' }] };
      return res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 300 } }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
await new Promise((r) => googleServer.listen(0, '127.0.0.1', r));
process.env.YOUTUBE_API_BASE = `http://127.0.0.1:${googleServer.address().port}/yt`;
process.env.ANTHROPIC_API_BASE = `http://127.0.0.1:${googleServer.address().port}/anthropic`;
process.env.OPENAI_API_BASE = `http://127.0.0.1:${googleServer.address().port}/openai`;
process.env.GEMINI_API_BASE = `http://127.0.0.1:${googleServer.address().port}/gemini`;
process.env.GEMINI_RETRY_MS = '10,10,10';
process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${googleServer.address().port}/oauth-token`;
process.env.ELEVEN_API_BASE = `http://127.0.0.1:${googleServer.address().port}/eleven`;

const { load, db, save, newId, projectDir } = await import('../src/store.js');
const { initSteps, enqueue, queueState } = await import('../src/pipeline.js');
const { ffmpeg, probe, bestWindow } = await import('../src/media/ffmpeg.js');
const { parseLrc, isLrc, distribute, cleanLyrics } = await import('../src/media/lyrics.js');
const { approve, nextSlots } = await import('../src/scheduler.js');
const { monthSummary } = await import('../src/costs.js');

load();
db().settings.telegramToken = 'TEST';
const { startTelegram } = await import('../src/telegram.js');
startTelegram();

// --- Kichik birlik testlari ---
assert.equal(isLrc('[00:01.00] a\n[00:05.50] b'), true);
assert.deepEqual(parseLrc('[00:05.50] b\n[00:01.00] a').map((x) => x.t), [1, 5.5]);
assert.deepEqual(cleanLyrics('[Verse]\nhello\n\n(Chorus)\nworld'), ['hello', 'world']);
const dist = distribute(['aaaa', 'bbbb'], [{ start: 10, end: 20 }]);
assert.equal(dist[0].t, 10);
assert.equal(dist[1].t, 15);
const curve = [];
for (let t = 0; t < 60; t += 0.1) curve.push({ t, m: t > 30 && t < 45 ? -10 : -30 });
const start = bestWindow(curve, 60, 15, 2);
assert.ok(start >= 29 && start <= 31, `eng kuchli parcha ~30 s da bo‘lishi kerak, topildi: ${start}`);
const fracStart = bestWindow(curve, 60.03, 15, 6.0034);
assert.ok(fracStart >= 29 && fracStart <= 31, `kasr boshlanish nuqtasi bilan ham ishlashi kerak: ${fracStart}`);

function createProject(channelId, inputs, format) {
  const channel = db().channels.find((c) => c.id === channelId);
  const p = {
    id: newId('p'),
    channelId,
    type: channel.type,
    title: 'test',
    format,
    status: 'draft',
    createdAt: new Date().toISOString(),
    inputs,
    content: {},
    analysis: null,
    outputs: [],
    log: [],
    cost: 0,
    steps: [],
  };
  initSteps(p);
  db().projects.push(p);
  save();
  return p;
}

async function waitDone(ids) {
  for (let i = 0; i < 600; i++) {
    const st = queueState();
    if (!st.running && !st.waiting.length) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vaqt tugadi: ${ids}`);
}

// --- Overtone: 150 s qo'shiq, uchta baland qism (20-35, 70-85, 120-135 s) -> 3 ta Shorts ---
const music = createProject('overtone', {
  songTitle: 'Midnight Echo',
  genre: 'Arabic pop',
  mood: 'emotional',
  lyrics: '[Verse]\nI walk alone tonight\nUnder the silver light\n[Chorus]\nYou are my midnight echo\nCalling me home',
}, 'both');
const mdir = projectDir(music.id);
await ffmpeg(['-f', 'lavfi', '-i', 'sine=f=330:d=150', '-af', "volume='if(between(t,20,35)+between(t,70,85)+between(t,120,135),1,0.12)':eval=frame", '-ac', '2', 'input-audio.mp3'], { cwd: mdir });
await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=800x800', '-frames:v', '1', 'input-cover.png'], { cwd: mdir });
music.inputs.audioFile = 'input-audio.mp3';
music.inputs.coverFile = 'input-cover.png';

// --- Overtone: fon videosi + qo'lda kiritilgan tarjima, karaoke o'chirilgan holat ham sinaladi ---
const music2 = createProject('overtone', { songTitle: 'Loop Test', lyrics: '[00:02.00] Habibi\n[00:06.00] Ya nour el ain', lyricsLanguage: 'Arabic' }, 'both');
const m2dir = projectDir(music2.id);
await ffmpeg(['-f', 'lavfi', '-i', 'sine=f=440:d=30', '-ac', '2', 'input-audio.mp3'], { cwd: m2dir });
await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=3', '-c:v', 'libx264', '-preset', 'ultrafast', 'input-bgvideo.mp4'], { cwd: m2dir });
music2.inputs.audioFile = 'input-audio.mp3';
music2.inputs.bgvideoFile = 'input-bgvideo.mp4';
music2.content.translation = { key: null, lines: ['My love', 'Light of my eyes'] };
music2.content.translationManual = true;

// --- FIGHTDOMAIN: 12 s gorizontal lavha, ovozli ---
const fight = createProject('fightdomain', {
  fighters: 'Fighter A vs Fighter B',
  event: 'Test Night',
  notes: 'Watch the jab. He feints low, then lands the right hand over the top. That is timing, not power. What would you do here?',
}, 'short');
const fdir = projectDir(fight.id);
await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=12', '-f', 'lavfi', '-i', 'sine=f=200:d=12', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'input-clip.mp4'], { cwd: fdir });
fight.inputs.clipFile = 'input-clip.mp4';

// --- Gorizontal (uzun) format, ovozsiz lavha ---
const fightLong = createProject('fightdomain', { fighters: 'C vs D', notes: 'Short note.' }, 'long');
const ldir = projectDir(fightLong.id);
await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:d=6', '-c:v', 'libx264', '-preset', 'ultrafast', 'input-clip.mp4'], { cwd: ldir });
fightLong.inputs.clipFile = 'input-clip.mp4';
save();

const t0 = Date.now();
enqueue(music.id);
enqueue(music2.id);
enqueue(fight.id);
enqueue(fightLong.id);
await waitDone([music.id, music2.id, fight.id, fightLong.id]);

for (const p of [music, music2, fight, fightLong]) {
  if (p.status !== 'review') {
    console.error(p.log.map((l) => l.msg).join('\n'));
    throw new Error(`${p.channelId} loyihasi tugamadi: ${p.error}`);
  }
}

const long = await probe(path.join(mdir, 'video-long.mp4'));
assert.equal(long.width, 1920);
assert.equal(long.height, 1080);
assert.ok(Math.abs(long.duration - 150) < 1, `uzun video ~150 s: ${long.duration}`);
assert.equal(music.analysis.shorts.length, 3, 'bitta qo‘shiqdan 3 ta Shorts');
for (const [i, sh] of music.analysis.shorts.entries()) {
  const file = path.join(mdir, `video-short${i ? i + 1 : ''}.mp4`);
  const info = await probe(file);
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1920);
  assert.ok(Math.abs(info.duration - 40) < 1, `Shorts ~40 s: ${info.duration}`);
  assert.ok([20, 70, 120].some((loud) => sh.start <= loud + 15 && sh.start + 40 >= loud), `Shorts ${i + 1} baland qismni qamrashi kerak: ${sh.start}`);
}
assert.ok(fs.existsSync(path.join(mdir, 'thumbnail-long.png')));
assert.equal(music.outputs.length, 4);
assert.ok(music.outputs.every((o) => o.title && o.description && o.tags.length));
assert.equal(new Set(music.outputs.filter((o) => o.kind === 'short').map((o) => o.title)).size, 3, 'har Shorts o‘z sarlavhasiga ega');
assert.ok(fs.readFileSync(path.join(mdir, 'long.ass'), 'utf8').includes('\\kf'), 'karaoke teglari bo‘lishi kerak');
const m2ass = fs.readFileSync(path.join(m2dir, 'long.ass'), 'utf8');
assert.ok(m2ass.includes('Light of my eyes'), 'tarjima qatori chiqishi kerak');
const m2long = await probe(path.join(m2dir, 'video-long.mp4'));
assert.equal(m2long.width, 1920);
assert.ok(Math.abs(m2long.duration - 30) < 1);

const fv = await probe(path.join(fdir, 'video.mp4'));
assert.equal(fv.width, 1080);
assert.equal(fv.height, 1920);
assert.ok(fv.hasAudio);
assert.ok(fs.existsSync(path.join(fdir, 'thumbnail.png')));
assert.equal(fight.content.narration.length > 0, true);

const lv = await probe(path.join(ldir, 'video.mp4'));
assert.equal(lv.width, 1920);
assert.equal(lv.height, 1080);
assert.ok(lv.hasAudio, 'ovozsiz lavhaga jim audio qo‘shilishi kerak');

// --- Telegram: /start bog'landi, tayyor videolar haqida rasm+tugmalar yuborildi, tugma bilan tasdiqlash ---
assert.equal(db().settings.telegramChatId, '42', 'birinchi /start chatni bog‘lashi kerak');
assert.ok(tg.calls.filter((c) => c.method === 'sendPhoto').length >= 4, 'har tayyor loyiha uchun prevyu yuborilishi kerak');
tg.queue.push({ update_id: 2, callback_query: { id: 'q1', data: `approve:${fight.id}`, message: { chat: { id: 42 } } } });
tg.queue.push({ update_id: 3, callback_query: { id: 'q2', data: `approve:${fightLong.id}`, message: { chat: { id: 999 } } } });
for (let i = 0; i < 40 && fight.status !== 'approved'; i++) await new Promise((r) => setTimeout(r, 100));
assert.equal(fight.status, 'approved', 'Telegram tugmasi loyihani tasdiqlashi kerak');
await new Promise((r) => setTimeout(r, 400));
assert.equal(fightLong.status, 'review', 'begona chatdan kelgan buyruq bajarilmasligi kerak');
assert.ok(tg.calls.some((c) => c.method === 'sendMessage' && c.body.includes('jadvalga')));

// --- Lavha topish: 60 s video, 15-25 va 40-48 s oralig'ida harakat va shovqin ---
const { createSource, analyzeSource, getSource, sourceDir, candidateToProject } = await import('../src/highlights.js');
const src = createSource({ name: 'full-fight.mp4', fighters: 'A vs B', clipLength: 10, count: 2 });
await ffmpeg([
  '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=60:r=25',
  '-f', 'lavfi', '-i', 'color=c=white:s=60x60:r=25',
  '-f', 'lavfi', '-i', 'sine=f=300:d=60',
  '-filter_complex', "[0][1]overlay=x='mod(t*500,580)':y='150+100*sin(t*9)':enable='between(t,15,25)+between(t,40,48)':shortest=1[v];[2]volume='if(between(t,15,25)+between(t,40,48),1,0.05)':eval=frame[a]",
  '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'source.mp4',
], { cwd: sourceDir(src.id) });
src.file = 'source.mp4';
analyzeSource(src.id);
for (let i = 0; i < 240 && !['ready', 'failed'].includes(getSource(src.id).status); i++) await new Promise((r) => setTimeout(r, 500));
assert.equal(getSource(src.id).status, 'ready', getSource(src.id).error || 'tahlil tugamadi');
const cands = getSource(src.id).candidates;
assert.equal(cands.length, 2);
for (const zone of [[15, 25], [40, 48]]) {
  assert.ok(cands.some((c) => c.start < zone[1] && c.end > zone[0]), `qizg‘in qism topilishi kerak: ${zone} -> ${JSON.stringify(cands.map((c) => [c.start, c.end]))}`);
}
const fromCand = await candidateToProject(src.id, cands[0].id, { format: 'short' });
await waitDone([fromCand.id]);
assert.equal(fromCand.status, 'review', fromCand.error);
assert.ok(fs.existsSync(path.join(projectDir(fromCand.id), 'video.mp4')));
assert.ok(!fromCand.content.narration, 'lavha konteksti diktor matniga aylanmasligi kerak');

// --- Kanal tashxisi: qoidalar sabablarni topishi, AI'ga prevyu rasmi yuborilishi ---
const { runDiagnosis, aiChannelAdvice, aiVideoDiagnosis, buildDiagnosis } = await import('../src/diagnose.js');
const overtone = db().channels.find((c) => c.id === 'overtone');
db().settings.youtubeApiKey = 'TESTKEY';
const diag = await runDiagnosis(overtone);
const byId = Object.fromEntries(diag.videos.map((v) => [v.id, v]));
const codes = (id) => byId[id].issues.map((i) => i.code);
assert.equal(diag.source, 'apikey');
assert.equal(byId.v1.verdict, 'hit', `v1 uchgan bo‘lishi kerak: ${byId.v1.perf}`);
assert.equal(byId.v4.verdict, 'flop');
assert.equal(byId.v8.verdict, 'new');
assert.equal(byId.v4.isShort, false, 'gorizontal 50 s video Shorts emas');
for (const c of ['REGION_BLOCKED', 'HORIZONTAL_SHORT', 'TITLE_HASHTAGS', 'DESC_SHORT']) assert.ok(codes('v4').includes(c), `v4 da ${c} bo‘lishi kerak: ${codes('v4')}`);
for (const c of ['MADE_FOR_KIDS', 'TITLE_LANGUAGE']) assert.ok(codes('v5').includes(c), `v5 da ${c} bo‘lishi kerak: ${codes('v5')}`);
assert.ok(!codes('v1').some((c) => ['REGION_BLOCKED', 'HORIZONTAL_SHORT', 'MADE_FOR_KIDS'].includes(c)), 'yaxshi videoda soxta muammo bo‘lmasin');
assert.ok(diag.channelIssues.some((i) => i.code === 'CHANNEL_DESC'));
assert.ok(diag.score >= 0 && diag.score <= 100);
// Analytics bilan: past tomosha foizi sabab sifatida chiqishi kerak
const withAnalytics = buildDiagnosis(overtone, { source: 'oauth', channel: diag.channel, videos: fakeVideosAsSnapshot(diag) }, { v2: { avgPercent: 42, avgDuration: 10, subscribers: 0, shares: 0 } });
assert.ok(withAnalytics.videos.find((v) => v.id === 'v2').issues.some((i) => i.code === 'LOW_RETENTION_SHORT'));
// AI qismi
db().settings.textProvider = 'anthropic';
db().settings.anthropicKey = 'TEST';
await runDiagnosis(overtone);
const advice = await aiChannelAdvice(overtone);
assert.equal(advice.summary, 'Kanal yangi');
const vdiag = await aiVideoDiagnosis(overtone, 'v4');
assert.deepEqual(vdiag.betterTitles, ['Brutal Knockout Breakdown']);
const lastReq = llmRequests.at(-1);
assert.ok(Array.isArray(lastReq.messages[0].content) && lastReq.messages[0].content[0].type === 'image', 'prevyu rasmi AI’ga yuborilishi kerak');
assert.equal(lastReq.messages[0].content[0].source.media_type, 'image/jpeg');
await runDiagnosis(overtone);
assert.ok(db().diagnoses.overtone.ai && db().diagnoses.overtone.videoAi.v4, 'qayta tahlilda AI natijalari saqlanib qolishi kerak');
db().settings.textProvider = 'anthropic';
db().settings.anthropicKey = '';

tg.queue.push({ update_id: 50, message: { chat: { id: 42 }, text: '/tashxis' } });
for (let i = 0; i < 50 && !tg.calls.some((c) => c.method === 'sendMessage' && c.body.includes('Uchmagan videolar')); i++) await new Promise((r) => setTimeout(r, 100));
assert.ok(tg.calls.some((c) => c.method === 'sendMessage' && c.body.includes('Uchmagan videolar')), 'Telegram /tashxis xulosa yuborishi kerak');

// --- Raqobatchilar: qo'shish, statistik qoliplar, AI tahlil, g'oyalar, ssenariy ---
const competitors = await import('../src/competitors.js');
const compAdded = await competitors.addCompetitor({ input: 'https://www.youtube.com/@PeleExplainss', targetIds: ['overtone', 'nope'] });
assert.equal(compAdded.videos.length, fakeVideos.length);
assert.deepEqual(compAdded.targetIds, ['overtone'], 'mavjud bo‘lmagan maqsad olib tashlanishi kerak');
assert.equal(compAdded.stats.topIds[0], 'v1', 'eng ko‘p ko‘rilgan video birinchi outlier bo‘lishi kerak');
assert.ok(compAdded.stats.openers.some((o) => o.opener === 'full song'), 'takroriy boshlanish topilishi kerak');
await assert.rejects(() => competitors.addCompetitor({ input: '@PeleExplainss' }), /allaqachon/);
db().settings.anthropicKey = 'TEST';
const compAi = await competitors.analyzeCompetitor(compAdded.id);
assert.equal(compAi.formula, 'Savol + personaj');
assert.ok(llmRequests.at(-1).messages[0].content.filter((c) => c.type === 'image').length >= 1, 'raqobatchi prevyulari AI’ga yuborilishi kerak');
const planned = competitors.savePlannedChannel({ name: 'Brainy Bean', niche: 'body facts like Pele Explains', format: 'explainer' });
const ideas = await competitors.generateIdeas({ targetId: planned.id, competitorIds: [compAdded.id], count: 3 });
assert.equal(ideas.length, 3);
assert.ok(llmRequests.at(-1).messages[0].content.includes('Savol + personaj'), 'g‘oyalar so‘rovida raqobatchi formulasi bo‘lishi kerak');
const scripted = await competitors.writeScript(ideas[0].id);
assert.equal(scripted.script.sections.length, 2);
assert.equal(scripted.status, 'saved');
const songIdeas = await competitors.generateIdeas({ targetId: 'overtone', competitorIds: [compAdded.id], count: 3 });
const song = await competitors.writeScript(songIdeas[0].id);
assert.ok(song.script.lyrics.includes('[Chorus]'), 'musiqa kanali uchun qo‘shiq matni yozilishi kerak');
db().settings.anthropicKey = '';

// --- Tushuntiruvchi kanal: personaj + g'oya -> to'liq video; kesh va tahrir faqat kerakli qismni qayta qiladi ---
const { createChannel } = await import('../src/routes.js');
const { channelDir } = await import('../src/workflows/explainer.js');
const brainy = createChannel({ name: 'Brainy Bean', type: 'explainer', niche: 'body facts' });
fs.copyFileSync(path.join(TMP, 'fake-character.png'), path.join(channelDir(brainy.id), 'character.png'));
brainy.characterFile = 'character.png';
brainy.captionsLong = true;
Object.assign(db().settings, { textProvider: 'anthropic', anthropicKey: 'TEST', openaiKey: 'TEST', imageProvider: 'openai', ttsProvider: 'openai' });
const ex = createProject(brainy.id, { idea: 'Why do we yawn?', targetMinutes: '1' }, 'long');
enqueue(ex.id);
await waitDone([ex.id]);
assert.equal(ex.status, 'review', ex.error || ex.log.map((l) => l.msg).join('\n'));
assert.equal(ex.content.script.scenes.length, 4);
assert.equal(brainy.character.description, 'A round yellow mascot with black glasses and thick outlines.');
assert.equal(openaiCalls.filter((c) => c === 'image').length, 5, '4 sahna + 1 prevyu rasmi');
assert.equal(openaiCalls.filter((c) => c === 'tts').length, 4);
assert.equal(openaiCalls.filter((c) => c === 'words').length, 4, 'subtitr uchun har sahna so‘z vaqtlari');
assert.ok(ex.content.script.scenes.every((x) => x.words?.length === 6));
const exv = await probe(path.join(projectDir(ex.id), 'video.mp4'));
assert.equal(exv.width, 1920);
assert.equal(exv.height, 1080);
assert.ok(exv.hasAudio);
assert.ok(Math.abs(exv.duration - ex.content.script.scenes.reduce((sum, x) => sum + x.duration, 0)) < 0.5, `davomiylik sahnalar yig‘indisiga teng: ${exv.duration}`);
assert.ok(ex.outputs[0].title === 'Why You Yawn' && ex.outputs[0].thumbnail === 'thumbnail.png');
const callsBefore = openaiCalls.length;
const llmBefore = llmRequests.length;
ex.content.script.scenes[1].narration = 'Scene 2 now says something different.';
enqueue(ex.id);
await waitDone([ex.id]);
assert.equal(ex.status, 'review', ex.error);
assert.deepEqual(openaiCalls.slice(callsBefore), ['tts', 'words'], 'faqat tahrirlangan sahnaning ovozi qayta yaratilishi kerak');
assert.equal(llmRequests.length, llmBefore, 'qayta montajda AI matn chaqirilmasligi kerak');
// Brauzer orqali sahna o'chirish: qolgan sahnalar ovozi/rasmi keshdan, eski fayllar tozalanadi
const { handle } = await import('../src/routes.js');
const appServer = http.createServer(handle);
await new Promise((r) => appServer.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${appServer.address().port}`;
const kept = ex.content.script.scenes.slice(1).map((x, i) => ({ from: i + 1, narration: x.narration, visual: x.visual }));
const putRes = await fetch(`${appUrl}/api/projects/${ex.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: { scenes: [...kept, { from: null, narration: 'A brand new closing line.', visual: '' }] } }) });
assert.equal(putRes.status, 200);
assert.equal(ex.content.script.scenes.length, 4);
assert.ok(ex.content.script.scenes[3].visual.includes('brand new closing line'), 'bo‘sh rasm tavsifi matndan to‘ldiriladi');
const callsBefore2 = openaiCalls.length;
enqueue(ex.id);
await waitDone([ex.id]);
assert.equal(ex.status, 'review', ex.error);
assert.deepEqual(openaiCalls.slice(callsBefore2).sort(), ['image', 'tts', 'words'], 'faqat yangi sahna uchun ovoz va rasm');
const exFiles = fs.readdirSync(projectDir(ex.id));
assert.equal(exFiles.filter((f) => /^scene-.*\.png$/.test(f)).length, 4, 'eski sahna rasmlari tozalanadi');
assert.equal(exFiles.filter((f) => /^voice-.*\.mp3$/.test(f)).length, 4);
appServer.close();
// Kalitsiz Shorts: o'z ssenariysi, rasm o'rniga personaj, ovozsiz — baribir video chiqadi
Object.assign(db().settings, { anthropicKey: '', openaiKey: '' });
const exShort = createProject(brainy.id, { idea: 'Hiccups', ownScript: 'Why do we hiccup? Your diaphragm spasms. Then your vocal cords snap shut. That makes the hic sound. Drink water slowly to stop it.' }, 'short');
enqueue(exShort.id);
await waitDone([exShort.id]);
assert.equal(exShort.status, 'review', exShort.error || exShort.log.map((l) => l.msg).join('\n'));
const exs = await probe(path.join(projectDir(exShort.id), 'video.mp4'));
assert.equal(exs.width, 1080);
assert.equal(exs.height, 1920);
assert.ok(exShort.content.script.scenes.length >= 2);
assert.ok(exShort.log.some((l) => / ta effekt/.test(l.msg)), 'kalitsiz ham ichki effektlar qo‘shiladi');
assert.ok(fs.existsSync(path.join(TMP, 'sfx', 'builtin-whoosh-swoosh-swish-fast-move-transition.wav')));

// Tayyor materiallar (ChatGPT rasmlari + AI Studio ovozi): personajsiz kanal, 3 rasm + 1 umumiy ovoz + matn
const onion = createChannel({ name: 'Onion Lab', type: 'explainer' });
await ffmpeg(['-f', 'lavfi', '-i', 'sine=f=440:d=3', '-ac', '2', path.join(channelDir(onion.id), 'music-calm.mp3')]);
Object.assign(db().settings, { anthropicKey: 'TEST', textProvider: 'anthropic', openaiKey: '', elevenKey: 'TEST' });
const imp = createProject(onion.id, { idea: 'Why onions make you cry', ownScript: 'Why do onions make you cry?\nCutting releases a chemical gas.\nWash it out with cold water.' }, 'short');
const impDir = projectDir(imp.id);
const imgs = [1, 2, 3].map((i) => {
  const n = `import-img-00${i}.png`;
  fs.copyFileSync(path.join(TMP, 'fake-scene.png'), path.join(impDir, n));
  return n;
});
await ffmpeg(['-f', 'lavfi', '-i', 'sine=f=200:d=6', '-ac', '1', path.join(impDir, 'import-voice-001.mp3')]);
Object.assign(imp.inputs, { importImages: imgs, importVoices: ['import-voice-001.mp3'] });
const callsImp = openaiCalls.length;
enqueue(imp.id);
await waitDone([imp.id]);
assert.equal(imp.status, 'review', imp.error || imp.log.map((l) => l.msg).join('\n'));
assert.equal(imp.content.script.scenes.length, 3);
assert.deepEqual(imp.content.script.scenes.map((x) => x.label), ['Onion vs you', 'Chemical attack', 'Wash it out']);
assert.ok(imp.content.script.scenes.every((x) => x.imageManual));
assert.deepEqual(openaiCalls.slice(callsImp), ['sfx'], 'rasm va ovoz yaratilmaydi; kutubxonada yo‘q effekt ElevenLabs bilan yaratiladi');
const impv = await probe(path.join(impDir, 'video.mp4'));
assert.ok(Math.abs(impv.duration - 6) < 0.3, `video umumiy ovoz uzunligida: ${impv.duration}`);
assert.equal(impv.height, 1920);
assert.equal(imp.outputs[0].title, 'Onion Tears');
assert.ok(imp.log.some((l) => /fon musiqasi/.test(l.msg)), 'kanal musiqasi avtomatik qo‘shiladi');
const impAss = fs.readFileSync(path.join(impDir, 'captions.ass'), 'utf8');
assert.ok(impAss.includes('ONION VS YOU'), 'sahna yorlig‘i');
assert.ok(/\\c&H0000D4FF&\}CHEMICAL/.test(impAss), 'kalit so‘z sariq va katta harfda');
assert.ok(fs.readdirSync(path.join(TMP, 'sfx')).some((f) => f.startsWith('gen-sizzle')), 'yaratilgan effekt kutubxonaga saqlanadi');

// Google AI Studio (Gemini) ovozi
Object.assign(db().settings, { anthropicKey: '', elevenKey: '', geminiKey: 'TEST', ttsProvider: 'gemini' });
const gem = createProject(brainy.id, { idea: 'Gemini voice', ownScript: 'One short line here. Then a second line.' }, 'short');
const callsGem = openaiCalls.length;
enqueue(gem.id);
await waitDone([gem.id]);
assert.equal(gem.status, 'review', gem.error || gem.log.map((l) => l.msg).join('\n'));
assert.ok(openaiCalls.slice(callsGem).filter((c) => c === 'gemini-tts').length >= 1);
assert.ok((await probe(path.join(projectDir(gem.id), 'video.mp4'))).hasAudio);
// Google OAuth kaliti haqiqatan tekshiriladi; Google xatolari oddiy tilga o'giriladi
const { verifyKey } = await import('../src/keys.js');
const { friendlyGoogleError } = await import('../src/routes.js');
Object.assign(db().settings, { googleClientId: 'bad.apps.googleusercontent.com', googleClientSecret: 'x' });
assert.equal((await verifyKey('google')).ok, false);
Object.assign(db().settings, { googleClientId: 'good.apps.googleusercontent.com', googleClientSecret: 'x' });
assert.equal((await verifyKey('google')).ok, true);
assert.match(friendlyGoogleError('access_denied'), /Publish app/);
assert.match(friendlyGoogleError('YouTube API: YouTube Data API v3 has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=123 then retry.'), /Enable.*project=123/);

// Gemini modeli yopilgan bo'lsa ("no longer available to new users") — tavsiya qilingan modelga o'zi o'tadi
const { generateJson } = await import('../src/ai/llm.js');
Object.assign(db().settings, { textProvider: 'gemini', geminiModel: 'gemini-2.5-flash' });
assert.deepEqual(await generateJson({ system: 's', prompt: 'p', maxTokens: 100 }), { ok: true });
assert.equal(db().settings.geminiModel, 'gemini-3.8-flash');
// Server band (503) bo'lsa — kutib qayta urinadi
db().settings.geminiModel = 'gemini-flaky';
assert.deepEqual(await generateJson({ system: 's', prompt: 'p', maxTokens: 100 }), { ok: true });
assert.equal(geminiBusy.count, 2, 'ikki marta band, uchinchisida javob');
Object.assign(db().settings, { geminiKey: '', ttsProvider: 'openai', textProvider: 'anthropic' });

function fakeVideosAsSnapshot(d) {
  return d.videos.map((v) => {
    const copy = { ...v };
    for (const k of ['issues', 'perf', 'verdict', 'likeRate', 'ageDays', 'analytics']) delete copy[k];
    return copy;
  });
}

// --- Jadval: uzun video va Shorts turli kunlarga tushadi ---
approve(music);
const days = music.outputs.map((o) => new Date(o.publishAt).toDateString());
assert.equal(new Set(days).size, music.outputs.length, 'bir kunga ikki video qo‘yilmasligi kerak');
const next = nextSlots(db().channels[0], 1)[0];
assert.ok(!days.includes(next.toDateString()), 'keyingi bo‘sh slot band kunga tushmasligi kerak');
assert.ok(music.outputs.every((o) => o.upload.status === 'scheduled'));

const summary = monthSummary();
assert.equal(summary.fixed, 0, 'yangi o‘rnatishda shaxsiy obunalar yo‘q');
assert.equal(summary.videos, 13);

console.log(`✅ Barcha tekshiruvlar o‘tdi (${((Date.now() - t0) / 1000).toFixed(1)} s montaj).`);
// KEEP=1 npm test — natijalarni test/.tmp ichida ko'rish uchun saqlab qoladi
if (!process.env.KEEP) fs.rmSync(TMP, { recursive: true, force: true });
process.exit(0);
