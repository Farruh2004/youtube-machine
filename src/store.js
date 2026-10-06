import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, PROJECTS_DIR } from './config.js';

const DB_FILE = path.join(DATA_DIR, 'db.json');

export const DEFAULT_SETTINGS = {
  // Matn (ssenariy, SEO, tahlil) uchun: 'anthropic' | 'openai' | 'gemini' | 'none'
  textProvider: 'anthropic',
  anthropicKey: '',
  anthropicModel: 'claude-haiku-4-5',
  openaiKey: '',
  openaiTextModel: 'gpt-4o-mini',
  // Google Gemini (matn uchun muqobil): aistudio.google.com dan kalit
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  // Sahna rasmlari (tushuntiruvchi kanal): 'openai' (gpt-image-1) yoki 'gemini'
  imageProvider: 'openai',
  openaiImageModel: 'gpt-image-1',
  geminiImageModel: 'gemini-2.5-flash-image',
  imageQuality: 'medium',
  // Ovoz va qo'shiq matnini vaqtlash OpenAI orqali
  ttsModel: 'gpt-4o-mini-tts',
  ttsVoice: 'onyx',
  // 'openai', 'elevenlabs' (o'z ovozingiz kloni) yoki 'gemini' (Google AI Studio ovozlari)
  ttsProvider: 'openai',
  geminiTtsModel: 'gemini-2.5-flash-preview-tts',
  geminiVoice: 'Puck',
  elevenKey: '',
  elevenVoiceId: '',
  elevenModel: 'eleven_multilingual_v2',
  transcribeModel: 'whisper-1',
  // YouTube
  googleClientId: '',
  googleClientSecret: '',
  youtubeApiKey: '',
  uploadLeadHours: 3,
  // Telegram bot: @BotFather dan olingan token; chat ID birinchi /start xabarida avtomatik bog'lanadi
  telegramToken: '',
  telegramChatId: '',
  // Boshqa xizmatlar kalitlari (kelajakdagi integratsiyalar uchun): [{ name, value }]
  customKeys: [],
  // GitHub token: yopiq repozitoriydan dasturni yangilash (yangilash.bat) uchun, faqat o'qish huquqi
  githubToken: '',
  // Byudjet
  monthlyBudget: 100,
  fixedMonthly: [],
  // Taxminiy narxlar (USD). Xizmat narxlari o'zgarsa, Sozlamalarda yangilang.
  prices: {
    llmInputPer1M: 1,
    llmOutputPer1M: 5,
    ttsPer1MChars: 15,
    elevenPer1MChars: 200,
    transcribePerMin: 0.006,
    // Bitta rasm narxi; 0 = sifatga qarab avtomatik (OpenAI: low 0.016 / medium 0.063 / high 0.25)
    openaiImage: 0,
    geminiImage: 0.039,
    // Gemini ovozi: 1 daqiqa audio (~1500 audio token × $10/1M)
    geminiTtsPerMin: 0.015,
    // ElevenLabs ovoz effekti (bitta, ~2 s)
    elevenSfx: 0.02,
  },
  // Montaj
  renderPreset: 'veryfast',
  fontName: 'Arial',
};

// Namuna kanallar: yangi o'rnatishda kanal bo'lmaydi (har kim o'zinikini yaratadi).
// Testlar va namoyish uchun YTM_SAMPLE_CHANNELS=1 bilan yoqiladi.
export const DEFAULT_CHANNELS = [
  {
    id: 'overtone',
    name: 'Overtone AI',
    type: 'music',
    handle: '@Overtone_AI',
    publishTime: '18:00',
    colors: { primary: '#8b5cf6', secondary: '#2563eb' },
    shortsSeconds: 40,
    shortsPerSong: 3,
    karaoke: true,
    translateLyrics: true,
    bgMotion: true,
    defaultPrivacy: 'public',
    aiDisclosure: true,
    categoryId: '10',
    language: 'en',
    baseTags: ['AI music', 'Overtone AI', 'Suno'],
    descriptionFooter: '🎵 This song was created with AI (Suno) and produced by Overtone AI.\n🔔 Subscribe for a new song every day.',
    youtube: null,
  },
  {
    id: 'fightdomain',
    name: 'FIGHTDOMAIN',
    type: 'fight',
    handle: '@FIGHTDOMAIN-x3q',
    publishTime: '19:00',
    colors: { primary: '#ef4444', secondary: '#111827' },
    shortsSeconds: 58,
    fightEffects: true,
    smartCrop: true,
    defaultPrivacy: 'public',
    aiDisclosure: false,
    categoryId: '17',
    language: 'en',
    baseTags: ['fight breakdown', 'MMA', 'boxing', 'FIGHTDOMAIN'],
    descriptionFooter: '🥊 Original breakdown and commentary by FIGHTDOMAIN.\n🔔 Subscribe for daily fight analysis.',
    youtube: null,
  },
];

let state = null;

export function load() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  let raw = {};
  if (fs.existsSync(DB_FILE)) raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  state = {
    settings: {
      ...DEFAULT_SETTINGS,
      ...raw.settings,
      prices: { ...DEFAULT_SETTINGS.prices, ...raw.settings?.prices },
    },
    channels: raw.channels || (process.env.YTM_SAMPLE_CHANNELS ? structuredClone(DEFAULT_CHANNELS) : []),
    projects: raw.projects || [],
    costs: raw.costs || [],
    sources: raw.sources || [],
    keyChecks: raw.keyChecks || {},
    diagnoses: raw.diagnoses || {},
    competitors: raw.competitors || [],
    ideas: raw.ideas || [],
    plannedChannels: raw.plannedChannels || [],
  };
  save();
  return state;
}

export function db() {
  if (!state) load();
  return state;
}

export function save() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

export function projectDir(id) {
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getProject(id) {
  return db().projects.find((p) => p.id === id);
}

export function getChannel(id) {
  return db().channels.find((c) => c.id === id);
}
