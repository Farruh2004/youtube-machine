// Harakat tahlili: kichik kulrang kadrlarni solishtirib, qayerda va qachon harakat bo'lganini topadi.
// Bundan muhim lahzani (zarba), aqlli kesish yo'lini va to'liq jangdan eng qizg'in lavhalarni olamiz.
import { run } from './ffmpeg.js';
import { FFMPEG } from '../config.js';

export async function motionProfile(file, { fps = 10, width = 96, srcW = 16, srcH = 9 } = {}) {
  const height = Math.max(2, Math.round((width * srcH) / srcW / 2) * 2);
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `fps=${fps},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'],
    { binary: true },
  );
  const frameSize = width * height;
  const frames = Math.floor(stdout.length / frameSize);
  const samples = [];
  for (let f = 1; f < frames; f++) {
    const a = (f - 1) * frameSize;
    const b = f * frameSize;
    let total = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const d = Math.abs(stdout[b + y * width + x] - stdout[a + y * width + x]);
        if (d > 12) {
          total += d;
          sx += d * x;
          sy += d * y;
        }
      }
    }
    samples.push({
      t: f / fps,
      motion: total / frameSize,
      cx: total ? sx / total / width : null,
      cy: total ? sy / total / height : null,
    });
  }
  return samples;
}

export function smooth(values, radius) {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(values.length - 1, i + radius); k++) {
      sum += values[k];
      n++;
    }
    return n ? sum / n : 0;
  });
}

function zscore(values) {
  const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1);
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length || 1)) || 1;
  return values.map((v) => (v - mean) / sd);
}

/** Ovoz balandligini (ebur128 egri chizig'i) harakat namunalari vaqtiga moslaydi. */
function loudnessAt(curve, times) {
  if (!curve?.length) return times.map(() => 0);
  let j = 0;
  return times.map((t) => {
    while (j < curve.length - 1 && curve[j + 1].t <= t) j++;
    const m = curve[j].m;
    return m > -70 ? 10 ** (m / 20) : 0;
  });
}

/**
 * Muhim lahza: harakat va ovoz eng keskin ko'tarilgan joy (odatda zarba tushgan payt).
 * Natija: { t, fx, fy } — vaqt va kadrdagi nisbiy markaz (0..1).
 */
export function findKeyMoment(samples, loudCurve, { min = 0, max = Infinity } = {}) {
  if (!samples.length) return null;
  const times = samples.map((s) => s.t);
  const motion = zscore(smooth(samples.map((s) => s.motion), 2));
  const loud = loudCurve?.length ? zscore(smooth(loudnessAt(loudCurve, times), 2)) : times.map(() => 0);
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (times[i] < min || times[i] > max) continue;
    const score = motion[i] + 0.8 * loud[i];
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return null;
  const t = times[best];
  let wx = 0;
  let wy = 0;
  let w = 0;
  for (const s of samples) {
    if (Math.abs(s.t - t) <= 0.4 && s.cx != null) {
      wx += s.cx * s.motion;
      wy += s.cy * s.motion;
      w += s.motion;
    }
  }
  return { t, fx: w ? wx / w : 0.5, fy: w ? wy / w : 0.5 };
}

/** Har soniya uchun "qizg'inlik" bahosi (harakat + ovoz) — to'liq jangdan lavha topish uchun. */
export function intensityPerSecond(samples, loudCurve, durationSec) {
  const seconds = Math.max(1, Math.floor(durationSec));
  const times = samples.map((s) => s.t);
  const motion = zscore(samples.map((s) => s.motion));
  const loud = loudCurve?.length ? zscore(loudnessAt(loudCurve, times)) : times.map(() => 0);
  const sum = new Array(seconds).fill(0);
  const cnt = new Array(seconds).fill(0);
  samples.forEach((s, i) => {
    const k = Math.floor(s.t);
    if (k < seconds) {
      sum[k] += motion[i] + 0.8 * loud[i];
      cnt[k]++;
    }
  });
  // Manfiy qiymatlar oynalarni "jazolamasligi" uchun 0 dan boshlaymiz
  const raw = sum.map((v, k) => (cnt[k] ? v / cnt[k] : 0));
  const minVal = Math.min(...raw);
  return raw.map((v) => v - minVal);
}

/**
 * Kesish yo'li: harakat markaziga silliq ergashadigan x koordinatalar (har `step` soniyada).
 * W — manba kengligi, cropW — kesiladigan oyna kengligi (piksel).
 */
export function cropPath(samples, { W, cropW, step = 1 }) {
  if (!samples.length || cropW >= W) return [{ t: 0, x: 0 }];
  let last = 0.5;
  // Juda kichik (shovqin) harakatlarni hisobga olmaymiz: chegara — o'rtacha harakatning 20%
  const avg = samples.reduce((sum, s) => sum + s.motion, 0) / samples.length;
  const threshold = Math.max(0.02, avg * 0.2);
  const filled = samples.map((s) => {
    if (s.cx != null && s.motion > threshold) last = s.cx;
    return last;
  });
  const smoothX = smooth(filled, 15);
  const points = [];
  const end = samples[samples.length - 1].t;
  for (let t = 0; t <= end + 0.001; t += step) {
    const i = Math.min(samples.length - 1, Math.max(0, Math.round((t / end) * (samples.length - 1))));
    const x = Math.round(Math.max(0, Math.min(W - cropW, smoothX[i] * W - cropW / 2)));
    points.push({ t: Math.round(t * 100) / 100, x });
  }
  return points;
}

/**
 * Kesish nuqtalarini ffmpeg `sendcmd` fayliga aylantiradi: har oraliq boshida crop filtrining x
 * qiymati shu oraliq uchun chiziqli ifodaga almashtiriladi (uzun ichma-ich ifodadan ishonchliroq).
 * Filtr nomi: crop@sc
 */
export function cropCommands(points) {
  const r = (n) => Math.round(n * 1000) / 1000;
  const lines = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const expr = b ? `${a.x}+(${b.x - a.x})*(t-${r(a.t)})/${r(Math.max(0.01, b.t - a.t))}` : String(a.x);
    lines.push(`${r(a.t)} crop@sc x ${expr};`);
  }
  return `${lines.join('\n')}\n`;
}
