// Sayt (gateway) testi: ro'yxat, kirish, foydalanuvchilarni bir-biridan ajratish, admin, himoya.
// Ishga tushirish: npm run test:site
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = path.join(ROOT, 'test', '.tmp-site');
fs.rmSync(TMP, { recursive: true, force: true });
const PORT = 4791;
const B = `http://127.0.0.1:${PORT}`;
const gw = spawn(process.execPath, [path.join(ROOT, 'gateway', 'server.js')], {
  env: { ...process.env, GW_PORT: String(PORT), GW_HOST: '127.0.0.1', GW_DATA: TMP, GW_LAZY: '1', INVITE_CODE: 'kod123', ADMIN_EMAIL: 'admin@test.uz', INSTANCE_BASE_PORT: '4800' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => gw.stdout.on('data', (d) => String(d).includes('sayti') && resolve()));

const req = async (method, p, { cookie, body, form, headers = {} } = {}) => {
  const res = await fetch(B + p, {
    method,
    redirect: 'manual',
    headers: { ...(cookie ? { cookie } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: form ? new URLSearchParams(form) : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), cookie: (res.headers.get('set-cookie') || '').split(';')[0], text, json: () => JSON.parse(text) };
};

try {
  // Kirmagan foydalanuvchi
  let r = await req('GET', '/', { headers: { accept: 'text/html' } });
  assert.equal(r.status, 303);
  assert.equal(r.location, '/gw/login');
  assert.equal((await req('GET', '/api/settings')).status, 401);
  assert.match((await req('GET', '/gw/login')).text, /type="password"/);

  // Ro'yxat: taklif kodi va tekshiruvlar
  assert.equal((await req('POST', '/gw/signup', { form: { email: 'admin@test.uz', password: 'parol12345', invite: 'xato' } })).status, 400);
  assert.equal((await req('POST', '/gw/signup', { form: { email: 'admin@test.uz', password: 'qisqa', invite: 'kod123' } })).status, 400);
  r = await req('POST', '/gw/signup', { form: { email: 'Admin@Test.uz', password: 'parol12345', invite: 'kod123' } });
  assert.equal(r.status, 303);
  const A = r.cookie;
  assert.match(A, /^ytm_session=/);
  assert.equal((await req('POST', '/gw/signup', { form: { email: 'admin@test.uz', password: 'parol12345', invite: 'kod123' } })).status, 400, 'bir email ikki marta bo‘lmaydi');
  const Bc = (await req('POST', '/gw/signup', { form: { email: 'ali@test.uz', password: 'aliparol123', invite: 'kod123' } })).cookie;

  // Har biri o'z dasturiga tushadi, bir-birining ma'lumotini ko'rmaydi
  r = await req('GET', '/api/settings', { cookie: A });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json().channels, []);
  r = await req('POST', '/api/channels', { cookie: Bc, body: { name: 'Ali Kanal', type: 'explainer' } });
  assert.equal(r.status, 200, r.text);
  await req('PUT', '/api/settings', { cookie: A, body: { anthropicKey: 'sk-ant-AAA-maxfiy' } });
  assert.deepEqual((await req('GET', '/api/settings', { cookie: A })).json().channels, [], 'A boshqaning kanalini ko‘rmaydi');
  assert.equal((await req('GET', '/api/settings', { cookie: Bc })).json().channels[0].name, 'Ali Kanal');
  assert.equal((await req('GET', '/api/settings', { cookie: Bc })).json().settings.anthropicKey, '', 'B boshqaning kalitini ko‘rmaydi');
  const users = JSON.parse(fs.readFileSync(path.join(TMP, 'gateway.json'), 'utf8')).users;
  const dirA = path.join(TMP, 'users', users[0].id);
  assert.ok(fs.readFileSync(path.join(dirA, 'db.json'), 'utf8').includes('sk-ant-AAA-maxfiy'));
  assert.ok(!fs.readFileSync(path.join(TMP, 'users', users[1].id, 'db.json'), 'utf8').includes('sk-ant-AAA'));
  assert.ok(!fs.readFileSync(path.join(TMP, 'gateway.json'), 'utf8').includes('parol12345'), 'parol ochiq saqlanmaydi');

  // Sayt rejimi: Google kaliti "Web application" turida, qaytish manzili sayt manzili
  const keys = (await req('GET', '/api/keys', { cookie: A })).json();
  assert.equal(keys.serverMode, true);

  // Dasturning ichki portiga to'g'ridan-to'g'ri kirib bo'lmaydi
  const direct = await fetch(`http://127.0.0.1:${users[0].port}/api/settings`).then((x) => x.status);
  assert.equal(direct, 403);

  // Boshqa saytdan yuborilgan forma rad etiladi
  assert.equal((await req('POST', '/gw/login', { form: { email: 'a', password: 'b' }, headers: { origin: 'https://yomon.example' } })).status, 403);

  // Hisob va admin
  assert.deepEqual((await req('GET', '/gw/me', { cookie: A })).json(), { email: 'admin@test.uz', admin: true });
  assert.equal((await req('GET', '/gw/me', { cookie: Bc })).json().admin, false);
  assert.equal((await req('GET', '/gw/admin', { cookie: Bc })).status, 303, 'oddiy foydalanuvchi admin emas');
  r = await req('GET', '/gw/admin', { cookie: A });
  assert.ok(r.text.includes('ali@test.uz'));
  assert.equal((await req('POST', `/gw/admin/users/${users[1].id}/disable`, { cookie: A })).status, 303);
  assert.equal((await req('GET', '/api/settings', { cookie: Bc })).status, 401, 'o‘chirilgan hisob ishlamaydi');
  assert.equal((await req('POST', '/gw/login', { form: { email: 'ali@test.uz', password: 'aliparol123' } })).status, 403);
  await req('POST', `/gw/admin/users/${users[1].id}/enable`, { cookie: A });
  const B2 = (await req('POST', '/gw/login', { form: { email: 'ali@test.uz', password: 'aliparol123' } })).cookie;
  assert.equal((await req('GET', '/api/settings', { cookie: B2 })).json().channels[0].name, 'Ali Kanal', 'ma’lumotlar saqlanib qolgan');

  // Noto'g'ri parol va urinishlar cheklovi
  assert.equal((await req('POST', '/gw/login', { form: { email: 'ali@test.uz', password: 'xato' } })).status, 401);
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await req('POST', '/gw/login', { form: { email: 'ali@test.uz', password: 'xato' } })).status;
  assert.equal(last, 429);

  // Chiqish
  r = await req('GET', '/gw/logout', { cookie: A });
  assert.match(r.cookie, /^ytm_session=$/);
  assert.equal((await req('GET', '/api/settings', { cookie: A })).status, 401);
  console.log('✅ Sayt (gateway) testlari o‘tdi');
} finally {
  gw.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  if (!process.env.KEEP) fs.rmSync(TMP, { recursive: true, force: true });
}
