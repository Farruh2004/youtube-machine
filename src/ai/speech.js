import fs from 'node:fs';
import path from 'node:path';
import { db } from '../store.js';
import { addCost, assertBudget } from '../costs.js';
import { OPENAI_BASE } from './images.js';
import { geminiGenerate } from './gemini.js';
import { ffmpeg } from '../media/ffmpeg.js';

/** Transkripsiya (Whisper) uchun — OpenAI kaliti. */
export function speechReady() {
  return Boolean(db().settings.openaiKey);
}

/** Diktor ovozi uchun: tanlangan provayder (OpenAI yoki ElevenLabs) sozlanganmi. */
export function ttsReady() {
  const s = db().settings;
  if (s.ttsProvider === 'elevenlabs') return Boolean(s.elevenKey && s.elevenVoiceId);
  if (s.ttsProvider === 'gemini') return Boolean(s.geminiKey);
  return Boolean(s.openaiKey);
}

export const GEMINI_VOICES = ['Puck', 'Kore', 'Charon', 'Fenrir', 'Aoede', 'Zephyr', 'Leda', 'Orus', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

/** Google AI Studio (Gemini) ovozi: uslub ko'rsatmasi matn bilan birga yuboriladi, javob — 24 kHz PCM. */
async function geminiSpeech(s, text, instructions, outMp3) {
  const prompt = instructions ? `${instructions}\nRead the following text aloud exactly as written, without adding anything:\n${text}` : text;
  const { data, error } = await geminiGenerate({
    kind: 'tts',
    settingKey: 'geminiTtsModel',
    fallback: 'gemini-2.5-flash-preview-tts',
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: s.geminiVoice || 'Puck' } } } },
    },
  });
  if (error) throw new Error(`Gemini ovoz: ${error}`);
  const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new Error('Gemini ovoz qaytarmadi — qayta urinib ko‘ring.');
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  const pcm = `${outMp3}.pcm`;
  fs.writeFileSync(pcm, Buffer.from(part.inlineData.data, 'base64'));
  await ffmpeg(['-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', pcm, '-c:a', 'libmp3lame', '-q:a', '2', outMp3]);
  fs.rmSync(pcm, { force: true });
}

async function ttsChunk(s, text, instructions) {
  if (s.ttsProvider === 'elevenlabs') {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(s.elevenVoiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': s.elevenKey, accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: s.elevenModel || 'eleven_multilingual_v2' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`ElevenLabs: ${err.detail?.message || err.detail || res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  const body = { model: s.ttsModel, voice: s.ttsVoice, input: text, response_format: 'mp3' };
  if (instructions && /gpt-4o/.test(s.ttsModel)) body.instructions = instructions;
  const res = await fetch(`${OPENAI_BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.openaiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI TTS: ${err.error?.message || res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Matnni gaplar bo'yicha API cheklovidan (4096 belgi) kichik bo'laklarga ajratadi. */
export function splitForTts(text, max = 3500) {
  const sentences = String(text).replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*\s*/g) || [];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > max && current) {
      chunks.push(current.trim());
      current = '';
    }
    current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Inglizcha ovoz yaratadi (OpenAI TTS yoki ElevenLabs) va bitta MP3 faylga yig'adi. */
export async function synthesize(text, outFile, { instructions = '', cost = {} } = {}) {
  const s = db().settings;
  if (!ttsReady()) throw new Error('Ovoz uchun kalit sozlanmagan.');
  assertBudget();
  const dir = path.dirname(outFile);
  const parts = [];
  const chunks = splitForTts(text);
  for (let i = 0; i < chunks.length; i++) {
    const part = path.join(dir, `voice-part-${i}.mp3`);
    if (s.ttsProvider === 'gemini') await geminiSpeech(s, chunks[i], instructions, part);
    else fs.writeFileSync(part, await ttsChunk(s, chunks[i], instructions));
    parts.push(part);
  }
  if (s.ttsProvider === 'gemini') {
    // ~15 belgi/soniya nutq
    addCost({ kind: 'voice', amount: (text.length / 15 / 60) * (Number(s.prices.geminiTtsPerMin) || 0), note: `${text.length} belgi (Gemini ${s.geminiVoice || 'Puck'})`, ...cost });
  } else {
    const per1M = s.ttsProvider === 'elevenlabs' ? s.prices.elevenPer1MChars : s.prices.ttsPer1MChars;
    addCost({ kind: 'voice', amount: (text.length / 1e6) * per1M, note: `${text.length} belgi (${s.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'})`, ...cost });
  }

  if (parts.length === 1) {
    fs.renameSync(parts[0], outFile);
  } else {
    const list = path.join(dir, 'voice-parts.txt');
    fs.writeFileSync(list, parts.map((p) => `file '${path.basename(p)}'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'voice-parts.txt', '-c:a', 'libmp3lame', '-q:a', '2', path.basename(outFile)], { cwd: dir });
    for (const p of parts) fs.rmSync(p, { force: true });
    fs.rmSync(list, { force: true });
  }
}

/** Qo'shiqdagi vokal qayerda eshitilishini aniqlaydi (Whisper segmentlari). */
export async function transcribeSegments(audioFile, durationSec, { cost = {} } = {}) {
  const s = db().settings;
  if (!speechReady()) throw new Error('Transkripsiya uchun OpenAI kaliti sozlanmagan.');
  assertBudget();
  const dir = path.dirname(audioFile);
  const small = path.join(dir, 'transcribe.mp3');
  // 25 MB chegarasiga sig'ishi uchun mono 64 kbit/s ga o'tkazamiz.
  await ffmpeg(['-i', audioFile, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-b:a', '64k', small]);
  const form = new FormData();
  form.append('file', await fs.openAsBlob(small), 'audio.mp3');
  form.append('model', s.transcribeModel);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  const res = await fetch(`${OPENAI_BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${s.openaiKey}` },
    body: form,
  });
  const data = await res.json();
  fs.rmSync(small, { force: true });
  if (!res.ok) throw new Error(`OpenAI transkripsiya: ${data.error?.message || res.status}`);
  addCost({ kind: 'transcribe', amount: (durationSec / 60) * s.prices.transcribePerMin, note: `${Math.round(durationSec)} s audio`, ...cost });
  return (data.segments || []).map((seg) => ({ start: seg.start, end: seg.end, text: seg.text.trim() }));
}

/** Nutqdagi har so'zning vaqti (Whisper) — subtitrlarni ovozga aniq moslash uchun. */
export async function transcribeWords(audioFile, durationSec, { cost = {} } = {}) {
  const s = db().settings;
  if (!speechReady()) throw new Error('Transkripsiya uchun OpenAI kaliti sozlanmagan.');
  assertBudget();
  const form = new FormData();
  form.append('file', await fs.openAsBlob(audioFile), path.basename(audioFile));
  form.append('model', s.transcribeModel);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const res = await fetch(`${OPENAI_BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${s.openaiKey}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI transkripsiya: ${data.error?.message || res.status}`);
  addCost({ kind: 'transcribe', amount: (durationSec / 60) * s.prices.transcribePerMin, note: `${Math.round(durationSec)} s (so‘z vaqtlari)`, ...cost });
  return { text: String(data.text || '').trim(), words: (data.words || []).map((w) => ({ word: String(w.word).trim(), start: Number(w.start), end: Number(w.end) })) };
}
