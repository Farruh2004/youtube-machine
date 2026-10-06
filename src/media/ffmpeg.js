import { spawn } from 'node:child_process';
import { FFMPEG, FFPROBE } from '../config.js';

/**
 * Buyruqni ishga tushiradi. `durationSec` berilsa, ffmpeg chiqargan `time=` qatorlaridan
 * foizli progress hisoblanadi.
 */
export function run(cmd, args, { cwd, durationSec, onProgress, keepStderr = false, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let stdout = '';
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (d) => {
      if (binary) chunks.push(d);
      else stdout += d;
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      if (!keepStderr && stderr.length > 64_000) stderr = stderr.slice(-32_000);
      if (onProgress && durationSec) {
        const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          onProgress(Math.min(99, Math.round((t / durationSec) * 100)));
        }
      }
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error(`"${cmd}" topilmadi. ffmpeg o‘rnatilganini va PATH ichida ekanini tekshiring.`));
      else reject(err);
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: binary ? Buffer.concat(chunks) : stdout, stderr });
      else reject(new Error(`${cmd} xatosi (kod ${code}):\n${stderr.split('\n').slice(-12).join('\n')}`));
    });
  });
}

export function ffmpeg(args, opts) {
  return run(FFMPEG, ['-hide_banner', '-y', ...args], opts);
}

export async function probe(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(stdout);
  const streams = info.streams || [];
  // MP3 ichidagi muqova rasmi ham "video" oqim sifatida ko'rinadi — uni hisobga olmaymiz.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(info.format?.duration) || 0,
    width: video?.width || null,
    height: video?.height || null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

/** Har 0.1 soniyadagi qisqa muddatli balandlik (LUFS) egri chizig'i. */
export async function loudnessCurve(file) {
  const { stderr } = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128', '-f', 'null', '-'], {
    keepStderr: true,
  });
  const points = [];
  for (const line of stderr.split('\n')) {
    const m = line.match(/t:\s*([\d.]+)\s+TARGET:.*?M:\s*(-?[\d.]+)/);
    if (m) points.push({ t: Number(m[1]), m: Number(m[2]) });
  }
  return points;
}

/**
 * Qo'shiqning eng kuchli (eng baland, odatda naqarot) qismini topadi.
 * Natija — Shorts uchun parcha boshlanadigan soniya.
 */
export function bestWindow(curve, totalSec, lengthSec, skipStartSec = 5) {
  if (totalSec <= lengthSec + 2) return 0;
  const seconds = Math.floor(totalSec);
  const energy = new Array(seconds).fill(0);
  const counts = new Array(seconds).fill(0);
  for (const p of curve) {
    const i = Math.floor(p.t);
    if (i < seconds && p.m > -70) {
      energy[i] += 10 ** (p.m / 10);
      counts[i] += 1;
    }
  }
  const perSec = energy.map((e, i) => (counts[i] ? e / counts[i] : 0));
  const len = Math.floor(lengthSec);
  const first = Math.min(Math.ceil(skipStartSec), Math.max(0, seconds - len - 2));
  const last = Math.max(first, seconds - len - 2);
  let windowSum = 0;
  for (let i = first; i < first + len; i++) windowSum += perSec[i] || 0;
  let best = first;
  let bestSum = windowSum;
  for (let start = first + 1; start <= last; start++) {
    windowSum += (perSec[start + len - 1] || 0) - (perSec[start - 1] || 0);
    if (windowSum > bestSum) {
      bestSum = windowSum;
      best = start;
    }
  }
  return best;
}

/** Bir-birini qoplamaydigan eng kuchli `count` ta parcha (bitta qo'shiqdan bir nechta Shorts uchun). */
export function bestWindows(curve, totalSec, lengthSec, count, skipStartSec = 5) {
  if (totalSec <= lengthSec + 2) return [0];
  const perSec = energyPerSecond(curve, totalSec);
  const len = Math.floor(lengthSec);
  const first = Math.min(Math.ceil(skipStartSec), Math.max(0, perSec.length - len - 2));
  const last = Math.max(first, perSec.length - len - 2);
  return pickWindows(perSec, len, count, first, last);
}

/**
 * Har soniya bahosi (perSec) bo'yicha qoplanmaydigan `count` ta oynani tanlaydi —
 * dinamik dasturlash bilan umumiy bahoni maksimal qiladi.
 */
export function pickWindows(perSec, len, count, first = 0, last = perSec.length - len) {
  const sums = [];
  for (let s = first; s <= last; s++) {
    let sum = 0;
    for (let i = s; i < s + len; i++) sum += perSec[i] || 0;
    sums.push({ start: s, sum });
  }
  const n = sums.length;
  if (!n) return [0];
  const k = Math.max(1, Math.min(count, Math.floor((last - first) / len) + 1));
  const prevIdx = sums.map((_, i) => {
    let j = i - 1;
    while (j >= 0 && sums[j].start > sums[i].start - len) j--;
    return j;
  });
  const f = Array.from({ length: k + 1 }, () => new Array(n).fill(-Infinity));
  const take = Array.from({ length: k + 1 }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) f[0][i] = 0;
  for (let c = 1; c <= k; c++) {
    for (let i = 0; i < n; i++) {
      const skip = i > 0 ? f[c][i - 1] : -Infinity;
      const before = prevIdx[i] >= 0 ? f[c - 1][prevIdx[i]] : c === 1 ? 0 : -Infinity;
      const withIt = before === -Infinity ? -Infinity : before + sums[i].sum;
      if (withIt > skip) {
        f[c][i] = withIt;
        take[c][i] = true;
      } else {
        f[c][i] = skip;
      }
    }
  }
  let c = k;
  while (c > 0 && f[c][n - 1] === -Infinity) c--;
  const chosen = [];
  let i = n - 1;
  while (c > 0 && i >= 0) {
    if (take[c][i]) {
      chosen.push(sums[i].start);
      i = prevIdx[i];
      c--;
    } else {
      i--;
    }
  }
  return chosen.sort((x, y) => x - y);
}

export function energyPerSecond(curve, totalSec) {
  const seconds = Math.floor(totalSec);
  const energy = new Array(seconds).fill(0);
  const counts = new Array(seconds).fill(0);
  for (const p of curve) {
    const i = Math.floor(p.t);
    if (i < seconds && p.m > -70) {
      energy[i] += 10 ** (p.m / 10);
      counts[i] += 1;
    }
  }
  return energy.map((e, i) => (counts[i] ? e / counts[i] : 0));
}

export async function checkFfmpeg() {
  try {
    const { stdout } = await run(FFMPEG, ['-hide_banner', '-filters']);
    const missing = ['ass', 'showwaves', 'ebur128', 'boxblur', 'gradients'].filter((f) => !new RegExp(`\\s${f}\\s`).test(stdout));
    return { ok: missing.length === 0, missing };
  } catch (err) {
    return { ok: false, error: err.message, missing: [] };
  }
}
