// ASS subtitr fayllarini yasash. Barcha matn (qo'shiq matni, subtitr, sarlavha, prevyu yozuvi)
// libass orqali chiziladi — Windows, macOS va Linuxda bir xil ishlaydi.

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

export function assTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const whole = Math.floor(s % 60);
  const cs = Math.min(99, Math.round((s - Math.floor(s)) * 100));
  return `${h}:${pad(m)}:${pad(whole)}.${pad(cs)}`;
}

/** '#rrggbb' -> ASS formatidagi &HAABBGGRR (alpha: 0 = to'liq ko'rinadi, 255 = shaffof) */
export function assColor(hex, alpha = 0) {
  const clean = String(hex || '#ffffff').replace('#', '').padEnd(6, 'f');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${pad(alpha.toString(16).toUpperCase())}${b}${g}${r}`.toUpperCase();
}

export function escapeText(text) {
  return String(text ?? '')
    .replace(/[{}]/g, '')
    .replace(/\\/g, '')
    .replace(/\r?\n/g, '\\N');
}

export function style({
  name,
  font = 'Arial',
  size = 48,
  color = '#ffffff',
  secondary = null,
  outline = '#000000',
  back = '#000000',
  backAlpha = 128,
  outlineWidth = 3,
  shadow = 0,
  bold = true,
  align = 2,
  marginV = 60,
  marginH = 60,
  boxed = false,
}) {
  // BorderStyle 3 (qutili matn) da quti rangi OutlineColour'dan olinadi.
  const borderStyle = boxed ? 3 : 1;
  return [
    `Style: ${name}`,
    font,
    size,
    assColor(color),
    assColor(secondary || color),
    boxed ? assColor(back, backAlpha) : assColor(outline),
    assColor(back, backAlpha),
    bold ? -1 : 0,
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    borderStyle,
    outlineWidth,
    shadow,
    align,
    marginH,
    marginH,
    marginV,
    1,
  ].join(',');
}

export function buildAss({ width, height, styles, events }) {
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  for (const e of events) {
    if (e.end <= e.start) continue;
    const prefix = e.tags ? `{${e.tags}}` : '';
    // raw: matn ichida allaqachon ASS teglari bor (masalan, karaoke \\kf)
    const body = e.raw ? e.text : escapeText(e.text);
    lines.push(`Dialogue: ${e.layer || 0},${assTime(e.start)},${assTime(e.end)},${e.style},,0,0,0,,${prefix}${body}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Karaoke: so'zlar aytilish vaqtiga qarab birma-bir yonadi (SecondaryColour -> PrimaryColour). */
export function karaokeText(text, durationSec) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, w) => sum + w.length, 0) || 1;
  const cs = Math.max(20, Math.round(durationSec * 100 * 0.92));
  return words.map((w) => `{\\kf${Math.max(5, Math.round((cs * w.length) / total))}}${escapeText(w)}`).join(' ');
}
