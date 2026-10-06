import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = process.env.YTM_DATA_DIR || path.join(ROOT, 'data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const PUBLIC_DIR = path.join(ROOT, 'public');

// Faqat shu kompyuterdan kirish mumkin: dastur API kalitlari va kanal tokenlarini saqlaydi.
export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.PORT || 4300);
// Serverda (sayt sifatida) ishlaganda tashqi manzil: masalan PUBLIC_URL=https://studio.example.com
// Google kirishdan keyin shu manzilga qaytaradi (Google Cloud'da "Web application" kaliti kerak).
export const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
export const BASE_URL = PUBLIC_URL || `http://127.0.0.1:${PORT}`;

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
