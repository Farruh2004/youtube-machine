import { db } from '../store.js';

export function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const v = String(item || '').trim();
    const key = v.toLowerCase();
    if (v && !seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/** YouTube cheklovlari: teglar umumiy 500 belgidan oshmasligi kerak. */
export function limitTags(tags, maxChars = 450) {
  const out = [];
  let total = 0;
  for (const t of uniq(tags).map((x) => x.replace(/[<>,]/g, '').slice(0, 60))) {
    if (total + t.length + 1 > maxChars) break;
    out.push(t);
    total += t.length + 1;
  }
  return out;
}

export function buildDescription(channel, body, hashtags = []) {
  return [body, hashtags.filter(Boolean).join(' '), channel.descriptionFooter].filter((x) => x && x.trim()).join('\n\n').slice(0, 4900);
}

export function cleanTitle(title, fallback) {
  return String(title || fallback || 'Untitled').replace(/[<>]/g, '').trim().slice(0, 100);
}

/** SEO maydonlarini yozadi, lekin foydalanuvchi qo'lda tahrirlagan natijaga tegmaydi. */
export function applyMeta(project, id, kind, meta) {
  const existing = project.outputs?.find((o) => o.id === id);
  if (existing?.metaManual) return upsertOutput(project, id, { kind });
  return upsertOutput(project, id, { kind, ...meta });
}

/** Natija (tayyor video) yozuvini yaratadi yoki yangilaydi. */
export function upsertOutput(project, id, fields) {
  project.outputs ||= [];
  let out = project.outputs.find((o) => o.id === id);
  if (!out) {
    const channel = db().channels.find((c) => c.id === project.channelId);
    out = {
      id,
      kind: fields.kind,
      title: '',
      description: '',
      tags: [],
      file: null,
      thumbnail: null,
      duration: null,
      publishAt: null,
      privacy: channel?.defaultPrivacy || 'public',
      aiDisclosure: Boolean(channel?.aiDisclosure),
      upload: { status: 'none', videoId: null, error: null, progress: 0 },
    };
    project.outputs.push(out);
  }
  Object.assign(out, fields);
  return out;
}

export function hex(color) {
  return `0x${String(color || '#ffffff').replace('#', '')}`;
}
