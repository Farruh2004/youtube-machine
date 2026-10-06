// Tushuntiruvchi kanal (Pele Explains uslubi): personaj + g'oya -> ssenariy -> sahnalar ovozi ->
// personaj bilan sahna rasmlari -> montaj (yengil harakat, yorliq, subtitr, effektlar, musiqa) -> prevyu -> SEO.
// Tayyor materiallar rejimi: o'zingiz yasagan rasmlar va ovozlarni yuklasangiz, dastur faqat yig'ib beradi.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config.js';
import { save } from '../store.js';
import { ffmpeg, probe } from '../media/ffmpeg.js';
import { buildAss, style, escapeText, assColor } from '../media/ass.js';
import { generateJson, textProviderReady } from '../ai/llm.js';
import { synthesize, ttsReady, speechReady, transcribeWords } from '../ai/speech.js';
import { generateSceneImage, imageProviderReady } from '../ai/images.js';
import { characterPrompt, explainerScriptPrompt, annotateScenesPrompt } from '../ai/prompts.js';
import { ensureBuiltinSfx, resolveSfx, sfxVocabulary, pickMusic } from '../media/sfx.js';
import { applyMeta, buildDescription, cleanTitle, limitTags, upsertOutput } from './common.js';

export const STEPS = [
  { key: 'prepare', label: 'Personajni tayyorlash' },
  { key: 'script', label: 'Ssenariy va sahnalar' },
  { key: 'seo', label: 'SEO: sarlavha, tavsif, teglar' },
  { key: 'voice', label: 'Diktor ovozi (har sahna)' },
  { key: 'images', label: 'Sahna rasmlari (personaj bilan)' },
  { key: 'thumbnail', label: 'Prevyu (thumbnail)' },
  { key: 'render', label: 'Montaj' },
];

const isShort = (p) => p.format === 'short';
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
const WORDS_PER_SEC = 2.5;
const DEFAULT_VOICE_STYLE = 'Friendly, curious, upbeat explainer narrator. Clear, natural, conversational pacing with tiny pauses for jokes.';
// Sahna yorliqlari uchun navbatma-navbat ranglar (qizil, ko'k, to'q sariq, binafsha, moviy, yashil...)
const LABEL_COLORS = ['#e53935', '#1e88e5', '#fb8c00', '#8e24aa', '#00acc1', '#43a047', '#f4511e', '#3949ab'];

export function channelDir(channelId) {
  const dir = path.join(DATA_DIR, 'channels', channelId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const defaultVisual = (narration) => (narration ? `The character illustrating this line: "${narration}"` : '');

/** AI yoki foydalanuvchidan kelgan sahnani bir xil ko'rinishga keltiradi. */
export function normalizeScene(x = {}) {
  const narration = String(x.narration || '').trim();
  const hl = Array.isArray(x.highlight) ? x.highlight : String(x.highlight || '').split(',');
  return {
    narration,
    visual: String(x.visual || '').trim() || defaultVisual(narration),
    label: String(x.label || '').trim().slice(0, 40),
    highlight: hl.map((s) => String(s).trim()).filter(Boolean).slice(0, 4),
    sfx: String(x.sfx || '').trim().slice(0, 60),
    voiceStyle: String(x.voiceStyle || '').trim().slice(0, 200),
  };
}

/** Diktor matnini sahnalarga bo'ladi (o'z ssenariyingiz berilganda). */
export function splitIntoScenes(text, sceneSeconds = 7) {
  const sentences = String(text).replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*\s*/g) || [];
  const target = Math.max(6, Math.round(sceneSeconds * WORDS_PER_SEC));
  const scenes = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).split(' ').length > target) {
      scenes.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) scenes.push(cur.trim());
  return scenes.map((narration) => normalizeScene({ narration }));
}

/** Matnni aynan `n` bo'lakka bo'ladi (imkon qadar gap/vergul chegarasida) — tayyor rasmlar soniga moslash uchun. */
export function distributeText(text, n) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= n) return Array.from({ length: n }, (_, i) => words[i] || '');
  const out = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n) {
      out.push(words.slice(start).join(' '));
      break;
    }
    const target = Math.round((words.length * i) / n);
    let cut = target;
    search: for (let d = 0; d <= 3; d++) {
      for (const t of [target + d, target - d]) {
        if (t > start && t < words.length && /[.!?,;:]$/.test(words[t - 1])) {
          cut = t;
          break search;
        }
      }
    }
    cut = Math.max(start + 1, Math.min(cut, words.length - (n - i)));
    out.push(words.slice(start, cut).join(' '));
    start = cut;
  }
  return out;
}

/** Endi hech bir sahnaga tegishli bo'lmagan eski ovoz/rasm fayllarini o'chiradi. */
function removeStale(dir, prefix, ext, keep) {
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(prefix) && f.endsWith(ext) && !keep.includes(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
}

const fileKey = (dir, name) => {
  const st = fs.statSync(path.join(dir, name));
  return hash(`${name}|${st.size}|${st.mtimeMs}`);
};

const wantCaptions = (project, channel) => (isShort(project) ? channel.captionsShort !== false : Boolean(channel.captionsLong));

/** Tayyor rasmlar/ovozlardan sahnalar tuzadi (rasm va ovoz fayl nomi tartibida). */
async function importScenes(ctx) {
  const { project, channel, dir } = ctx;
  const c = project.content;
  const imgs = project.inputs.importImages || [];
  const voices = project.inputs.importVoices || [];
  const single = voices.length === 1;
  const sceneSeconds = Number(channel.sceneSeconds) || 7;
  let n = Math.max(imgs.length, single ? 0 : voices.length);
  const own = project.inputs.ownScript?.trim();
  let texts = [];
  const perVoiceWords = [];
  c.fullVoice = single ? voices[0] : null;
  if (own) {
    const lines = own.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!n) texts = splitIntoScenes(own, sceneSeconds).map((x) => x.narration);
    else texts = lines.length === n ? lines : distributeText(own, n);
  } else if (voices.length && speechReady()) {
    // Matn berilmagan — ovozdan eshitib olamiz (Whisper), so'z vaqtlari subtitr uchun ham kerak
    if (single) {
      const dur = (await probe(path.join(dir, voices[0]))).duration;
      const r = await transcribeWords(path.join(dir, voices[0]), dur, { cost: ctx.costMeta });
      c.fullVoiceWords = r.words;
      c.fullVoiceWordsKey = fileKey(dir, voices[0]);
      texts = n ? distributeText(r.text, n) : splitIntoScenes(r.text, sceneSeconds).map((x) => x.narration);
    } else {
      for (const v of voices) {
        const dur = (await probe(path.join(dir, v))).duration;
        const r = await transcribeWords(path.join(dir, v), dur, { cost: ctx.costMeta });
        texts.push(r.text);
        perVoiceWords.push(r.words);
      }
    }
    ctx.log('Ovoz fayllaridan matn eshitib olindi (Whisper).');
  } else if (!voices.length) {
    throw new Error('Tayyor rasmlar uchun diktor matnini “O‘z ssenariyingiz” maydoniga yozing (har qatorga bitta sahna) yoki ovoz fayllarini ham yuklang.');
  } else {
    ctx.log('Matn yo‘q va OpenAI kaliti yo‘q — subtitrsiz yig‘iladi. Subtitr uchun “O‘z ssenariyingiz”ga matnni yozing.');
    texts = Array.from({ length: n || 1 }, () => '');
  }
  if (!n) n = texts.length;
  const scenes = Array.from({ length: n }, (_, i) => {
    const sc = normalizeScene({ narration: texts[i] || '' });
    if (imgs[i]) Object.assign(sc, { imageFile: imgs[i], imageManual: true });
    if (!single && voices[i]) {
      Object.assign(sc, { voiceFile: voices[i], voiceManual: true });
      if (perVoiceWords[i]) Object.assign(sc, { words: perVoiceWords[i], wordsKey: fileKey(dir, voices[i]) });
    }
    return sc;
  });
  c.script = { title: project.inputs.idea || project.title, scenes, description: '', tags: [], thumbnailText: '', thumbnailConcept: '', needsAnnotation: true };
  ctx.log(`Tayyor materiallar: ${imgs.length} ta rasm, ${voices.length} ta ovoz → ${n} ta sahna.`);
}

/** Bitta umumiy ovoz faylini sahnalarga taqsimlaydi: so'z vaqtlari bo'lsa — aniq, bo'lmasa — matn uzunligiga qarab. */
async function splitFullVoice(ctx) {
  const { project, dir } = ctx;
  const c = project.content;
  const scenes = c.script.scenes;
  const total = (await probe(path.join(dir, c.fullVoice))).duration;
  const key = fileKey(dir, c.fullVoice);
  if (speechReady() && wantCaptions(project, ctx.channel) && c.fullVoiceWordsKey !== key) {
    const r = await transcribeWords(path.join(dir, c.fullVoice), total, { cost: ctx.costMeta });
    c.fullVoiceWords = r.words;
    c.fullVoiceWordsKey = key;
  }
  const words = c.fullVoiceWordsKey === key ? c.fullVoiceWords || [] : [];
  const counts = scenes.map((sc) => sc.narration.split(/\s+/).filter(Boolean).length);
  const bounds = [0];
  if (words.length && counts.some(Boolean)) {
    let cum = 0;
    for (let i = 0; i < scenes.length - 1; i++) {
      cum += counts[i];
      const w = words[Math.min(words.length - 1, Math.round((cum * words.length) / counts.reduce((a, b) => a + b, 0)))];
      bounds.push(Math.max(bounds[i] + 0.3, Math.min(total - 0.3, w?.start ?? total)));
    }
  } else {
    const weights = scenes.map((sc) => sc.narration.length || 1);
    const sum = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let i = 0; i < scenes.length - 1; i++) bounds.push((acc += (weights[i] / sum) * total));
  }
  bounds.push(total);
  scenes.forEach((sc, i) => {
    sc.voiceFile = null;
    sc.voiceManual = false;
    sc.voiceDuration = bounds[i + 1] - bounds[i];
    sc.words = words.filter((w) => w.start >= bounds[i] - 0.05 && w.start < bounds[i + 1]).map((w) => ({ ...w, start: w.start - bounds[i], end: w.end - bounds[i] }));
  });
  ctx.log(`Umumiy ovoz (${Math.round(total)} s) ${scenes.length} ta sahnaga taqsimlandi${words.length ? ' — so‘z vaqtlari bo‘yicha' : ''}.`);
}

export const run = {
  async prepare(ctx) {
    const { project, channel, dir } = ctx;
    const src = project.inputs.characterFile
      ? path.join(dir, project.inputs.characterFile)
      : channel.characterFile
        ? path.join(channelDir(channel.id), channel.characterFile)
        : null;
    if (!src || !fs.existsSync(src)) {
      // Tayyor rasmlar berilgan bo'lsa, personaj shart emas
      if (project.inputs.importImages?.length) {
        fs.rmSync(path.join(dir, 'character.png'), { force: true });
        project.content.character = null;
        ctx.log('Personaj rasmi yo‘q — tayyor rasmlaringiz ishlatiladi.');
        return;
      }
      throw new Error('Personaj rasmi yo‘q. Kanal sozlamalarida yoki shu videoda personaj rasmini yuklang.');
    }
    // Bir xil formatga keltiramiz (PNG, ko'pi bilan 1024 px) — rasm xizmatlari shuni yaxshi qabul qiladi
    await ffmpeg(['-i', src, '-vf', "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease", '-frames:v', '1', 'character.png'], { cwd: dir });
    const key = hash(fs.readFileSync(path.join(dir, 'character.png')));
    const cached = project.inputs.characterFile ? project.content.character : channel.character;
    if (cached?.key === key) {
      project.content.character = cached;
      ctx.log('Personaj tavsifi keshdan olindi.');
      return;
    }
    let description = 'the mascot character shown in the reference image';
    if (textProviderReady()) {
      try {
        const r = await generateJson({
          ...characterPrompt(),
          images: [{ mediaType: 'image/png', data: fs.readFileSync(path.join(dir, 'character.png')).toString('base64') }],
          maxTokens: 1500,
          cost: ctx.costMeta,
        });
        description = r.description || description;
        ctx.log('AI personajni tavsifladi — har sahnada bir xil chiqishi uchun.');
      } catch (err) {
        ctx.log(`Personaj tavsifi yozilmadi: ${err.message}`);
      }
    }
    project.content.character = { key, description };
    if (!project.inputs.characterFile) {
      channel.character = { key, description };
      save();
    }
  },

  async script(ctx) {
    const { project, channel } = ctx;
    const c = project.content;
    if (c.script?.scenes?.length && !c.regenerate) {
      ctx.log(`Oldingi ssenariy ishlatildi (${c.script.scenes.length} ta sahna).`);
      return;
    }
    const sceneSeconds = Number(channel.sceneSeconds) || 7;
    if (project.inputs.importImages?.length || project.inputs.importVoices?.length) {
      await importScenes(ctx);
    } else if (project.inputs.ownScript?.trim()) {
      const scenes = splitIntoScenes(project.inputs.ownScript, sceneSeconds);
      c.script = { title: project.inputs.idea || project.title, scenes, description: '', tags: [], thumbnailText: '', thumbnailConcept: '', needsAnnotation: true };
      ctx.log(`O‘zingiz yozgan matn ${scenes.length} ta sahnaga bo‘lindi.`);
    } else {
      if (!textProviderReady()) throw new Error('Ssenariy yozish uchun matn AI kaliti kerak (API kalitlar) — yoki “O‘z ssenariyim” maydoniga matn yozing.');
      const seconds = isShort(project) ? Math.min(170, Number(project.inputs.targetSeconds) || 50) : Math.round((Number(project.inputs.targetMinutes) || 4) * 60);
      const r = await generateJson({
        ...explainerScriptPrompt({ channel, project, seconds, sceneSeconds, character: c.character?.description, sfxNames: sfxVocabulary() }),
        maxTokens: 8000,
        cost: ctx.costMeta,
      });
      if (!Array.isArray(r.scenes) || !r.scenes.length) throw new Error('AI ssenariyda sahnalar bermadi — qayta urinib ko‘ring.');
      c.script = { ...r, scenes: r.scenes.map(normalizeScene).filter((x) => x.narration), sfxChosen: true };
      ctx.log(`Ssenariy yozildi: ${c.script.scenes.length} ta sahna.`);
    }
    // O'z matningiz yoki tayyor materiallar: yorliq, effekt va SEO'ni AI qo'shadi (kalit bo'lsa)
    if (c.script.needsAnnotation) {
      delete c.script.needsAnnotation;
      if (textProviderReady() && c.script.scenes.some((x) => x.narration)) {
        try {
          const r = await generateJson({ ...annotateScenesPrompt({ channel, project, scenes: c.script.scenes, sfxNames: sfxVocabulary() }), maxTokens: 4000, cost: ctx.costMeta });
          (r.scenes || []).forEach((x, i) => {
            const sc = c.script.scenes[i];
            if (!sc) return;
            const n = normalizeScene({ ...x, narration: sc.narration });
            Object.assign(sc, { label: n.label, highlight: n.highlight, sfx: n.sfx });
          });
          for (const k of ['title', 'thumbnailText', 'thumbnailConcept', 'description', 'hashtags', 'tags']) if (r[k]) c.script[k] = r[k];
          c.script.sfxChosen = true;
          ctx.log('AI sahnalarga yorliq, effekt va SEO qo‘shdi.');
        } catch (err) {
          ctx.log(`Yorliqlar qo‘shilmadi: ${err.message}`);
        }
      }
    }
    c.thumbnailText ||= c.script.thumbnailText || '';
  },

  async seo(ctx) {
    const { project, channel } = ctx;
    const sc = project.content.script;
    applyMeta(project, 'main', isShort(project) ? 'short' : 'long', {
      title: cleanTitle(sc.title, project.inputs.idea),
      description: buildDescription(channel, sc.description || project.inputs.idea || '', sc.hashtags || []),
      tags: limitTags([...(sc.tags || []), ...(channel.baseTags || [])]),
    });
  },

  async voice(ctx) {
    const { project, channel, settings, dir } = ctx;
    const c = project.content;
    const scenes = c.script.scenes;
    if (c.fullVoice && fs.existsSync(path.join(dir, c.fullVoice))) {
      await splitFullVoice(ctx);
      return;
    }
    const voiceId = settings.ttsProvider === 'elevenlabs' ? `eleven:${settings.elevenVoiceId}` : settings.ttsProvider === 'gemini' ? `gemini:${settings.geminiVoice}` : `openai:${settings.ttsVoice}`;
    const canSpeak = ttsReady();
    const needWords = wantCaptions(project, channel) && speechReady() && channel.captionTiming !== 'estimate';
    if (!canSpeak && !scenes.every((sc) => sc.voiceManual)) ctx.log('Ovoz kaliti yo‘q — sahnalar matn uzunligiga qarab vaqtlanadi, video ovozsiz chiqadi.');
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      let key;
      if (sc.voiceManual && sc.voiceFile && fs.existsSync(path.join(dir, sc.voiceFile))) {
        key = fileKey(dir, sc.voiceFile);
      } else {
        sc.voiceManual = false;
        const instructions = [channel.voiceStyle || c.script.voiceStyle || DEFAULT_VOICE_STYLE, sc.voiceStyle].filter(Boolean).join(' ');
        key = hash(`${voiceId}|${instructions}|${sc.narration}`);
        // Fayl nomi matndan olinadi: sahna o'chirilsa yoki surilsa ham kesh to'g'ri ishlaydi
        const file = `voice-${key}.mp3`;
        if (canSpeak && sc.narration && !(sc.voiceKey === key && fs.existsSync(path.join(dir, file)))) {
          await synthesize(sc.narration, path.join(dir, file), { instructions, cost: ctx.costMeta });
          sc.voiceKey = key;
        }
        sc.voiceFile = canSpeak && sc.narration ? file : null;
      }
      sc.voiceDuration = sc.voiceFile ? (await probe(path.join(dir, sc.voiceFile))).duration : sc.narration.split(/\s+/).filter(Boolean).length / WORDS_PER_SEC;
      // Subtitr so'zlarini ovozga aniq moslash (Whisper, ~$0.006/daqiqa)
      if (needWords && sc.voiceFile && sc.wordsKey !== key) {
        try {
          const r = await transcribeWords(path.join(dir, sc.voiceFile), sc.voiceDuration, { cost: ctx.costMeta });
          sc.words = r.words;
          sc.wordsKey = key;
          if (!sc.narration && r.text) sc.narration = r.text;
        } catch (err) {
          ctx.log(`So‘z vaqtlari olinmadi (${i + 1}-sahna): ${err.message}`);
        }
      }
      if (sc.wordsKey !== key) sc.words = null;
      ctx.progress(Math.round(((i + 1) / scenes.length) * 100));
      save();
    }
    removeStale(dir, 'voice-', '.mp3', scenes.map((x) => x.voiceFile));
    const total = scenes.reduce((s, x) => s + x.voiceDuration, 0);
    ctx.log(`Ovoz: ${scenes.length} ta sahna, jami ~${Math.round(total)} s.`);
    if (isShort(project) && total > 175) ctx.log('Diqqat: Shorts 3 daqiqadan oshmasligi kerak — matnni qisqartiring.');
  },

  async images(ctx) {
    const { project, channel, dir } = ctx;
    const scenes = project.content.script.scenes;
    const orientation = isShort(project) ? 'portrait' : 'landscape';
    const canDraw = imageProviderReady();
    const hasCharacter = fs.existsSync(path.join(dir, 'character.png'));
    if (!canDraw && scenes.some((sc) => !sc.imageManual)) ctx.log('Rasm yaratish kaliti yo‘q — sahnalarda personajning o‘zi ishlatiladi.');
    let made = 0;
    let manual = 0;
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      if (sc.imageManual && sc.imageFile && fs.existsSync(path.join(dir, sc.imageFile))) {
        manual++;
        continue;
      }
      sc.imageManual = false;
      if (!hasCharacter) throw new Error(`${i + 1}-sahnaga rasm yo‘q. Shu sahnaga rasm yuklang yoki kanalga personaj rasmini qo‘shing.`);
      const prompt = scenePrompt({ visual: sc.visual || defaultVisual(sc.narration), character: project.content.character?.description, channel, orientation });
      const key = hash(`${orientation}|${canDraw}|${prompt}`);
      const file = `scene-${key}.png`;
      if (sc.imageKey === key && sc.imageFile === file && fs.existsSync(path.join(dir, file))) continue;
      if (canDraw) {
        await generateSceneImage({ prompt, referenceFiles: [path.join(dir, 'character.png')], orientation, outFile: path.join(dir, file), cost: ctx.costMeta });
      } else {
        await placeholderScene(dir, file, orientation, channel);
      }
      sc.imageKey = key;
      sc.imageFile = file;
      made++;
      ctx.progress(Math.round(((i + 1) / scenes.length) * 100));
      save();
    }
    removeStale(dir, 'scene-', '.png', scenes.map((x) => x.imageFile));
    ctx.log(`${made ? `${made} ta sahna rasmi yaratildi` : 'Yangi rasm kerak bo‘lmadi'}${manual ? `, ${manual} ta — o‘zingiz yuklagan` : ''}.`);
  },

  async thumbnail(ctx) {
    const { project, channel, settings, dir } = ctx;
    const sc = project.content.script;
    const canDraw = imageProviderReady() && fs.existsSync(path.join(dir, 'character.png'));
    const key = canDraw && sc.thumbnailConcept ? hash(`${sc.thumbnailConcept}|ai`) : hash(`scene|${sc.scenes[0].imageFile}`);
    if (!(project.content.thumbKey === key && fs.existsSync(path.join(dir, 'thumb-art.png')))) {
      if (canDraw && sc.thumbnailConcept) {
        const prompt = `${scenePrompt({ visual: `${sc.thumbnailConcept}. Big expressive emotion, very clear silhouette, leave the top 30% empty for a headline.`, character: project.content.character?.description, channel, orientation: 'landscape' })}\nThis is a YouTube thumbnail: maximum clarity at small size.`;
        await generateSceneImage({ prompt, referenceFiles: [path.join(dir, 'character.png')], orientation: 'landscape', outFile: path.join(dir, 'thumb-art.png'), cost: ctx.costMeta });
      } else {
        await ffmpeg(['-i', sc.scenes[0].imageFile, '-frames:v', '1', '-y', 'thumb-art.png'], { cwd: dir });
      }
      project.content.thumbKey = key;
    }
    const text = project.content.thumbnailText || sc.thumbnailText || '';
    fs.writeFileSync(path.join(dir, 'thumb.ass'), buildAss({
      width: 1280,
      height: 720,
      styles: [style({ name: 'Big', font: settings.fontName, size: 92, color: '#111111', outline: '#ffffff', outlineWidth: 7, shadow: 0, align: 8, marginV: 26, marginH: 40 })],
      events: [{ start: 0, end: 10, style: 'Big', text }],
    }));
    await ffmpeg(['-i', 'thumb-art.png', '-vf', `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=${bgColor(channel)},ass=thumb.ass`, '-frames:v', '1', '-y', 'thumbnail.png'], { cwd: dir });
    upsertOutput(project, 'main', { kind: isShort(project) ? 'short' : 'long', thumbnail: 'thumbnail.png' });
    ctx.log('Prevyu tayyor (1280×720).');
  },

  async render(ctx) {
    const { project, channel, settings, dir } = ctx;
    const c = project.content;
    const short = isShort(project);
    const W = short ? 1080 : 1920;
    const H = short ? 1920 : 1080;
    const scenes = c.script.scenes;
    const fullVoice = c.fullVoice && fs.existsSync(path.join(dir, c.fullVoice)) ? c.fullVoice : null;
    // Umumiy ovozda sahnalar orasida pauza yo'q — chegaralar ovozning o'zidan olingan
    const GAP = fullVoice ? 0 : 0.35;
    let t = 0;
    for (const sc of scenes) {
      sc.start = t;
      sc.duration = fullVoice ? Math.max(0.3, sc.voiceDuration) : Math.max(2, sc.voiceDuration + GAP);
      t += sc.duration;
    }
    const total = t;

    // 1) Har sahna: rasm ekranga sig'adi va sekin yaqinlashadi/suriladi (navbat bilan har xil yo'nalish)
    const ZW = Math.round((W * 1.07) / 2) * 2;
    const ZH = Math.round((H * 1.07) / 2) * 2;
    const dx = (ZW - W) / 2;
    const dy = (ZH - H) / 2;
    const list = [];
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const D = sc.duration.toFixed(3);
      const ease = i % 2 ? `(1-t/${D})` : `(t/${D})`;
      const segment = `seg-${i + 1}.mp4`;
      // Nisbat yaqin bo'lsa (masalan 2:3 rasm 9:16 kadrda) — kadrni to'ldiradi (chetlari biroz kesiladi), aks holda fon bilan to'ldiriladi
      const img = await probe(path.join(dir, sc.imageFile));
      const ratio = img.width && img.height ? img.width / img.height / (W / H) : 1;
      const fit = ratio > 0.75 && ratio < 1.33
        ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
        : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bgColor(channel)}`;
      await ffmpeg([
        '-loop', '1', '-framerate', '30', '-t', D, '-i', sc.imageFile,
        '-vf', `${fit},scale=${ZW}:${ZH},crop=${W}:${H}:x='${dx}+${i % 3 === 2 ? 0 : dx}*(${ease}-0.5)':y='${dy}+${dy}*(${ease}-0.5)',setsar=1,format=yuv420p`,
        '-c:v', 'libx264', '-preset', settings.renderPreset, '-crf', '20', '-r', '30', '-an', segment,
      ], { cwd: dir });
      list.push(`file '${segment}'`);
      ctx.progress(Math.round(((i + 1) / scenes.length) * 65));
    }
    fs.writeFileSync(path.join(dir, 'segments.txt'), list.join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-c', 'copy', '-y', 'visual.mp4'], { cwd: dir });

    // 2) Diktor ovozi
    const voiced = scenes.every((sc) => sc.voiceFile && fs.existsSync(path.join(dir, sc.voiceFile)));
    if (fullVoice) {
      await ffmpeg(['-i', fullVoice, '-af', `aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${total.toFixed(3)}`, '-t', total.toFixed(3), '-c:a', 'pcm_s16le', '-y', 'narration.wav'], { cwd: dir });
    } else if (voiced) {
      // har sahna o'z vaqtiga moslab cho'ziladi (oxiriga jimlik) va ketma-ket ulanadi
      const args = [];
      for (const sc of scenes) args.push('-i', sc.voiceFile);
      const graph = scenes.map((sc, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${sc.duration.toFixed(3)}[a${i}]`).join(';') +
        `;${scenes.map((_, i) => `[a${i}]`).join('')}concat=n=${scenes.length}:v=0:a=1[out]`;
      await ffmpeg([...args, '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s16le', '-y', 'narration.wav'], { cwd: dir });
    } else {
      await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', total.toFixed(3), '-y', 'narration.wav'], { cwd: dir });
    }

    // 3) Yorliqlar va subtitrlar
    fs.writeFileSync(path.join(dir, 'captions.ass'), captionsAss({ scenes, channel, settings, short, W, H, total, withCaptions: wantCaptions(project, channel) }));

    // 4) Ovoz effektlari va fon musiqasi
    const inputs = ['-i', 'visual.mp4', '-i', 'narration.wav'];
    const chains = ['[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[nar]'];
    const mix = ['[nar]'];
    let idx = 2;
    const music = project.inputs.musicFile || (channel.musicAuto !== false ? pickMusic(channelDir(channel.id), project.id) : null);
    if (music) {
      inputs.push('-stream_loop', '-1', '-i', music);
      // Musiqa ovoz eshitilganda pasayadi (sidechain), pauzalarda biroz ko'tariladi
      chains[0] = '[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[nar][key]';
      chains.push(`[${idx}:a]volume=${Number(channel.musicVolume ?? 0.15).toFixed(2)},aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[mraw];[mraw][key]sidechaincompress=threshold=0.03:ratio=4:attack=30:release=400[mus]`);
      mix.push('[mus]');
      idx++;
    }
    let sfxCount = 0;
    if (channel.sfx !== false) {
      await ensureBuiltinSfx();
      for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i];
        // AI tanlamagan bo'lsa: birinchi sahnada "pop", qolganlarida sahna almashganda "whoosh"
        const want = c.script.sfxChosen ? sc.sfx : i === 0 ? 'pop' : 'whoosh';
        const file = await resolveSfx(want, { generate: channel.sfxGenerate !== false, cost: ctx.costMeta, log: ctx.log });
        if (!file) continue;
        const ms = Math.round((sc.start + (i ? 0.02 : 0.1)) * 1000);
        inputs.push('-i', file);
        chains.push(`[${idx}:a]volume=${Number(channel.sfxVolume ?? 0.5).toFixed(2)},aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${ms}|${ms}[s${sfxCount}]`);
        mix.push(`[s${sfxCount}]`);
        idx++;
        sfxCount++;
      }
    }
    const fade = `afade=t=out:st=${Math.max(0, total - 1.2).toFixed(2)}:d=1.2`;
    const audio = mix.length > 1
      ? `${chains.join(';')};${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0,${fade}[a]`
      : `${chains[0]};[nar]${fade}[a]`;

    // 5) Yakuniy: tasvir + ovozlar + subtitr
    await ffmpeg([
      ...inputs,
      '-filter_complex', `[0:v]ass=captions.ass,format=yuv420p[v];${audio}`,
      '-map', '[v]', '-map', '[a]', '-t', total.toFixed(3),
      '-c:v', 'libx264', '-preset', settings.renderPreset, '-crf', '21', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      '-y', 'video.mp4',
    ], { cwd: dir, durationSec: total, onProgress: (p) => ctx.progress(65 + Math.round(p * 0.35)) });
    for (const f of fs.readdirSync(dir)) if (/^seg-\d+\.mp4$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    upsertOutput(project, 'main', { kind: short ? 'short' : 'long', file: 'video.mp4', duration: total });
    ctx.log(`Montaj tayyor: ${scenes.length} ta sahna, ${Math.round(total)} s (${short ? '1080×1920 Shorts' : '1920×1080'})${sfxCount ? `, ${sfxCount} ta effekt` : ''}${music ? ', fon musiqasi bilan' : ''}.`);
  },
};

/** Subtitr bo'laklari: 2-3 so'z (Shorts) yoki 5-7 so'z, iloji bo'lsa tinish belgisida uziladi. */
function chunkWords(words, max) {
  const chunks = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(i);
    const punct = /[.!?,;:]$/.test(words[i]);
    if (cur.length >= max || (punct && cur.length >= Math.ceil(max / 2))) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const plain = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export function captionsAss({ scenes, channel, settings, short, W, H, total, withCaptions }) {
  const pill = (channel.captionStyle || 'pill') === 'pill';
  const labels = channel.sceneLabels !== false;
  const events = [];
  scenes.forEach((sc, si) => {
    if (labels && sc.label) {
      const color = LABEL_COLORS[si % LABEL_COLORS.length];
      events.push({ start: sc.start, end: sc.start + sc.duration, style: 'Label', tags: `\\3c${assColor(color)}&`, text: sc.label.toUpperCase() });
    }
    if (!withCaptions || !sc.narration) return;
    const words = sc.narration.split(/\s+/).filter(Boolean);
    const hl = new Set((sc.highlight || []).flatMap((h) => h.split(/\s+/)).map(plain).filter(Boolean));
    const chunks = chunkWords(words, short ? 3 : 6);
    const span = Math.max(0.5, Math.min(sc.voiceDuration || sc.duration, sc.duration));
    // Vaqtlar: Whisper so'zlari bo'lsa — aniq, bo'lmasa — harf soniga qarab
    const wt = Array.isArray(sc.words) && sc.words.length >= words.length * 0.6 ? sc.words : null;
    const totalChars = words.reduce((s, w) => s + w.length + 1, 0) || 1;
    const charStart = [];
    let acc = 0;
    for (const w of words) {
      charStart.push((acc / totalChars) * span);
      acc += w.length + 1;
    }
    const startOf = (i) => (wt ? wt[Math.min(wt.length - 1, Math.round((i * (wt.length - 1)) / Math.max(1, words.length - 1)))].start : charStart[i]);
    chunks.forEach((idxs, k) => {
      const start = sc.start + Math.max(0, startOf(idxs[0]));
      const end = k + 1 < chunks.length ? sc.start + startOf(chunks[k + 1][0]) : sc.start + span + 0.15;
      const text = idxs.map((i) => {
        const w = words[i];
        if (hl.has(plain(w))) return `{\\c${assColor('#ffd400')}&}${escapeText(w.toUpperCase())}{\\c${assColor('#ffffff')}&}`;
        return escapeText(pill || !short ? w : w.toUpperCase());
      }).join(' ');
      events.push({ start, end: Math.max(start + 0.2, end), style: 'Cap', text, raw: true });
    });
  });
  events.push({ start: 0, end: total, style: 'Brand', text: channel.name });
  const font = settings.fontName;
  const styles = [
    pill
      ? style({ name: 'Cap', font, size: short ? 60 : 44, color: '#ffffff', back: '#1d2230', backAlpha: 0, boxed: true, outlineWidth: short ? 14 : 11, align: 2, marginV: short ? 400 : 70, marginH: short ? 90 : 240 })
      : short
        ? style({ name: 'Cap', font, size: 78, color: '#ffffff', outline: '#000000', outlineWidth: 7, shadow: 2, align: 2, marginV: 420, marginH: 70 })
        : style({ name: 'Cap', font, size: 50, color: '#ffffff', back: '#000000', backAlpha: 80, boxed: true, outlineWidth: 10, align: 2, marginV: 50, marginH: 200 }),
    style({ name: 'Label', font, size: short ? 50 : 38, color: '#ffffff', back: LABEL_COLORS[0], backAlpha: 0, boxed: true, outlineWidth: short ? 12 : 9, align: 8, marginV: short ? 150 : 34, marginH: 60 }),
    style({ name: 'Brand', font, size: short ? 28 : 24, color: '#666666', outline: '#ffffff', outlineWidth: 2, bold: false, align: short ? 2 : 9, marginV: short ? 70 : 24, marginH: 30 }),
  ];
  return buildAss({ width: W, height: H, styles, events });
}

function bgColor(channel) {
  return `0x${String(channel.colors?.background || '#ffffff').replace('#', '')}`;
}

export function scenePrompt({ visual, character, channel, orientation }) {
  return [
    'Use the attached character EXACTLY as designed: same face, glasses/accessories, body shape, colors, proportions and outline style. Do not redesign it.',
    character ? `Character reference notes: ${character}` : '',
    `Scene: ${visual}`,
    `Style: ${channel.style || 'simple flat 2D cartoon like a popular faceless explainer channel: thick clean black outlines, flat bright colors, plain white background, minimal props, lots of empty space, expressive pose'}.`,
    'Do not draw captions, subtitles, labels or watermarks — on-screen text is added later in editing. Keep the top 12% and the lower third of the frame free of important details.',
    orientation === 'portrait' ? 'Vertical 9:16 composition: character on one side, the explained object on the other.' : 'Wide 16:9 composition, character clearly visible.',
  ].filter(Boolean).join('\n');
}

async function placeholderScene(dir, file, orientation, channel) {
  const [W, H] = orientation === 'portrait' ? [1024, 1536] : [1536, 1024];
  await ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${bgColor(channel)}:s=${W}x${H}`,
    '-i', 'character.png',
    '-filter_complex', `[1:v]scale=${Math.round(W * 0.5)}:${Math.round(H * 0.6)}:force_original_aspect_ratio=decrease[c];[0:v][c]overlay=(W-w)/2:(H-h)/2`,
    '-frames:v', '1', '-y', file,
  ], { cwd: dir });
}
