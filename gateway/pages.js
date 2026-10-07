// Kirish xizmati sahifalari: kirish, ro'yxatdan o'tish, admin. 3 til (dastur bilan bir xil "ytm-lang" tanlovi) va kun/tun.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const TEXT = {
  title: ['Kirish', 'Sign in', 'Вход'],
  tagline: ['YouTube kanallaringiz uchun avtomatik video', 'Automatic videos for your YouTube channels', 'Автоматические видео для ваших YouTube-каналов'],
  email: ['Email', 'Email', 'Email'],
  password: ['Parol', 'Password', 'Пароль'],
  password_hint: ['Kamida 8 belgi', 'At least 8 characters', 'Минимум 8 символов'],
  login: ['Kirish', 'Sign in', 'Войти'],
  signup: ['Ro‘yxatdan o‘tish', 'Create account', 'Регистрация'],
  no_account: ['Hisobingiz yo‘qmi?', 'No account yet?', 'Нет аккаунта?'],
  have_account: ['Hisobingiz bormi?', 'Already have an account?', 'Уже есть аккаунт?'],
  invite: ['Taklif kodi', 'Invite code', 'Код приглашения'],
  private_note: ['Kalitlaringiz, kanallaringiz va videolaringiz faqat sizga ko‘rinadi.', 'Your keys, channels and videos are visible only to you.', 'Ваши ключи, каналы и видео видны только вам.'],
  bad_login: ['Email yoki parol noto‘g‘ri.', 'Wrong email or password.', 'Неверный email или пароль.'],
  disabled: ['Hisob vaqtincha o‘chirilgan. Administratorga yozing.', 'This account is disabled. Contact the administrator.', 'Аккаунт отключён. Напишите администратору.'],
  too_many: ['Juda ko‘p urinish. 15 daqiqadan keyin qayta urining.', 'Too many attempts. Try again in 15 minutes.', 'Слишком много попыток. Повторите через 15 минут.'],
  bad_email: ['Email manzilini to‘g‘ri kiriting.', 'Enter a valid email.', 'Введите корректный email.'],
  short_password: ['Parol kamida 8 belgidan iborat bo‘lsin.', 'Password must be at least 8 characters.', 'Пароль должен быть не короче 8 символов.'],
  bad_invite: ['Taklif kodi noto‘g‘ri.', 'Invalid invite code.', 'Неверный код приглашения.'],
  exists: ['Bu email bilan hisob bor — kiring.', 'An account with this email exists — sign in.', 'Аккаунт с этим email уже есть — войдите.'],
  full: ['Hozircha joy qolmadi. Keyinroq urinib ko‘ring.', 'No free places right now. Try again later.', 'Сейчас мест нет. Попробуйте позже.'],
  admin: ['Foydalanuvchilar', 'Users', 'Пользователи'],
  created: ['Yaratilgan', 'Created', 'Создан'],
  last_login: ['Oxirgi kirish', 'Last sign-in', 'Последний вход'],
  status: ['Holat', 'Status', 'Статус'],
  running: ['ishlayapti', 'running', 'работает'],
  stopped: ['to‘xtagan', 'stopped', 'остановлен'],
  blocked: ['o‘chirilgan', 'disabled', 'отключён'],
  disable: ['O‘chirish', 'Disable', 'Отключить'],
  enable: ['Yoqish', 'Enable', 'Включить'],
  restart: ['Qayta ishga tushirish', 'Restart', 'Перезапустить'],
  back: ['← Dasturga qaytish', '← Back to the app', '← Назад в программу'],
  signup_mode: ['Ro‘yxatdan o‘tish', 'Sign-up', 'Регистрация'],
  open: ['ochiq', 'open', 'открыта'],
  by_invite: ['taklif kodi bilan', 'invite code required', 'по коду приглашения'],
  closed: ['yopiq', 'closed', 'закрыта'],
  you: ['siz', 'you', 'вы'],
};
const json = JSON.stringify(TEXT);

const STYLE = `
:root{--bg:#0d0f17;--panel:#151926;--panel-2:#1c2132;--border:#2a3047;--text:#e7e9f3;--muted:#9097b1;--accent:#8b5cf6;--bad:#ef4444;--ok:#22c55e;color-scheme:dark}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f4f5fa;--panel:#fff;--panel-2:#eef0f7;--border:#d9dceb;--text:#161a2b;--muted:#5d6480;color-scheme:light}}
:root[data-theme="light"]{--bg:#f4f5fa;--panel:#fff;--panel-2:#eef0f7;--border:#d9dceb;--text:#161a2b;--muted:#5d6480;color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:420px;margin:8vh auto;padding:0 16px}.wide{max-width:960px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;margin-bottom:6px}.logo{width:34px;height:34px;border-radius:9px;background:var(--accent);color:#fff;display:grid;place-items:center}
.sub{color:var(--muted);margin:0 0 18px}.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:22px}
label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin:12px 0 6px}
input{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--border);background:var(--panel-2);color:var(--text);font:inherit}
button,.btn{display:inline-block;margin-top:16px;width:100%;padding:11px;border:0;border-radius:9px;background:var(--accent);color:#fff;font-weight:700;font:inherit;font-weight:700;cursor:pointer;text-align:center;text-decoration:none}
.small{width:auto;margin:0;padding:5px 10px;font-size:13px;background:var(--panel-2);color:var(--text);border:1px solid var(--border)}
.err{background:color-mix(in srgb,var(--bad) 15%,transparent);border:1px solid var(--bad);padding:9px 12px;border-radius:9px;margin-bottom:6px}
.help{font-size:13px;color:var(--muted)}a{color:var(--accent);text-decoration:none}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:8px;flex-wrap:wrap}
select{padding:4px 8px;border-radius:8px;border:1px solid var(--border);background:var(--panel-2);color:var(--text)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--border)}
.tablewrap{overflow-x:auto}.badge{padding:2px 8px;border-radius:99px;font-size:12px;background:var(--panel-2)}.ok{color:var(--ok)}.bad{color:var(--bad)}
form.inline{display:inline}`;

// Til tanlovi: dastur bilan bir xil localStorage kaliti; mavzu ham shu yerdan
const SCRIPT = `<script>
const T=${json};
let L='uz';try{L=localStorage.getItem('ytm-lang')||'uz';const th=localStorage.getItem('ytm-theme');if(th==='light'||th==='dark')document.documentElement.dataset.theme=th;}catch{}
const I={uz:0,en:1,ru:2}[L]??0;document.documentElement.lang=L;
for(const el of document.querySelectorAll('[data-t]'))el.textContent=T[el.dataset.t][I];
for(const el of document.querySelectorAll('[data-tp]'))el.placeholder=T[el.dataset.tp][I];
document.title=document.title.replace(/^[^·]+/,T.title[I]+' ');
const sel=document.getElementById('lang');if(sel){sel.value=L;sel.onchange=()=>{try{localStorage.setItem('ytm-lang',sel.value)}catch{}location.reload()}}
</script>`;

const langPicker = `<select id="lang" aria-label="Til / Language / Язык"><option value="uz">🇺🇿 O‘zbek</option><option value="en">🇬🇧 English</option><option value="ru">🇷🇺 Русский</option></select>`;
const t = (key) => `<span data-t="${key}">${esc(TEXT[key][0])}</span>`;

export function page(title, body, { wide = false } = {}) {
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · YouTube Machine</title><meta name="robots" content="noindex"><style>${STYLE}</style></head>
<body><div class="wrap${wide ? ' wide' : ''}"><div class="brand"><span class="logo">▶</span>YouTube Machine</div>${body}</div>${SCRIPT}</body></html>`;
}

const errorBox = (code) => (code && TEXT[code] ? `<div class="err">${t(code)}</div>` : '');

export function loginPage({ error = '', email = '', signup = true } = {}) {
  return page('Kirish', `<p class="sub">${t('tagline')}</p>
<form class="card" method="post" action="/gw/login">${errorBox(error)}
<label>${t('email')}</label><input name="email" type="email" required autocomplete="email" value="${esc(email)}" autofocus>
<label>${t('password')}</label><input name="password" type="password" required autocomplete="current-password">
<button type="submit">${t('login')}</button>
<div class="foot">${signup ? `<span class="help">${t('no_account')} <a href="/gw/signup">${t('signup')}</a></span>` : '<span></span>'}${langPicker}</div></form>`);
}

export function signupPage({ error = '', email = '', invite = false } = {}) {
  return page('Ro‘yxatdan o‘tish', `<p class="sub">${t('tagline')}</p>
<form class="card" method="post" action="/gw/signup">${errorBox(error)}
<label>${t('email')}</label><input name="email" type="email" required autocomplete="email" value="${esc(email)}" autofocus>
<label>${t('password')}</label><input name="password" type="password" required minlength="8" autocomplete="new-password" data-tp="password_hint" placeholder="${esc(TEXT.password_hint[0])}">
${invite ? `<label>${t('invite')}</label><input name="invite" required autocomplete="off">` : ''}
<button type="submit">${t('signup')}</button>
<p class="help" style="margin-top:12px">🔒 ${t('private_note')}</p>
<div class="foot"><span class="help">${t('have_account')} <a href="/gw/login">${t('login')}</a></span>${langPicker}</div></form>`);
}

const date = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16).replace('T', ' ') : '—');

export function adminPage({ rows, invite, signup }) {
  const mode = signup ? (invite ? 'by_invite' : 'open') : 'closed';
  return page('Admin', `<p class="sub"><a href="/">${t('back')}</a> · ${t('signup_mode')}: <b>${t(mode)}</b></p>
<div class="card"><h2 style="margin-top:0">${t('admin')} (${rows.length})</h2><div class="tablewrap"><table>
<tr><th>${t('email')}</th><th>${t('created')}</th><th>${t('last_login')}</th><th>${t('status')}</th><th></th></tr>
${rows.map((r) => `<tr><td>${esc(r.email)}${r.me ? ` <span class="badge">${t('you')}</span>` : ''}</td><td>${date(r.createdAt)}</td><td>${date(r.lastLogin)}</td>
<td>${r.disabled ? `<span class="bad">${t('blocked')}</span>` : r.running ? `<span class="ok">● ${t('running')}</span>` : t('stopped')}</td>
<td>${r.me ? '' : `<form class="inline" method="post" action="/gw/admin/users/${esc(r.id)}/${r.disabled ? 'enable' : 'disable'}"><button class="small">${t(r.disabled ? 'enable' : 'disable')}</button></form>`}
<form class="inline" method="post" action="/gw/admin/users/${esc(r.id)}/restart"><button class="small">${t('restart')}</button></form></td></tr>`).join('')}
</table></div></div>`, { wide: true });
}
