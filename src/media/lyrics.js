// Qo'shiq matnini vaqt bo'yicha joylashtirish.
// Ustuvorlik: 1) LRC vaqtlari ([01:23.45] qator)  2) Whisper segmentlari  3) teng taqsimlash.

const LRC_LINE = /^\s*\[(\d+):(\d+(?:[.:]\d+)?)\]\s*(.*)$/;

export function isLrc(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return false;
  return lines.filter((l) => LRC_LINE.test(l)).length / lines.length > 0.6;
}

export function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(LRC_LINE);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2].replace(':', '.'));
    const body = m[3].trim();
    if (body) out.push({ t, text: body });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function toLrc(timed) {
  return timed
    .map(({ t, text }) => {
      const m = Math.floor(t / 60);
      const s = (t - m * 60).toFixed(2).padStart(5, '0');
      return `[${String(m).padStart(2, '0')}:${s}] ${text}`;
    })
    .join('\n');
}

/** Suno matnidagi [Verse], [Chorus] kabi belgilar va bo'sh qatorlarni olib tashlaydi. */
export function cleanLyrics(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[^\]]*\]$/.test(l) && !/^\([^)]*\)$/.test(l));
}

function weight(line) {
  return Math.max(4, line.length);
}

/** Qatorlarni berilgan nutq oraliqlari bo'ylab uzunligiga qarab taqsimlaydi. */
export function distribute(lines, regions) {
  const speech = regions.filter((r) => r.end > r.start);
  if (!lines.length || !speech.length) return [];
  const totalSpeech = speech.reduce((s, r) => s + (r.end - r.start), 0);
  const totalWeight = lines.reduce((s, l) => s + weight(l), 0);
  const out = [];
  let acc = 0;
  for (const line of lines) {
    out.push({ t: speechToTime(speech, (acc / totalWeight) * totalSpeech), text: line });
    acc += weight(line);
  }
  return out;
}

function speechToTime(regions, offset) {
  let left = offset;
  for (const r of regions) {
    const len = r.end - r.start;
    if (left <= len) return Math.round((r.start + left) * 100) / 100;
    left -= len;
  }
  return regions[regions.length - 1].end;
}

/** Vaqtlangan qatorlardan subtitr hodisalarini yasaydi (har qator ko'pi bilan maxSec turadi). */
export function timedToEvents(timed, durationSec, maxSec = 8) {
  return timed.map((line, i) => {
    const next = timed[i + 1]?.t ?? durationSec;
    return { start: line.t, end: Math.min(next, line.t + maxSec, durationSec), text: line.text, next: timed[i + 1]?.text || '' };
  });
}
