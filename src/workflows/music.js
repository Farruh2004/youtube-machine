// Overtone AI: Suno qo'shig'i -> muqova/fon -> qo'shiq matni -> uzun lyric video + Shorts -> prevyu + SEO
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, probe, loudnessCurve, bestWindows } from '../media/ffmpeg.js';
import { buildAss, style, karaokeText } from '../media/ass.js';
import { isLrc, parseLrc, toLrc, cleanLyrics, distribute, timedToEvents } from '../media/lyrics.js';
import { generateJson, textProviderReady } from '../ai/llm.js';
import { transcribeSegments, speechReady } from '../ai/speech.js';
import { musicSeoPrompt, musicSeoFallback, needsTranslation, translatePrompt } from '../ai/prompts.js';
import { applyMeta, buildDescription, cleanTitle, limitTags, upsertOutput, hex } from './common.js';

export const STEPS = [
  { key: 'analyze', label: 'Audio tahlili va Shorts parchasini tanlash' },
  { key: 'lyrics', label: 'Qo‘shiq matnini vaqtlash' },
  { key: 'seo', label: 'SEO: sarlavha, tavsif, teglar' },
  { key: 'cover', label: 'Muqova va fon' },
  { key: 'thumbnail', label: 'Prevyu (thumbnail)' },
  { key: 'render_long', label: 'Uzun lyric video montaji' },
  { key: 'render_short', label: 'Shorts montaji' },
];

const audioPath = (ctx) => path.join(ctx.dir, ctx.project.inputs.audioFile);

export const run = {
  async analyze(ctx) {
    const { project, channel } = ctx;
    if (!project.inputs.audioFile) throw new Error('Qo‘shiq fayli (MP3/WAV) yuklanmagan.');
    const info = await probe(audioPath(ctx));
    if (!info.hasAudio || !info.duration) throw new Error('Audio fayl o‘qilmadi.');
    const shortLength = Math.min(Number(channel.shortsSeconds) || 40, Math.floor(info.duration));
    const count = shortsCount(channel);
    const manual = project.content.shortStart;
    ctx.log(`Eng kuchli ${count} ta parcha qidirilmoqda (balandlik tahlili)…`);
    const curve = await loudnessCurve(audioPath(ctx));
    let starts = bestWindows(curve, info.duration, shortLength, count, Math.min(10, info.duration * 0.1));
    if (manual != null && manual !== '') {
      const m = Math.max(0, Math.min(Number(manual), info.duration - shortLength));
      starts = [m, ...starts.filter((s) => Math.abs(s - m) >= shortLength)].slice(0, count);
    }
    starts = starts.map((s) => Math.max(0, Math.min(s, info.duration - shortLength)));
    project.analysis = {
      duration: info.duration,
      shortStart: starts[0],
      shortLength,
      shorts: starts.map((start, i) => ({ id: shortId(i), start, length: shortLength })),
    };
    ctx.log(`Davomiyligi ${fmt(info.duration)}. Shorts parchalari: ${starts.map((st) => `${fmt(st)}–${fmt(st + shortLength)}`).join(', ')}.`);
  },

  async lyrics(ctx) {
    const { project } = ctx;
    const { duration } = project.analysis;
    const c = project.content;
    let timed;
    if (c.lyricsManual && c.lyricsLrc) {
      timed = parseLrc(c.lyricsLrc);
      c.lyricsSource = 'manual';
    } else if (c.lyricsLrc != null && !c.regenerate) {
      timed = parseLrc(c.lyricsLrc);
      ctx.log('Oldingi vaqtlar ishlatildi (AI qayta chaqirilmadi).');
    } else if (isLrc(project.inputs.lyrics)) {
      timed = parseLrc(project.inputs.lyrics);
      c.lyricsSource = 'lrc';
    } else {
      const lines = cleanLyrics(project.inputs.lyrics);
      if (!lines.length) {
        timed = [];
        c.lyricsSource = 'none';
        ctx.log('Qo‘shiq matni berilmagan — video matnsiz chiqadi.');
      } else {
        let regions = null;
        if (speechReady()) {
          try {
            ctx.log('Vokal qayerda eshitilishi aniqlanmoqda (Whisper)…');
            const segs = await transcribeSegments(audioPath(ctx), duration, { cost: ctx.costMeta });
            regions = segs.map((s) => ({ start: s.start, end: s.end }));
          } catch (err) {
            ctx.log(`Transkripsiya bo‘lmadi: ${err.message}`);
          }
        }
        if (regions?.length) {
          c.lyricsSource = 'whisper';
        } else {
          regions = [{ start: Math.min(8, duration * 0.06), end: duration - Math.min(6, duration * 0.05) }];
          c.lyricsSource = 'even';
          ctx.log('Matn teng taqsimlandi (taxminiy). Aniq bo‘lishi uchun ko‘rib chiqishda vaqtlarni tahrirlang.');
        }
        timed = distribute(lines, regions);
      }
    }
    c.lyricsLrc = toLrc(timed);
    ctx.log(`${timed.length} ta qator vaqtlandi (${c.lyricsSource}).`);
    await translateLines(ctx, timed.map((t) => t.text));
  },

  async seo(ctx) {
    const { project, channel } = ctx;
    const lines = cleanLyrics(String(project.inputs.lyrics || '').replace(/^\s*\[\d+:[\d.:]+\]\s*/gm, ''));
    // Shablon natijasi faqat AI mavjud bo'lmaganda qayta ishlatiladi: kalit qo'shilsa, AI yozadi.
    let seo = project.content.regenerate ? null : project.content.seo;
    if (seo && !seo.ai && textProviderReady()) seo = null;
    if (seo) {
      ctx.log('Oldingi SEO ishlatildi (AI qayta chaqirilmadi).');
    } else {
      try {
        seo = await generateJson({ ...musicSeoPrompt({ channel, inputs: project.inputs, lyricsLines: lines }), cost: ctx.costMeta });
        seo.ai = true;
        ctx.log('SEO AI tomonidan yozildi.');
      } catch (err) {
        ctx.log(`AI SEO ishlamadi (${err.message}) — shablon ishlatildi.`);
        seo = musicSeoFallback({ channel, inputs: project.inputs });
      }
      project.content.seo = seo;
      if (project.content.regenerate || !project.content.thumbnailText) project.content.thumbnailText = seo.thumbnailText || project.inputs.songTitle || '';
    }
    const tags = limitTags([...(seo.tags || []), ...channel.baseTags]);
    applyMeta(project, 'long', 'long', {
      title: cleanTitle(seo.titles?.[0], project.inputs.songTitle),
      description: buildDescription(channel, seo.description, seo.hashtags),
      tags,
    });
    const ids = (project.analysis?.shorts || [{ id: 'short' }]).map((x) => x.id);
    ids.forEach((id, i) => {
      applyMeta(project, id, 'short', {
        title: cleanTitle(seo.shortTitles?.[i] || seo.shortTitles?.[0], `${project.inputs.songTitle || 'New song'} #Shorts`),
        description: buildDescription(channel, seo.shortDescription || 'Full song with lyrics on the channel.', seo.hashtags),
        tags,
      });
    });
    pruneShorts(ctx, ids);
  },

  async cover(ctx) {
    const { project, channel, dir } = ctx;
    const c1 = hex(channel.colors.primary);
    const c2 = hex(channel.colors.secondary);
    if (project.inputs.coverFile) {
      const cover = project.inputs.coverFile;
      await ffmpeg(
        [
          '-i', cover,
          '-filter_complex',
          '[0:v]split=2[a][b];' +
            '[a]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=40:4,eq=brightness=-0.22:saturation=1.2[bg];' +
            '[b]scale=600:600:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:100',
          '-frames:v', '1', 'bg-long.png',
        ],
        { cwd: dir },
      );
      await ffmpeg(
        [
          '-i', cover,
          '-filter_complex',
          '[0:v]split=2[a][b];' +
            '[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:4,eq=brightness=-0.22:saturation=1.2[bg];' +
            '[b]scale=900:900:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:330',
          '-frames:v', '1', 'bg-short.png',
        ],
        { cwd: dir },
      );
      ctx.log('Muqova asosida fonlar tayyorlandi.');
    } else {
      await ffmpeg(['-f', 'lavfi', '-i', `gradients=s=1920x1080:c0=${c1}:c1=${c2}:x0=0:y0=0:x1=1920:y1=1080:n=2`, '-vf', 'eq=brightness=-0.18', '-frames:v', '1', 'bg-long.png'], { cwd: dir });
      await ffmpeg(['-f', 'lavfi', '-i', `gradients=s=1080x1920:c0=${c1}:c1=${c2}:x0=0:y0=0:x1=1080:y1=1920:n=2`, '-vf', 'eq=brightness=-0.18', '-frames:v', '1', 'bg-short.png'], { cwd: dir });
      ctx.log('Muqova yuklanmagan — kanal ranglaridan gradient fon yasaldi.');
    }
  },

  async thumbnail(ctx) {
    const { project, channel, settings, dir } = ctx;
    const text = project.content.thumbnailText || project.inputs.songTitle || '';
    const ass = buildAss({
      width: 1280,
      height: 720,
      styles: [
        style({ name: 'Big', font: settings.fontName, size: 104, outline: channel.colors.primary, outlineWidth: 8, shadow: 3, align: 2, marginV: 50 }),
        style({ name: 'Brand', font: settings.fontName, size: 30, outlineWidth: 2, align: 7, marginV: 26, marginH: 30 }),
      ],
      events: [
        { start: 0, end: 10, style: 'Big', text: text.toUpperCase() },
        { start: 0, end: 10, style: 'Brand', text: channel.name },
      ],
    });
    fs.writeFileSync(path.join(dir, 'thumb.ass'), ass);
    await ffmpeg(['-loop', '1', '-i', 'bg-long.png', '-vf', 'scale=1280:720,ass=thumb.ass', '-frames:v', '1', 'thumbnail-long.png'], { cwd: dir });
    upsertOutput(project, 'long', { kind: 'long', thumbnail: 'thumbnail-long.png' });
    ctx.log('Prevyu tayyor (1280×720).');
  },

  async render_long(ctx) {
    const { project, channel, settings, dir } = ctx;
    const D = project.analysis.duration;
    const events = timedToEvents(parseLrc(project.content.lyricsLrc), D).map((e, idx) => ({ ...e, idx }));
    const showTitle = !project.inputs.coverFile;
    const ass = buildAss({
      width: 1920,
      height: 1080,
      styles: [
        ...lyricStyles(ctx, { size: 62, nextSize: 38, marginV: 250, nextMarginV: 195, marginH: 120 }),
        style({ name: 'Title', font: settings.fontName, size: 110, outline: channel.colors.primary, outlineWidth: 6, shadow: 3, align: 5, marginV: 0 }),
        style({ name: 'Brand', font: settings.fontName, size: 30, outlineWidth: 2, align: 9, marginV: 30, marginH: 40 }),
      ],
      events: [
        ...lyricEvents(ctx, events),
        ...(showTitle ? [{ start: 0, end: D, style: 'Title', text: project.inputs.songTitle || '', tags: '\\pos(960,400)' }] : []),
        { start: 0, end: D, style: 'Brand', text: channel.name },
      ],
    });
    fs.writeFileSync(path.join(dir, 'long.ass'), ass);
    const fadeOut = Math.max(0, D - 2);
    const bg = background(ctx, { w: 1920, h: 1080, coverSize: 600, coverY: 100, image: 'bg-long.png' });
    await ffmpeg(
      [
        ...bg.args,
        '-i', project.inputs.audioFile,
        '-filter_complex',
        `${bg.filter};[${bg.next}:a:0]asplit=2[aw][ao];` +
          `[aw]showwaves=s=1920x150:mode=cline:draw=full:rate=30:scale=sqrt:colors=white@0.85|${hex(channel.colors.primary)}@0.85,format=rgba[w];` +
          `[b][w]overlay=0:H-h-20[o];` +
          `[o]ass=long.ass,fade=t=in:st=0:d=1,fade=t=out:st=${fadeOut}:d=2,format=yuv420p[v];` +
          `[ao]afade=t=out:st=${fadeOut}:d=2[a]`,
        '-map', '[v]', '-map', '[a]',
        '-t', String(D),
        '-c:v', 'libx264', '-preset', settings.renderPreset, '-crf', '22', '-r', '30',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
        'video-long.mp4',
      ],
      { cwd: dir, durationSec: D, onProgress: ctx.progress },
    );
    upsertOutput(project, 'long', { kind: 'long', file: 'video-long.mp4', duration: D });
    ctx.log('Uzun video tayyor (1920×1080).');
  },

  async render_short(ctx) {
    const { project, channel, settings, dir } = ctx;
    const all = timedToEvents(parseLrc(project.content.lyricsLrc), project.analysis.duration).map((e, idx) => ({ ...e, idx }));
    const shorts = project.analysis.shorts || [{ id: 'short', start: project.analysis.shortStart, length: project.analysis.shortLength }];
    for (let i = 0; i < shorts.length; i++) {
      const { id, start: S, length: L } = shorts[i];
      const suffix = i === 0 ? '' : String(i + 1);
      const events = all
        .filter((e) => e.end > S && e.start < S + L)
        .map((e) => ({ ...e, start: Math.max(0, e.start - S), end: Math.min(L, e.end - S) }));
      const ass = buildAss({
        width: 1080,
        height: 1920,
        styles: [
          style({ name: 'Title', font: settings.fontName, size: 70, outline: channel.colors.primary, outlineWidth: 5, shadow: 2, align: 8, marginV: 170, marginH: 70 }),
          ...lyricStyles(ctx, { size: 66, nextSize: 42, marginV: 620, nextMarginV: 555, marginH: 70 }),
          style({ name: 'Cta', font: settings.fontName, size: 44, outlineWidth: 3, align: 2, marginV: 300 }),
        ],
        events: [
          { start: 0, end: L, style: 'Title', text: project.inputs.songTitle || '' },
          ...lyricEvents(ctx, events),
          { start: Math.max(0, L - 8), end: L, style: 'Cta', text: '▶ Full song on the channel' },
        ],
      });
      const assName = `short${suffix}.ass`;
      fs.writeFileSync(path.join(dir, assName), ass);
      const fadeOut = Math.max(0, L - 1.5);
      const bg = background(ctx, { w: 1080, h: 1920, coverSize: 900, coverY: 330, image: 'bg-short.png' });
      const file = `video-short${suffix}.mp4`;
      await ffmpeg(
        [
          ...bg.args,
          '-ss', String(S), '-t', String(L), '-i', project.inputs.audioFile,
          '-filter_complex',
          `${bg.filter};[${bg.next}:a:0]afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeOut}:d=1.5,asplit=2[aw][ao];` +
            `[aw]showwaves=s=1080x160:mode=cline:draw=full:rate=30:scale=sqrt:colors=white@0.85|${hex(channel.colors.primary)}@0.85,format=rgba[w];` +
            `[b][w]overlay=0:1390[o];` +
            `[o]ass=${assName},format=yuv420p[v]`,
          '-map', '[v]', '-map', '[ao]',
          '-t', String(L),
          '-c:v', 'libx264', '-preset', settings.renderPreset, '-crf', '22', '-r', '30',
          '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
          file,
        ],
        {
          cwd: dir,
          durationSec: L,
          onProgress: (pct) => ctx.progress(Math.round(((i + pct / 100) / shorts.length) * 100)),
        },
      );
      const thumb = `thumbnail-short${suffix}.png`;
      await ffmpeg(['-ss', String(Math.min(3, L / 2)), '-i', file, '-frames:v', '1', '-vf', 'scale=540:960', thumb], { cwd: dir });
      upsertOutput(project, id, { kind: 'short', file, thumbnail: thumb, duration: L, startInSong: S });
      ctx.log(`Shorts ${i + 1}/${shorts.length} tayyor (${fmt(S)} dan, ${Math.round(L)} s).`);
    }
  },
};

function shortsCount(channel) {
  return Math.max(1, Math.min(5, Number(channel.shortsPerSong ?? 3) || 1));
}

function shortId(i) {
  return i === 0 ? 'short' : `short${i + 1}`;
}

/** Sozlamada Shorts soni kamaytirilsa, ortiqcha (hali yuklanmagan) natijalarni olib tashlaydi. */
function pruneShorts(ctx, keepIds) {
  const { project, dir } = ctx;
  project.outputs = (project.outputs || []).filter((o) => {
    if (o.kind !== 'short' || keepIds.includes(o.id)) return true;
    if (['done', 'uploading'].includes(o.upload?.status)) return true;
    for (const f of [o.file, o.thumbnail]) if (f) fs.rmSync(path.join(dir, f), { force: true });
    return false;
  });
}

/** Qo'shiq matni tili inglizcha bo'lmasa, har qator ostiga inglizcha tarjima (AI, keshlanadi). */
async function translateLines(ctx, lines) {
  const { project, channel } = ctx;
  const c = project.content;
  if (c.translationManual) return;
  if (channel.translateLyrics === false || !needsTranslation(project.inputs.lyricsLanguage) || !lines.length) {
    c.translation = null;
    return;
  }
  const key = lines.join('\n');
  if (c.translation?.key === key && !c.regenerate) {
    ctx.log('Oldingi tarjima ishlatildi.');
    return;
  }
  if (!textProviderReady()) {
    ctx.log('Tarjima qatori uchun AI kaliti kerak — o‘tkazib yuborildi.');
    return;
  }
  try {
    const r = await generateJson({ ...translatePrompt(lines, project.inputs.lyricsLanguage), cost: ctx.costMeta });
    if (Array.isArray(r.lines) && r.lines.length === lines.length) {
      c.translation = { key, lines: r.lines.map((x) => String(x)) };
      ctx.log(`${lines.length} ta qator inglizchaga tarjima qilindi.`);
    } else {
      ctx.log('Tarjima qatorlari soni mos kelmadi — o‘tkazib yuborildi.');
    }
  } catch (err) {
    ctx.log(`Tarjima bo‘lmadi: ${err.message}`);
  }
}

function lyricStyles(ctx, { size, nextSize, marginV, nextMarginV, marginH }) {
  const { channel, settings } = ctx;
  const karaoke = channel.karaoke !== false;
  return [
    style({ name: 'Lyric', font: settings.fontName, size, color: '#ffffff', secondary: karaoke ? '#8b93a7' : null, outline: '#000000', outlineWidth: 4, shadow: 2, align: 2, marginV, marginH }),
    style({ name: 'Next', font: settings.fontName, size: nextSize, color: '#cbd5e1', outlineWidth: 2, bold: false, align: 2, marginV: nextMarginV, marginH: marginH + 40 }),
    style({ name: 'Trans', font: settings.fontName, size: nextSize, color: '#f5e9ff', outline: channel.colors.primary, outlineWidth: 2, bold: false, align: 2, marginV: nextMarginV, marginH: marginH + 40 }),
  ];
}

/** Joriy qator (karaoke bo'lsa so'zma-so'z yonadi) + ostida tarjima yoki keyingi qator. */
function lyricEvents(ctx, events) {
  const karaoke = ctx.channel.karaoke !== false;
  const tr = ctx.project.content.translation?.lines;
  const out = [];
  for (const e of events) {
    out.push(
      karaoke
        ? { start: e.start, end: e.end, style: 'Lyric', text: karaokeText(e.text, e.end - e.start), raw: true, tags: '\\fad(150,120)' }
        : { start: e.start, end: e.end, style: 'Lyric', text: e.text, tags: '\\fad(200,150)' },
    );
    const translation = tr?.[e.idx];
    if (translation) out.push({ start: e.start, end: e.end, style: 'Trans', text: translation, tags: '\\fad(200,150)' });
    else if (e.next) out.push({ start: e.start, end: e.end, style: 'Next', text: e.next });
  }
  return out;
}

/**
 * Fon: yuklangan video (AI yaratgan halqa video va h.k.) takrorlanadi, aks holda rasm
 * sekin suzib turadi (Ken Burns). Natija oqimi — [b], audio kirish indeksi — next.
 */
function background(ctx, { w, h, coverSize, coverY, image }) {
  const { project, channel } = ctx;
  if (project.inputs.bgvideoFile) {
    const args = ['-stream_loop', '-1', '-i', project.inputs.bgvideoFile];
    const base = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,eq=brightness=-0.12,setsar=1`;
    if (project.inputs.coverFile) {
      args.push('-loop', '1', '-i', project.inputs.coverFile);
      return { args, next: 2, filter: `${base}[bgv];[1:v]scale=${coverSize}:${coverSize}:force_original_aspect_ratio=decrease[cv];[bgv][cv]overlay=(W-w)/2:${coverY}[b]` };
    }
    return { args, next: 1, filter: `${base}[b]` };
  }
  const args = ['-loop', '1', '-framerate', '30', '-i', image];
  if (channel.bgMotion === false) return { args, next: 1, filter: `[0:v]scale=${w}:${h},setsar=1[b]` };
  const zw = Math.round((w * 1.08) / 2) * 2;
  const zh = Math.round((h * 1.08) / 2) * 2;
  const dx = (zw - w) / 2;
  const dy = (zh - h) / 2;
  return {
    args,
    next: 1,
    filter: `[0:v]scale=${zw}:${zh},crop=${w}:${h}:x='${dx}+${dx}*sin(2*PI*t/37)':y='${dy}+${dy}*cos(2*PI*t/53)',setsar=1[b]`,
  };
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
