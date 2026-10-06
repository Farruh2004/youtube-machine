// Sahna rasmlarini yaratish: personaj rasmi namuna sifatida yuboriladi, AI uni har sahnada bir xil chizadi.
// Provayderlar: OpenAI (gpt-image-1, /v1/images/edits) yoki Google Gemini (gemini-2.5-flash-image).
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../store.js';
import { addCost, assertBudget } from '../costs.js';

// Testlarda soxta server ishlatish uchun almashtirsa bo'ladi
export const OPENAI_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com';
import { geminiGenerate, GEMINI_BASE } from './gemini.js';

export { GEMINI_BASE };

export function imageProviderReady() {
  const s = db().settings;
  if (s.imageProvider === 'gemini') return Boolean(s.geminiKey);
  if (s.imageProvider === 'openai') return Boolean(s.openaiKey);
  return false;
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * Personaj namunasi bilan bitta rasm yaratadi va `outFile` ga PNG qilib yozadi.
 * orientation: 'landscape' (uzun video) yoki 'portrait' (Shorts).
 */
export async function generateSceneImage({ prompt, referenceFiles = [], orientation = 'landscape', outFile, cost = {} }) {
  const s = db().settings;
  if (!imageProviderReady()) throw new Error('Rasm yaratish uchun kalit sozlanmagan.');
  assertBudget();
  let buffer;
  if (s.imageProvider === 'gemini') {
    const parts = referenceFiles.map((f) => ({ inlineData: { mimeType: MIME[path.extname(f).toLowerCase()] || 'image/png', data: fs.readFileSync(f).toString('base64') } }));
    parts.push({ text: prompt });
    const { data, model, error } = await geminiGenerate({
      kind: 'image',
      settingKey: 'geminiImageModel',
      fallback: 'gemini-2.5-flash-image',
      body: {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: orientation === 'portrait' ? '9:16' : '16:9' } },
      },
    });
    if (error) throw new Error(`Gemini rasm: ${error}`);
    const img = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
    if (!img) throw new Error('Gemini rasm qaytarmadi (so‘rov rad etilgan bo‘lishi mumkin).');
    buffer = Buffer.from(img.inlineData.data, 'base64');
    addCost({ kind: 'image', amount: Number(s.prices.geminiImage) || 0, note: model, ...cost });
  } else {
    const size = orientation === 'portrait' ? '1024x1536' : '1536x1024';
    const send = async (withFidelity) => {
      const form = new FormData();
      form.append('model', s.openaiImageModel || 'gpt-image-1');
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('quality', s.imageQuality || 'medium');
      form.append('n', '1');
      if (withFidelity) form.append('input_fidelity', 'high');
      for (const f of referenceFiles) form.append('image[]', await fs.openAsBlob(f, { type: MIME[path.extname(f).toLowerCase()] || 'image/png' }), path.basename(f));
      const endpoint = referenceFiles.length ? 'edits' : 'generations';
      const res = await fetch(`${OPENAI_BASE}/v1/images/${endpoint}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${s.openaiKey}` },
        body: referenceFiles.length ? form : JSON.stringify({ model: s.openaiImageModel || 'gpt-image-1', prompt, size, quality: s.imageQuality || 'medium', n: 1 }),
        ...(referenceFiles.length ? {} : { headers: { authorization: `Bearer ${s.openaiKey}`, 'content-type': 'application/json' } }),
      });
      return { res, data: await res.json().catch(() => ({})) };
    };
    let { res, data } = await send(true);
    // Ba'zi modellar input_fidelity ni qo'llamaydi — o'shanda usiz qayta urinamiz
    if (!res.ok && /input_fidelity/i.test(data.error?.message || '')) ({ res, data } = await send(false));
    if (!res.ok) throw new Error(`OpenAI rasm: ${data.error?.message || res.status}`);
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI rasm qaytarmadi.');
    buffer = Buffer.from(b64, 'base64');
    const price = { low: 0.016, medium: 0.063, high: 0.25 }[s.imageQuality || 'medium'];
    addCost({ kind: 'image', amount: Number(s.prices.openaiImage) || price, note: `${s.openaiImageModel || 'gpt-image-1'} ${size} ${s.imageQuality || 'medium'}`, ...cost });
  }
  fs.writeFileSync(outFile, buffer);
  return outFile;
}
