// YouTube Machine — sayt rejimi uchun kirish xizmati (gateway).
// - Ro'yxatdan o'tish, kirish, chiqish (parollar scrypt bilan, sessiyalar cookie'da).
// - Har foydalanuvchiga dasturning alohida nusxasi (o'z papkasi, o'z kalitlari, o'z videolari).
// - Barcha so'rovlar foydalanuvchining o'z nusxasiga uzatiladi; boshqasinikini hech kim ko'ra olmaydi.
// Kutubxonasiz, oddiy Node.js. Ishga tushirish: node gateway/server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { page, loginPage, signupPage, adminPage } from './pages.js';

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.GW_PORT || 8080);
const HOST = process.env.GW_HOST || '0.0.0.0';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
const SECURE = PUBLIC_URL.startsWith('https://');
const DATA = path.resolve(process.env.GW_DATA || path.join(APP_DIR, 'data-site'));
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const INVITE_CODE = String(process.env.INVITE_CODE || '').trim();
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== '0';
const MAX_USERS = Number(process.env.MAX_USERS || 0);
const BASE_PORT = Number(process.env.INSTANCE_BASE_PORT || 5100);
const LAZY = process.env.GW_LAZY === '1';
const SESSION_DAYS = 30;
const COOKIE = 'ytm_session';

fs.mkdirSync(path.join(DATA, 'users'), { recursive: true });
const STATE_FILE = path.join(DATA, 'gateway.json');
const secretFile = path.join(DATA, 'secret.txt');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

// ---------- Ma'lumotlar ----------
let state = { users: [], sessions: {} };
if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
function persist() {
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const isAdmin = (u) => Boolean(u) && (ADMIN_EMAIL ? u.email === ADMIN_EMAIL : u.id === state.users[0]?.id);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex') };
}
function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function newSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  state.sessions[sha(token)] = { userId: user.id, exp: Date.now() + SESSION_DAYS * 86400_000 };
  user.lastLogin = new Date().toISOString();
  persist();
  return token;
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function currentUser(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const s = state.sessions[sha(token)];
  if (!s || s.exp < Date.now()) return null;
  const u = state.users.find((x) => x.id === s.userId);
  return u && !u.disabled ? u : null;
}
const sessionCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;

// Kirish urinishlari cheklovi: bitta manzildan 15 daqiqada 10 ta
const attempts = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 10;
}

// ---------- Foydalanuvchi nusxalari ----------
const instances = new Map(); // userId -> { child, port, ready, lastUsed }
const userDir = (u) => path.join(DATA, 'users', u.id);

function waitReady(port, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const r = http.get({ host: '127.0.0.1', port, path: '/api/dashboard', headers: { 'x-gateway-secret': SECRET, host: new URL(PUBLIC_URL).host } }, (res) => {
        res.resume();
        resolve();
      });
      r.on('error', () => (Date.now() > until ? reject(new Error('Dastur ishga tushmadi')) : setTimeout(tryOnce, 250)));
    };
    tryOnce();
  });
}

async function ensureInstance(user) {
  let inst = instances.get(user.id);
  if (inst?.ready) {
    inst.lastUsed = Date.now();
    return inst;
  }
  if (inst?.starting) return inst.starting;
  inst = { port: user.port, ready: false, lastUsed: Date.now() };
  instances.set(user.id, inst);
  const dir = userDir(user);
  fs.mkdirSync(dir, { recursive: true });
  const log = fs.openSync(path.join(dir, 'app.log'), 'a');
  inst.child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      YTM_DATA_DIR: dir,
      PORT: String(user.port),
      HOST: '127.0.0.1',
      PUBLIC_URL,
      GATEWAY_SECRET: SECRET,
      APP_PASSWORD: '',
      YTM_SAMPLE_CHANNELS: '',
    },
    stdio: ['ignore', log, log],
  });
  inst.exited = new Promise((resolve) => inst.child.on('exit', resolve));
  inst.child.on('exit', (code) => {
    fs.closeSync(log);
    if (instances.get(user.id) === inst) instances.delete(user.id);
    if (!inst.stopping) {
      console.warn(`⚠️  ${user.email} nusxasi to‘xtadi (kod ${code}) — 5 s dan keyin qayta ishga tushadi`);
      // Jadvaldagi yuklashlar to'xtab qolmasligi uchun o'zi qayta yonadi
      if (!LAZY && !user.disabled) setTimeout(() => ensureInstance(user).catch(() => {}), 5000).unref();
    }
  });
  inst.starting = waitReady(user.port).then(() => {
    inst.ready = true;
    delete inst.starting;
    return inst;
  }).catch((err) => {
    delete inst.starting;
    inst.child.kill();
    throw err;
  });
  return inst.starting;
}

async function stopInstance(userId) {
  const inst = instances.get(userId);
  if (!inst) return;
  inst.stopping = true;
  instances.delete(userId);
  inst.child.kill('SIGTERM');
  await Promise.race([inst.exited, new Promise((r) => setTimeout(r, 10_000))]);
}

// ---------- So'rovlar ----------
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
const form = async (req) => Object.fromEntries(new URLSearchParams(await readBody(req)));
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', ...headers });
  res.end(body);
}
const redirect = (res, to, headers = {}) => send(res, 303, '', { location: to, ...headers });
// Boshqa saytlardan yuborilgan formalarni rad etamiz
const sameOrigin = (req) => !req.headers.origin || req.headers.origin === new URL(PUBLIC_URL).origin || req.headers.origin === `http://${req.headers.host}`;

async function handleGateway(req, res, url) {
  const p = url.pathname;
  if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, page('403', '<p>Ruxsat yo‘q</p>'));

  if (p === '/gw/login' && req.method === 'GET') return send(res, 200, loginPage({ signup: ALLOW_SIGNUP }));
  if (p === '/gw/login' && req.method === 'POST') {
    if (limited(clientIp(req))) return send(res, 429, loginPage({ error: 'too_many', signup: ALLOW_SIGNUP }));
    const f = await form(req);
    const email = String(f.email || '').trim().toLowerCase();
    const user = state.users.find((u) => u.email === email);
    if (!user || !checkPassword(user, String(f.password || ''))) return send(res, 401, loginPage({ error: 'bad_login', email, signup: ALLOW_SIGNUP }));
    if (user.disabled) return send(res, 403, loginPage({ error: 'disabled', email, signup: ALLOW_SIGNUP }));
    return redirect(res, '/', { 'set-cookie': sessionCookie(newSession(user), SESSION_DAYS * 86400) });
  }
  if (p === '/gw/signup' && req.method === 'GET') return ALLOW_SIGNUP ? send(res, 200, signupPage({ invite: Boolean(INVITE_CODE) })) : redirect(res, '/gw/login');
  if (p === '/gw/signup' && req.method === 'POST') {
    if (!ALLOW_SIGNUP) return redirect(res, '/gw/login');
    if (limited(clientIp(req))) return send(res, 429, signupPage({ error: 'too_many', invite: Boolean(INVITE_CODE) }));
    const f = await form(req);
    const email = String(f.email || '').trim().toLowerCase();
    const password = String(f.password || '');
    const err = (code) => send(res, 400, signupPage({ error: code, email, invite: Boolean(INVITE_CODE) }));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return err('bad_email');
    if (password.length < 8) return err('short_password');
    if (INVITE_CODE && String(f.invite || '').trim() !== INVITE_CODE) return err('bad_invite');
    if (state.users.some((u) => u.email === email)) return err('exists');
    if (MAX_USERS && state.users.length >= MAX_USERS) return err('full');
    const usedPorts = new Set(state.users.map((u) => u.port));
    let port = BASE_PORT;
    while (usedPorts.has(port)) port++;
    const user = { id: crypto.randomBytes(6).toString('hex'), email, ...hashPassword(password), port, createdAt: new Date().toISOString(), disabled: false };
    state.users.push(user);
    persist();
    return redirect(res, '/', { 'set-cookie': sessionCookie(newSession(user), SESSION_DAYS * 86400) });
  }
  if (p === '/gw/logout') {
    const token = cookies(req)[COOKIE];
    if (token) {
      delete state.sessions[sha(token)];
      persist();
    }
    return redirect(res, '/gw/login', { 'set-cookie': sessionCookie('', 0) });
  }

  const user = currentUser(req);
  if (p === '/gw/me') {
    if (!user) return send(res, 401, '{}', { 'content-type': 'application/json' });
    return send(res, 200, JSON.stringify({ email: user.email, admin: isAdmin(user) }), { 'content-type': 'application/json' });
  }
  if (p.startsWith('/gw/admin')) {
    if (!isAdmin(user)) return redirect(res, '/gw/login');
    const m = /^\/gw\/admin\/users\/([\w]+)\/(disable|enable|restart)$/.exec(p);
    if (m && req.method === 'POST') {
      const target = state.users.find((u) => u.id === m[1]);
      if (target && target.id !== user.id) {
        if (m[2] === 'disable') {
          target.disabled = true;
          await stopInstance(target.id);
          for (const [k, s] of Object.entries(state.sessions)) if (s.userId === target.id) delete state.sessions[k];
        }
        if (m[2] === 'enable') {
          target.disabled = false;
          if (!LAZY) ensureInstance(target).catch(() => {});
        }
        persist();
      }
      if (target && m[2] === 'restart' && !target.disabled) {
        await stopInstance(target.id);
        await ensureInstance(target).catch(() => {});
      }
      return redirect(res, '/gw/admin');
    }
    const rows = state.users.map((u) => ({ id: u.id, email: u.email, createdAt: u.createdAt, lastLogin: u.lastLogin, disabled: u.disabled, running: Boolean(instances.get(u.id)?.ready), me: u.id === user.id }));
    return send(res, 200, adminPage({ rows, invite: Boolean(INVITE_CODE), signup: ALLOW_SIGNUP }));
  }
  return send(res, 404, page('404', '<p>Topilmadi</p>'));
}

function proxy(req, res, inst) {
  const headers = { ...req.headers, 'x-gateway-secret': SECRET, 'x-forwarded-for': clientIp(req) };
  delete headers.cookie; // sessiya cookie'si dasturga kerak emas
  const preq = http.request({ host: '127.0.0.1', port: inst.port, method: req.method, path: req.url, headers }, (pres) => {
    const h = { ...pres.headers };
    res.writeHead(pres.statusCode, h);
    pres.pipe(res);
  });
  preq.on('error', () => {
    if (!res.headersSent) send(res, 502, page('502', '<p>Dastur javob bermadi. Bir necha soniyadan keyin sahifani yangilang.</p>'));
    else res.destroy();
  });
  req.pipe(preq);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/gw/')) return await handleGateway(req, res, url);
    const user = currentUser(req);
    if (!user) {
      const wantsHtml = req.method === 'GET' && String(req.headers.accept || '').includes('text/html');
      if (wantsHtml || url.pathname === '/') return redirect(res, '/gw/login');
      return send(res, 401, JSON.stringify({ error: 'Avval tizimga kiring' }), { 'content-type': 'application/json' });
    }
    const inst = await ensureInstance(user);
    proxy(req, res, inst);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, page('500', '<p>Xato yuz berdi. Qayta urinib ko‘ring.</p>'));
  }
});

// Eskirgan sessiyalarni tozalash
setInterval(() => {
  let changed = false;
  for (const [k, s] of Object.entries(state.sessions)) {
    if (s.exp < Date.now()) {
      delete state.sessions[k];
      changed = true;
    }
  }
  if (changed) persist();
}, 3600_000).unref();

function shutdown() {
  for (const id of [...instances.keys()]) stopInstance(id);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`🌐 YouTube Machine sayti: ${PUBLIC_URL} (port ${PORT})`);
  console.log(`   Ro‘yxatdan o‘tish: ${ALLOW_SIGNUP ? (INVITE_CODE ? 'taklif kodi bilan' : 'ochiq') : 'yopiq'} · admin: ${ADMIN_EMAIL || 'birinchi foydalanuvchi'}`);
  // Jadval bo'yicha yuklash ishlashi uchun faol foydalanuvchilar nusxalari darhol ishga tushadi
  if (!LAZY) for (const u of state.users.filter((x) => !x.disabled)) ensureInstance(u).catch((e) => console.warn(`${u.email}: ${e.message}`));
});
