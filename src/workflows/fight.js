// FIGHTDOMAIN: jang lavhasi -> inglizcha original tahlil -> ovoz -> subtitr -> vertikal/gorizontal montaj -> prevyu + SEO
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, probe, loudnessCurve } from '../media/ffmpeg.js';
import { motionProfile, findKeyMoment, cropPath, cropCommands } from '../media/motion.js';
import { buildAss, style, assColor } from '../media/ass.js';
import { generateJson, textProviderReady } from '../ai/llm.js';
import { synthesize, ttsReady } from '../ai/speech.js';
import { fightScriptPrompt, fightScriptFallback } from '../ai/prompts.js';
import { applyMeta, buildDescription, cleanTitle, limitTags, upsertOutput } from './common.js';

export const STEPS = [
  { key: 'analyze', label: 'Lavha tahlili va muhim lahzani topish' },
  { key: 'effects', label: 'Tahlil effektlari (to‘xtash, yaqinlashtirish, sekin takror)' },
  { key: 'script', label: 'Inglizcha tahlil matni va SEO' },
  { key: 'voice', label: 'Ovoz (diktor)' },
  { key: 'captions', label: 'Subtitrlar' },
  { key: 'render', label: 'Montaj' },
  { key: 'thumbnail', label: 'Prevyu (thumbnail)' },
];

const isShort = (project) => project.format !== 'long';
const maxLength = (project, channel) => (isShort(project) ? Number(channel.shortsSeconds) || 58 : 600);

export const run = {
  async analyze(ctx) {
    const { project, channel } = ctx;
    if (!project.inputs.clipFile) throw new Error('Jang lavhasi (video fayl) yuklanmagan.');
    const info = await probe(path.join(ctx.dir, project.inputs.clipFile));
    if (!info.hasVideo || !info.duration) throw new Error('Video fayl o‘qilmadi.');
    project.analysis = { ...info, source: project.inputs.clipFile, target: Math.min(info.duration, maxLength(project, channel)) };
    ctx.log(`Lavha: ${info.width}×${info.height}, ${info.duration.toFixed(1)} s, ovozi ${info.hasAudio ? 'bor' : 'yo‘q'}.`);
    const c = project.content;
    if (c.keyMoment != null && c.keyMoment !== '') {
      project.analysis.key = { t: Number(c.keyMoment), fx: Number(c.focusX ?? 0.5), fy: Number(c.focusY ?? 0.5), manual: true };
      ctx.log(`Muhim lahza qo‘lda belgilangan: ${Number(c.keyMoment).toFixed(1)} s.`);
    } else if (info.duration >= 4) {
      ctx.log('Muhim lahza qidirilmoqda (harakat va ovoz cho‘qqisi)…');
      const clip = path.join(ctx.dir, project.inputs.clipFile);
      const samples = await motionProfile(clip, { srcW: info.width, srcH: info.height });
      const loud = info.hasAudio ? await loudnessCurve(clip) : null;
      const key = findKeyMoment(samples, loud, { min: 1.6, max: info.duration - 1.2 });
      if (key) {
        project.analysis.key = key;
        ctx.log(`Muhim lahza: ${key.t.toFixed(1)} s (kadrda ${Math.round(key.fx * 100)}% / ${Math.round(key.fy * 100)}%).`);
      }
    }
    if (info.duration > maxLength(project, channel)) {
      ctx.log(`Lavha ${maxLength(project, channel)} s dan uzun — video shu uzunlikda kesiladi.`);
    }
  },

  async effects(ctx) {
    const { project, channel, dir } = ctx;
    const a = project.analysis;
    a.source = project.inputs.clipFile;
    a.effects = null;
    fs.rmSync(path.join(dir, 'edited.mp4'), { force: true });
    if (channel.fightEffects === false || project.content.effectsOff) {
      ctx.log('Effektlar o‘chirilgan.');
      return;
    }
    if (!a.key || a.duration < 4) {
      ctx.log('Lavha juda qisqa — effektlarsiz davom etiladi.');
      return;
    }
    const short = isShort(project);
    const limit = maxLength(project, channel);
    const FREEZE = 1.2;
    const PRE_R = 1.5;
    const POST_R = 1.0;
    const K = Math.max(PRE_R + 0.1, Math.min(a.key.t, a.duration - POST_R - 0.2));
    const extra = FREEZE + (PRE_R + POST_R) * 2;
    let start = 0;
    let end = a.duration;
    if (short) {
      const post = Math.max(0, Math.min(a.duration - (K + POST_R), 4));
      const pre = Math.min(K, Math.max(2, limit - extra - post - POST_R));
      start = K - pre;
      end = Math.min(a.duration, K + POST_R + post);
    }
    const W = Math.floor(a.width / 2) * 2;
    const H = Math.floor(a.height / 2) * 2;
    const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
    const zoomCrop = (z) => {
      const cw = even(W / z);
      const ch = even(H / z);
      const cx = Math.round(Math.max(0, Math.min(W - cw, a.key.fx * W - cw / 2)));
      const cy = Math.round(Math.max(0, Math.min(H - ch, a.key.fy * H - ch / 2)));
      return `crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${H}`;
    };

    // Aylana: muhim joyni belgilaydi (to'xtagan kadrda kichrayib keladi)
    const r = Math.round(Math.min(W, H) * 0.13);
    const k = Math.round(r * 0.5523);
    const ring = `m 0 ${-r} b ${k} ${-r} ${r} ${-k} ${r} 0 b ${r} ${k} ${k} ${r} 0 ${r} b ${-k} ${r} ${-r} ${k} ${-r} 0 b ${-r} ${-k} ${-k} ${-r} 0 ${-r}`;
    const bord = Math.max(4, Math.round(W / 220));
    const yellow = assColor('#facc15').replace('&H00', '&H');
    fs.writeFileSync(path.join(dir, 'fx-ring.ass'), buildAss({
      width: W,
      height: H,
      styles: [style({ name: 'Ring', outline: '#facc15', outlineWidth: bord })],
      events: [{
        start: 0, end: 10, style: 'Ring', raw: true,
        text: `{\\an5\\pos(${Math.round(a.key.fx * W)},${Math.round(a.key.fy * H)})\\bord${bord}\\shad0\\1a&HFF&\\3c${yellow}&\\fscx170\\fscy170\\t(0,260,\\fscx100\\fscy100)\\p1}${ring}{\\p0}`,
      }],
    }));
    const f = (n) => n.toFixed(3);
    const hasPost = end - (K + POST_R) > 0.2;
    const n = hasPost ? 4 : 3;
    const audioSrc = a.hasAudio
      ? '[0:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=3[x1][x2][x3]'
      : `aevalsrc=0|0:c=stereo:s=44100:d=${f(a.duration)},asplit=3[x1][x2][x3]`;
    const graph = [
      `[0:v]fps=30,scale=${W}:${H},setsar=1,split=${n}[s1][s2][s3]${hasPost ? '[s4]' : ''}`,
      `[s1]trim=start=${f(start)}:end=${f(K)},setpts=PTS-STARTPTS[p1]`,
      `[s2]trim=start=${f(K)}:duration=0.034,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${FREEZE},ass=fx-ring.ass,${zoomCrop(1.6)},setsar=1,fade=t=in:st=0:d=0.15:c=white[p2]`,
      `[s3]trim=start=${f(K - PRE_R)}:end=${f(K + POST_R)},setpts=2*(PTS-STARTPTS),fps=30,${zoomCrop(1.25)},setsar=1[p3]`,
      ...(hasPost ? [`[s4]trim=start=${f(K + POST_R)}:end=${f(end)},setpts=PTS-STARTPTS[p4]`] : []),
      audioSrc,
      `[x1]atrim=start=${f(start)}:end=${f(K)},asetpts=PTS-STARTPTS[q1]`,
      `aevalsrc=0|0:c=stereo:s=44100:d=${f(FREEZE + 0.034)}[q2]`,
      `[x2]atrim=start=${f(K - PRE_R)}:end=${f(K + POST_R)},asetpts=PTS-STARTPTS,atempo=0.5[q3]`,
      hasPost ? `[x3]atrim=start=${f(K + POST_R)}:end=${f(end)},asetpts=PTS-STARTPTS[q4]` : '[x3]anullsink',
      `${['[p1][q1]', '[p2][q2]', '[p3][q3]', hasPost ? '[p4][q4]' : ''].join('')}concat=n=${n}:v=1:a=1[v][a]`,
    ].join(';');
    ctx.log(`Effektlar: ${K.toFixed(1)} s da to‘xtash + yaqinlashtirish, so‘ng sekin takror.`);
    await ffmpeg(
      ['-i', project.inputs.clipFile, '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', 'edited.mp4'],
      { cwd: dir, durationSec: end - start + extra, onProgress: ctx.progress },
    );
    const edited = await probe(path.join(dir, 'edited.mp4'));
    a.source = 'edited.mp4';
    a.sourceHasAudio = true;
    a.effects = { K, start, end, freezeAt: K - start, replayAt: K - start + FREEZE };
    a.target = Math.min(edited.duration, limit);
    ctx.log(`Effektli lavha tayyor: ${edited.duration.toFixed(1)} s.`);
  },

  async script(ctx) {
    const { project, channel } = ctx;
    const c = project.content;
    let result = c.regenerate ? null : c.seo;
    if (result && !result.ai && textProviderReady()) result = null;
    if (result) {
      ctx.log('Oldingi matn va SEO ishlatildi (AI qayta chaqirilmadi).');
    } else {
      try {
        result = await generateJson({
          ...fightScriptPrompt({ channel, inputs: project.inputs, durationSec: project.analysis.target, format: project.format, effects: project.analysis.effects }),
          cost: ctx.costMeta,
        });
        result.ai = true;
        ctx.log('Tahlil matni AI tomonidan yozildi.');
      } catch (err) {
        ctx.log(`AI matn ishlamadi (${err.message}) — eslatmalardagi matn ishlatiladi.`);
        result = fightScriptFallback({ inputs: project.inputs });
      }
      c.seo = result;
      if (c.scriptManual) {
        ctx.log('Qo‘lda tahrirlangan matn saqlab qolindi.');
      } else {
        c.hook = result.hook || '';
        c.narration = result.narration || '';
      }
      if (c.regenerate || !c.thumbnailText) c.thumbnailText = result.thumbnailText || '';
    }
    applyMeta(project, 'main', isShort(project) ? 'short' : 'long', {
      title: cleanTitle(result.titles?.[0], project.inputs.fighters),
      description: buildDescription(channel, result.description, result.hashtags),
      tags: limitTags([...(result.tags || []), ...channel.baseTags]),
    });
  },

  async voice(ctx) {
    const { project, dir, settings } = ctx;
    const c = project.content;
    const out = path.join(dir, 'voice.mp3');
    const voiceId = settings.ttsProvider === 'elevenlabs' ? `eleven:${settings.elevenVoiceId}` : `openai:${settings.ttsVoice}`;
    const source = project.inputs.voiceFile ? `file:${project.inputs.voiceFile}` : `tts:${voiceId}:${c.narration || ''}`;
    if (fs.existsSync(out) && c.voiceSource === source && !c.regenerate) {
      ctx.log('Matn o‘zgarmagan — oldingi ovoz ishlatildi.');
    } else {
      fs.rmSync(out, { force: true });
      c.voiceSource = null;
      if (project.inputs.voiceFile) {
        await ffmpeg(['-i', project.inputs.voiceFile, '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', '2', 'voice.mp3'], { cwd: dir });
        c.voiceSource = source;
        ctx.log('Siz yuklagan ovoz ishlatildi.');
      } else if (c.narration && ttsReady()) {
        ctx.log(`Diktor ovozi yaratilmoqda (${settings.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI TTS'})…`);
        try {
          await synthesize(c.narration, out, {
            instructions: 'Energetic, confident combat-sports analyst. Clear American English, punchy pacing, no shouting.',
            cost: ctx.costMeta,
          });
          c.voiceSource = source;
        } catch (err) {
          ctx.log(`Ovoz yaratilmadi: ${err.message}`);
        }
      } else if (c.narration) {
        ctx.log('Ovoz kaliti yo‘q — video ovozsiz, faqat subtitr bilan chiqadi.');
      }
    }
    c.voiceDuration = fs.existsSync(out) ? (await probe(out)).duration : 0;
  },

  async captions(ctx) {
    const { project, channel, settings, dir } = ctx;
    const c = project.content;
    const short = isShort(project);
    const limit = maxLength(project, channel);
    const D = c.voiceDuration ? Math.min(c.voiceDuration + 1, limit) : project.analysis.target;
    if (c.voiceDuration > limit) ctx.log(`Diqqat: ovoz ${Math.round(c.voiceDuration)} s, video ${limit} s da kesiladi. Matnni qisqartiring.`);
    project.analysis.renderDuration = D;

    const speechEnd = c.voiceDuration ? Math.min(c.voiceDuration, D) : D;
    const chunks = chunkWords(c.narration || '', short ? 4 : 9);
    const totalChars = chunks.reduce((s, x) => s + x.length + 2, 0) || 1;
    let t = 0.15;
    const captionEvents = chunks.map((text) => {
      const len = ((text.length + 2) / totalChars) * (speechEnd - 0.15);
      const e = { start: t, end: Math.min(t + len, D), style: 'Cap', text: short ? text.toUpperCase() : text };
      t += len;
      return e;
    });

    const W = short ? 1080 : 1920;
    const H = short ? 1920 : 1080;
    const ass = buildAss({
      width: W,
      height: H,
      styles: [
        style({ name: 'Hook', font: settings.fontName, size: short ? 74 : 64, color: '#ffffff', back: channel.colors.primary, backAlpha: 0, boxed: true, outlineWidth: 14, align: 8, marginV: short ? 250 : 60, marginH: 60 }),
        short
          ? style({ name: 'Cap', font: settings.fontName, size: 76, outlineWidth: 6, shadow: 3, align: 2, marginV: 560, marginH: 80 })
          : style({ name: 'Cap', font: settings.fontName, size: 48, boxed: true, back: '#000000', backAlpha: 90, outlineWidth: 10, align: 2, marginV: 60, marginH: 200 }),
        style({ name: 'Brand', font: settings.fontName, size: short ? 34 : 30, outlineWidth: 2, align: short ? 8 : 9, marginV: short ? 120 : 30, marginH: 40 }),
        style({ name: 'Fx', font: settings.fontName, size: short ? 54 : 44, back: channel.colors.primary, backAlpha: 0, boxed: true, outlineWidth: 12, align: short ? 8 : 7, marginV: short ? 400 : 50, marginH: 50 }),
      ],
      events: [
        ...(c.hook ? [{ start: 0, end: Math.min(3.5, D), style: 'Hook', text: c.hook.toUpperCase(), tags: '\\fad(100,200)' }] : []),
        ...captionEvents,
        { start: 0, end: D, style: 'Brand', text: channel.name },
        ...(project.analysis.effects
          ? [
              { start: project.analysis.effects.freezeAt, end: project.analysis.effects.freezeAt + 1.2, style: 'Fx', text: 'KEY MOMENT' },
              { start: project.analysis.effects.replayAt, end: project.analysis.effects.replayAt + 5, style: 'Fx', text: 'REPLAY ×0.5' },
            ]
          : []),
      ],
    });
    fs.writeFileSync(path.join(dir, 'captions.ass'), ass);
    ctx.log(`${captionEvents.length} ta subtitr bo‘lagi, video uzunligi ${D.toFixed(1)} s.`);
  },

  async render(ctx) {
    const { project, channel, settings, dir } = ctx;
    const a = project.analysis;
    const short = isShort(project);
    const D = a.renderDuration;
    const hasVoice = fs.existsSync(path.join(dir, 'voice.mp3')) && project.content.voiceDuration > 0;
    const source = a.source && fs.existsSync(path.join(dir, a.source)) ? a.source : project.inputs.clipFile;
    const clipAudio = source === project.inputs.clipFile ? a.hasAudio : Boolean(a.sourceHasAudio);

    // Aqlli kesish: gorizontal lavhadan harakatga ergashadigan kvadrat oyna (Shorts uchun)
    let foreground = '[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg]';
    const W = Math.floor(a.width / 2) * 2;
    const H = Math.floor(a.height / 2) * 2;
    if (short && channel.smartCrop !== false && W > H * 1.1) {
      ctx.log('Aqlli kesish: harakat markazi kuzatilmoqda…');
      const samples = await motionProfile(path.join(dir, source), { srcW: W, srcH: H });
      const side = Math.floor(Math.min(W, H) / 2) * 2;
      const points = cropPath(samples, { W, cropW: side, step: 0.5 });
      fs.writeFileSync(path.join(dir, 'crop.cmd'), cropCommands(points));
      foreground = `[b]scale=${W}:${H},sendcmd=f=crop.cmd,crop@sc=w=${side}:h=${side}:x=${points[0].x}:y=${Math.floor((H - side) / 2)},scale=1080:1080[fg]`;
    }

    const args = ['-stream_loop', '-1', '-i', source];
    if (hasVoice) args.push('-i', 'voice.mp3');
    else if (!clipAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');

    const video = short
      ? '[0:v]split=2[a][b];' +
        '[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2,eq=brightness=-0.18[bg];' +
        `${foreground};` +
        '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1'
      : '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1';
    const fadeOut = Math.max(0, D - 0.6);
    let graph = `${video},ass=captions.ass,fade=t=out:st=${fadeOut}:d=0.6,format=yuv420p[v]`;
    let audioMap;
    if (hasVoice && clipAudio) {
      // Asl ovoz (tomoshabinlar, zarbalar) past fon sifatida, ustidan diktor
      graph += `;[0:a]volume=0.18[ca];[1:a]volume=1.0[va];[ca][va]amix=inputs=2:duration=longest:normalize=0,afade=t=out:st=${fadeOut}:d=0.6[a]`;
      audioMap = '[a]';
    } else if (hasVoice || !clipAudio) {
      audioMap = '1:a';
    } else {
      graph += `;[0:a]afade=t=out:st=${fadeOut}:d=0.6[a]`;
      audioMap = '[a]';
    }
    args.push(
      '-filter_complex', graph,
      '-map', '[v]', '-map', audioMap,
      '-t', String(D),
      '-c:v', 'libx264', '-preset', settings.renderPreset, '-crf', '21', '-r', '30',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
      'video.mp4',
    );
    await ffmpeg(args, { cwd: dir, durationSec: D, onProgress: ctx.progress });
    upsertOutput(project, 'main', { kind: short ? 'short' : 'long', file: 'video.mp4', duration: D });
    ctx.log(`Montaj tayyor (${short ? '1080×1920 Shorts' : '1920×1080'}).`);
  },

  async thumbnail(ctx) {
    const { project, channel, settings, dir } = ctx;
    const text = (project.content.thumbnailText || project.content.hook || '').toUpperCase();
    const ass = buildAss({
      width: 1280,
      height: 720,
      styles: [
        style({ name: 'Big', font: settings.fontName, size: 100, color: '#ffffff', outline: '#000000', outlineWidth: 8, shadow: 4, align: 1, marginV: 50, marginH: 50 }),
        style({ name: 'Tag', font: settings.fontName, size: 34, back: channel.colors.primary, backAlpha: 0, boxed: true, outlineWidth: 10, align: 7, marginV: 40, marginH: 50 }),
      ],
      events: [
        { start: 0, end: 10, style: 'Big', text },
        { start: 0, end: 10, style: 'Tag', text: 'BREAKDOWN' },
      ],
    });
    fs.writeFileSync(path.join(dir, 'thumb.ass'), ass);
    // Prevyu kadri — muhim lahza (zarba) payti, bo'lmasa lavhaning 40% i
    const at = project.analysis.key?.t ?? (project.analysis.target || project.analysis.duration) * 0.4;
    await ffmpeg(
      [
        '-ss', at.toFixed(2), '-i', project.inputs.clipFile,
        '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=contrast=1.12:saturation=1.25,ass=thumb.ass',
        '-frames:v', '1', 'thumbnail.png',
      ],
      { cwd: dir },
    );
    upsertOutput(project, 'main', { kind: isShort(project) ? 'short' : 'long', thumbnail: 'thumbnail.png' });
    ctx.log('Prevyu tayyor (1280×720).');
  },
};

function chunkWords(text, size) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks = [];
  let current = [];
  for (const w of words) {
    current.push(w);
    // Gap oxirida yoki kerakli so'z soniga yetganda bo'lakni yopamiz
    if (current.length >= size || /[.!?]$/.test(w)) {
      chunks.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) chunks.push(current.join(' '));
  return chunks;
}
