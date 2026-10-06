// Interfeys tili: o'zbekcha (asl), inglizcha, ruscha.
// Dastur matnlari o'zbekcha yozilgan; tanlangan tilda ekrandagi matn lug'at bo'yicha almashtiriladi.
// Lug'atda yo'q matn (masalan, foydalanuvchi yozgan sarlavha) o'zgarmay qoladi.
import { EN, RU } from './i18n-dict.js';

const DICTS = { en: EN, ru: RU };
let lang = 'uz';
try {
  lang = localStorage.getItem('ytm-lang') || 'uz';
} catch {
  // brauzer xotirasi yopiq — o'zbekcha qoladi
}
if (!DICTS[lang]) lang = 'uz';

export const getLang = () => lang;

export function setLang(next) {
  try {
    localStorage.setItem('ytm-lang', next);
  } catch {
    // e'tiborsiz
  }
  location.reload();
}

// Raqamlar o'rniga {0}, {1}… qo'yib qidirish: "12 ta sahna" -> "{0} ta sahna"
const NUM = /\d+(?:[.,:]\d+)*/g;

function lookup(dict, key) {
  if (dict[key] !== undefined) return dict[key];
  const nums = key.match(NUM);
  if (!nums) return null;
  let i = 0;
  const tpl = key.replace(NUM, () => `{${i++}}`);
  const hit = dict[tpl];
  return hit === undefined ? null : hit.replace(/\{(\d+)\}/g, (_, n) => nums[Number(n)] ?? '');
}

/** Bitta matnni tarjima qiladi (bosh va oxiridagi bo'shliqlar saqlanadi). */
export function t(text) {
  if (lang === 'uz' || text == null) return text;
  const s = String(text);
  const core = s.trim();
  if (!core || !/[A-Za-zʻ‘’']/.test(core)) return s;
  const dict = DICTS[lang];
  let out = lookup(dict, core);
  if (out == null) {
    // Boshidagi emoji/belgi alohida: "📊 Boshqaruv paneli" -> "📊 " + tarjima
    const m = /^([^\p{L}\p{N}]+)(.+)$/u.exec(core);
    if (m) {
      const rest = lookup(dict, m[2]);
      if (rest != null) out = m[1] + rest;
    }
  }
  if (out == null) {
    const m = /^(.+?)([\s:.,!?…—–-]+)$/u.exec(core);
    if (m) {
      const head = lookup(dict, m[1]);
      if (head != null) out = head + m[2];
    }
  }
  if (out == null) {
    // "Yorliq: qiymat" — "Ulangan: Overtone AI" yoki "Overtone AI: YouTube’ga ulangan"
    const m = /^([^:]+):\s+(.+)$/u.exec(core);
    if (m) {
      const lp = /^([^\p{L}\p{N}]*)(.*)$/u.exec(m[1]);
      const lt = lookup(dict, `${lp[2]}:`);
      const label = lt == null ? null : lp[1] + lt;
      const value = lookup(dict, m[2]);
      if (label != null) out = `${label} ${value ?? m[2]}`;
      else if (value != null) {
        const pre = /^([^\p{L}\p{N}]*)(.*)$/u.exec(m[1]);
        out = `${pre[1]}${pre[2]}: ${value}`;
      }
    }
  }
  if (out == null) {
    // "Overtone AI · FIGHTDOMAIN — kuniga bittadan video": nomlar qoladi, izoh tarjima qilinadi
    const m = /^(.+?)\s+(—\s.+)$/u.exec(core);
    const tail = m && lookup(dict, m[2]);
    if (tail != null) out = `${m[1]} ${tail}`;
  }
  if (out == null) return s;
  return s.replace(core, out);
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
const ATTRS = ['placeholder', 'title', 'aria-label'];

function skipped(el) {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.hasAttribute?.('data-no-i18n') || e.isContentEditable) return true;
  }
  return false;
}

/** Element ichidagi barcha matn va atributlarni tarjima qiladi. */
export function translateTree(root) {
  if (lang === 'uz' || !root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (!skipped(root.parentElement)) {
      const v = t(root.nodeValue);
      if (v !== root.nodeValue) root.nodeValue = v;
    }
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || (skipped(root) && root.tagName !== 'TEXTAREA')) return;
  if (root.tagName === 'TEXTAREA') {
    // Ichidagi matn — foydalanuvchiniki; faqat izohlar tarjima qilinadi
    for (const at of ATTRS) {
      const old = root.getAttribute(at);
      if (old && t(old) !== old) root.setAttribute(at, t(old));
    }
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (SKIP.has(n.tagName) || n.hasAttribute('data-no-i18n')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const els = [root];
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) (n.nodeType === Node.TEXT_NODE ? texts : els).push(n);
  for (const n of texts) {
    const v = t(n.nodeValue);
    if (v !== n.nodeValue) n.nodeValue = v;
  }
  // Matn maydonlarining ichki matni (foydalanuvchi yozgani) tegilmaydi, faqat izoh (placeholder) tarjima qilinadi
  for (const ta of root.querySelectorAll('textarea[placeholder]')) els.push(ta);
  for (const el of els) {
    for (const a of ATTRS) {
      const old = el.getAttribute?.(a);
      if (old) {
        const v = t(old);
        if (v !== old) el.setAttribute(a, v);
      }
    }
    // Tugma ko'rinishidagi input'lar
    if (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.type) && el.value) el.value = t(el.value);
  }
}

/** Sahifa o'zgarganda yangi qo'shilgan matnni avtomatik tarjima qiladi. */
export function startI18n() {
  document.documentElement.lang = lang;
  if (lang === 'uz') return;
  const nativeConfirm = window.confirm.bind(window);
  const nativePrompt = window.prompt.bind(window);
  const nativeAlert = window.alert.bind(window);
  window.confirm = (m) => nativeConfirm(t(m));
  window.prompt = (m, d) => nativePrompt(t(m), d);
  window.alert = (m) => nativeAlert(t(m));
  document.title = t(document.title);
  translateTree(document.body);
  let busy = false;
  new MutationObserver((list) => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === 'characterData') translateTree(m.target);
        else if (m.type === 'attributes') translateTree(m.target);
        else for (const n of m.addedNodes) translateTree(n);
      }
    } finally {
      busy = false;
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
