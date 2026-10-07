// YouTube Machine — boshqaruv oynasi (kutubxonasiz, oddiy JavaScript)
import { startI18n, getLang, setLang, t } from './i18n.js';

const main = document.getElementById('main');
let pollTimer = null;
let channelCache = null;

// ---------- Yordamchilar ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const pad = (n) => String(n).padStart(2, '0');

function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtSec(sec) {
  if (sec == null) return '—';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 8000 : 4000);
}

async function getChannels(force = false) {
  if (!channelCache || force) channelCache = (await api('GET', '/api/settings')).channels;
  return channelCache;
}

function uploadFile(projectId, field, file, onProgress) {
  return putFile(`/api/projects/${projectId}/upload?field=${field}&name=${encodeURIComponent(file.name)}`, file, onProgress);
}

// Fayl nomlari tabiiy tartibda: 2.png 10.png dan oldin
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function putFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        // javob JSON emas
      }
      if (xhr.status < 300) resolve(data);
      else reject(new Error(data.error || xhr.statusText));
    };
    xhr.onerror = () => reject(new Error('Tarmoq xatosi'));
    xhr.send(file);
  });
}

const PROJECT_STATUS = {
  draft: ['Qoralama', ''],
  queued: ['Navbatda', 'info'],
  processing: ['Ishlanmoqda', 'info'],
  review: ['Ko‘rib chiqish kerak', 'warn'],
  approved: ['Tasdiqlangan', 'ok'],
  published: ['YouTube’da', 'ok'],
  failed: ['Xato', 'bad'],
};
const UPLOAD_STATUS = {
  none: ['Yuklanmagan', ''],
  scheduled: ['Jadvalda', 'info'],
  waiting: ['Kanal ulanishi kutilmoqda', 'warn'],
  uploading: ['Yuklanmoqda', 'info'],
  done: ['YouTube’da', 'ok'],
  failed: ['Yuklash xatosi', 'bad'],
};
const STEP_ICON = { pending: '⏳', running: '⚙️', done: '✅', failed: '❌' };
const KIND_LABEL = { long: 'Uzun video', short: 'Shorts' };
const outputLabel = (o) => (o.kind === 'short' && /^short\d+$/.test(o.id) ? `Shorts ${o.id.slice(5)}` : KIND_LABEL[o.kind] || o.kind);
const COST_KIND = { text: 'AI matn', voice: 'Ovoz (TTS)', transcribe: 'Transkripsiya', manual: 'Qo‘lda kiritilgan' };

const badge = (map, key) => {
  const [label, cls] = map[key] || [key, ''];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
};

/** TikTok va Reels uchun matn (serverdagi telegram.js bilan bir xil qoida). */
const TYPE_DESC = {
  music: ['Suno qo‘shig‘i → lyric video + Shorts', 'Lyric video + Shorts'],
  fight: ['Jang lavhasi → inglizcha tahlil + Shorts', 'Jang tahlili'],
  explainer: ['Personaj + g‘oya → animatsion tushuntiruvchi video', 'Tushuntiruvchi video'],
};
// Kanal hali yo'q bo'lsa — qayerdan boshlashni ko'rsatadi
const noChannelsHtml = (title) => `
  <div class="page-head"><div><h1>${esc(title)}</h1></div></div>
  <div class="card empty-state">
    <h2>Avval kanal yarating</h2>
    <p class="sub">Dastur 3 turdagi kanalni yuritadi: 🎬 tushuntiruvchi (personaj + g‘oya), 🎵 musiqa (Suno), 🥊 jang tahlili.</p>
    <a class="btn primary" href="#/settings?new=1">➕ Kanal yaratish</a>
  </div>`;

const characterUrl = (c) => (c.characterFile ? `/channel-files/${c.id}/${encodeURIComponent(c.characterFile)}?v=${encodeURIComponent(c.characterAt || '')}` : '');

function socialCaption(o) {
  const title = o.title.replace(/#shorts/gi, '').trim();
  const tags = (o.description.match(/#[\p{L}\p{N}_]+/gu) || []).filter((t) => !/^#shorts$/i.test(t)).slice(0, 5);
  return `${title}\n\n${[...new Set([...tags, '#fyp', '#reels'])].join(' ')}`;
}

function budgetBar(used, budget) {
  const pct = budget ? Math.min(100, (used / budget) * 100) : 0;
  const cls = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '';
  return `<div class="bar ${cls}"><span style="width:${pct.toFixed(1)}%"></span></div>`;
}

function poll(fn, ms) {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => fn().catch(() => {}), ms);
}

// ---------- Marshrutlash ----------
function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [p, q] = raw.split('?');
  return { parts: p.split('/').filter(Boolean), query: new URLSearchParams(q || '') };
}

async function render() {
  clearInterval(pollTimer);
  const { parts, query } = parseHash();
  const name = parts[0] || 'dashboard';
  const navName = name === 'project' ? 'projects' : name;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === navName));
  const view = views[name] || views.dashboard;
  try {
    await view(parts.slice(1), query);
  } catch (err) {
    main.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`;
  }
  main.focus({ preventScroll: true });
}

async function updateQueueStatus() {
  try {
    const d = await api('GET', '/api/dashboard');
    const el = document.getElementById('queue-status');
    const waiting = d.queue.waiting.length;
    el.innerHTML = d.queue.running ? `⚙️ Montaj ketmoqda${waiting ? ` · navbatda ${waiting}` : ''}` : 'Navbat bo‘sh';
  } catch {
    // server o'chgan bo'lishi mumkin
  }
}

// ---------- Ko'rinishlar ----------
const views = {};

views.dashboard = async () => {
  const draw = async () => {
    const d = await api('GET', '/api/dashboard');
    const c = d.costs;
    const pending = d.checklist.filter((x) => !x.ok);
    main.innerHTML = `
      <div class="page-head">
        <div><h1>Boshqaruv paneli</h1><div class="sub">${d.channels.length ? `${d.channels.map((c) => esc(c.name)).join(' · ')} — kuniga bittadan video` : 'YouTube kanallaringiz uchun avtomatik video'}</div></div>
        <a class="btn primary" href="#/new">➕ Yangi video</a>
      </div>
      ${d.channels.length ? '' : `<div class="card"><h2>👋 Xush kelibsiz! 3 qadamda boshlaymiz</h2>
        <ol class="checklist"><li><a href="#/settings?new=1"><b>Kanal yarating</b></a> — tushuntiruvchi, musiqa yoki jang kanali</li>
        <li><a href="#/keys"><b>Kalitlarni kiriting</b></a> — kamida bitta matn AI (Claude, OpenAI yoki Gemini). Kalitlar faqat shu kompyuterda saqlanadi.</li>
        <li><a href="#/new"><b>Birinchi videoni yarating</b></a></li></ol></div>`}
      ${pending.length ? `
        <div class="card"><h2>Sozlash holati</h2>
          <ul class="checklist">${d.checklist.map((x) => `<li>${x.ok ? '✅' : '⬜'} ${esc(x.label)}${!x.ok && x.hint ? ` <span class="help">— ${esc(x.hint)}</span>` : ''}</li>`).join('')}</ul>
          <div class="row" style="margin-top:12px"><a class="btn primary" href="#/keys">🔑 Kalitlarni kiritish</a></div>
          <p class="help" style="margin-top:10px">Kalitlarsiz ham ishlaydi: montaj bepul bajariladi, matn esa shablon yoki o‘zingiz yozgan eslatmalardan olinadi.</p>
        </div>` : ''}
      <div class="grid grid-4">
        <div class="card kpi"><div class="label">Shu oy xarajati</div><div class="value">${money(c.total)}</div><div class="hint">Byudjet ${money(c.budget)} · qoldi ${money(c.remaining)}</div>${budgetBar(c.total, c.budget)}</div>
        <div class="card kpi"><div class="label">Oy oxiriga bashorat</div><div class="value">${money(c.projected)}</div><div class="hint">Shundan obunalar ${money(c.fixed)}</div></div>
        <div class="card kpi"><div class="label">Shu oy tayyor videolar</div><div class="value">${c.videos}</div><div class="hint">Bir videoga: ${c.perVideo != null ? money(c.perVideo) : '—'}</div></div>
        <div class="card kpi"><div class="label">Ko‘rib chiqish kutmoqda</div><div class="value">${d.counts.review || 0}</div><div class="hint">Navbatda/ishlanmoqda: ${(d.counts.queued || 0) + (d.counts.processing || 0)} · xato: ${d.counts.failed || 0}</div></div>
      </div>
      <div class="grid grid-2">
        ${d.channels.map((ch) => `
          <div class="card">
            <div class="row" style="justify-content:space-between">
              <h2><span class="dot" style="background:${esc(ch.colors.primary)}"></span>${esc(ch.name)}</h2>
              ${ch.youtube.connected ? (ch.youtube.expired ? '<span class="badge bad">Qayta ulash kerak</span>' : `<span class="badge ok">Ulangan: ${esc(ch.youtube.title)}</span>`) : '<span class="badge warn">YouTube ulanmagan</span>'}
            </div>
            <p class="sub">${TYPE_DESC[ch.type]?.[0] || ''}</p>
            <p>Keyingi bo‘sh slot: <b>${fmtDate(ch.nextSlot)}</b></p>
            ${ch.diagnosis ? `<p><a href="#/diagnose?channel=${ch.id}">🩺 Tashxis: <b>${ch.diagnosis.score}/100</b> · 📉 ${ch.diagnosis.flop} ta uchmagan · 🚀 ${ch.diagnosis.hit} ta uchgan</a> <span class="help">(${fmtDate(ch.diagnosis.at, false)})</span></p>` : `<p><a href="#/diagnose?channel=${ch.id}">🩺 Kanal tashxisini o‘tkazish →</a></p>`}
            <a class="btn" href="#/new?channel=${ch.id}">➕ Yangi video: ${esc(ch.name)}</a>
          </div>`).join('')}
      </div>
      <div class="card"><h2>So‘nggi loyihalar</h2>${projectTable(d.recent, d.channels)}</div>`;
  };
  await draw();
  poll(draw, 5000);
};

function projectTable(list, channels) {
  if (!list.length) return '<div class="empty-state">Hali loyiha yo‘q. <a href="#/new">Birinchi videoni yarating</a>.</div>';
  const name = (id) => channels.find((c) => c.id === id)?.name || id;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Loyiha</th><th>Kanal</th><th>Holat</th><th>Videolar</th><th>Xarajat</th><th>Yaratilgan</th></tr></thead>
    <tbody>${list.map((p) => `
      <tr class="click" data-href="#/project/${p.id}">
        <td><b>${esc(p.title)}</b>${p.currentStep ? `<div class="help">⚙️ ${esc(p.currentStep)}</div>` : ''}${p.error ? `<div class="help" style="color:var(--bad)">${esc(p.error)}</div>` : ''}</td>
        <td>${esc(name(p.channelId))}</td>
        <td>${badge(PROJECT_STATUS, p.status)}${p.status === 'processing' ? `<div class="bar"><span style="width:${p.progress}%"></span></div>` : ''}</td>
        <td>${p.outputs.map((o) => `<div>${esc(outputLabel(o))} ${badge(UPLOAD_STATUS, o.upload.status)}</div>`).join('') || '—'}</td>
        <td>${money(p.cost)}</td>
        <td>${fmtDate(p.createdAt)}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

document.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a,button,input')) location.hash = row.dataset.href;
});

// ---------- Yangi video ----------
views.new = async (parts, query) => {
  const channels = await getChannels();
  if (!channels.length) {
    main.innerHTML = noChannelsHtml('Yangi video');
    return;
  }
  let current = channels.find((c) => c.id === query.get('channel')) || channels[0];

  const musicForm = () => `
    <div class="grid grid-2">
      <div><label>Qo‘shiq nomi *</label><input name="songTitle" required placeholder="Masalan: Midnight Echo"></div>
      <div><label>Janr</label><input name="genre" placeholder="Arabic pop, lo-fi, EDM…"></div>
      <div><label>Kayfiyat</label><input name="mood" placeholder="emotional, uplifting…"></div>
      <div><label>Qo‘shiq tili</label><input name="lyricsLanguage" placeholder="Arabic, English…"></div>
    </div>
    <label>Qo‘shiq matni</label>
    <textarea name="lyrics" rows="10" placeholder="Suno’dagi matnni joylang. [Verse], [Chorus] belgilarini dastur o‘zi olib tashlaydi.&#10;Aniq vaqtli matn (LRC) ham bo‘ladi: [00:12.50] birinchi qator"></textarea>
    <div class="help">Vaqtlar: LRC bo‘lsa — aynan shu vaqtlar; OpenAI kaliti bo‘lsa — vokal eshitilgan joylar aniqlanadi; aks holda teng taqsimlanadi (keyin tahrirlash mumkin).</div>
    <div class="grid grid-2">
      <div><label>Qo‘shiq fayli (MP3/WAV) *</label><input type="file" name="audio" accept=".mp3,.wav,.m4a,.flac,.ogg" required></div>
      <div><label>Muqova rasmi (ixtiyoriy)</label><input type="file" name="cover" accept=".png,.jpg,.jpeg,.webp"><div class="help">Bo‘lmasa, kanal ranglaridan fon yasaladi.</div></div>
      <div><label>Fon videosi (ixtiyoriy)</label><input type="file" name="bgvideo" accept=".mp4,.mov,.webm,.mkv"><div class="help">Masalan, Kling/Higgsfield/Veo’da yaratilgan 5–10 s halqa video — butun qo‘shiq davomida takrorlanadi.</div></div>
    </div>`;

  const fightForm = () => `
    <div class="grid grid-2">
      <div><label>Jangchilar *</label><input name="fighters" required placeholder="Fighter A vs Fighter B"></div>
      <div><label>Turnir / kontekst</label><input name="event" placeholder="UFC 300, 3-raund…"></div>
    </div>
    <label>Format</label>
    <div class="row">
      <label class="check"><input type="radio" name="format" value="short" checked> Shorts (vertikal, ≤ ${current.shortsSeconds} s)</label>
      <label class="check"><input type="radio" name="format" value="long"> Uzun video (gorizontal, 10 daqiqagacha)</label>
    </div>
    <div class="help">To‘liq jang videosi bormi? <a href="#/highlights">Lavha topish</a> sahifasi eng qizg‘in lahzalarni o‘zi ajratib beradi.</div>
    <label>Tahlil uchun eslatmalar (inglizcha)</label>
    <textarea name="notes" rows="6" placeholder="Nima bo‘ldi, qaysi zarba, natija (faqat aniq faktlar). AI shu faktlardan original tahlil yozadi. Kalit bo‘lmasa, shu matn diktor matni sifatida ishlatiladi."></textarea>
    <div class="grid grid-2">
      <div><label>Jang lavhasi (video) *</label><input type="file" name="clip" accept=".mp4,.mov,.mkv,.webm,.avi" required></div>
      <div><label>O‘z ovozingiz (ixtiyoriy)</label><input type="file" name="voice" accept=".mp3,.wav,.m4a"><div class="help">Bo‘lsa, AI ovozi o‘rniga shu ishlatiladi.</div></div>
    </div>
    <div class="alert warn" style="margin-top:14px">
      Lavhani kesib olishning o‘zi undan foydalanish huquqini bermaydi. Original tahlil va sharh qo‘shish monetizatsiya uchun yordam beradi, lekin manba videosi egasining shikoyati (Content ID) baribir bo‘lishi mumkin.
      <label class="check" style="margin-top:8px"><input type="checkbox" name="rights" required> Tushundim: bu lavhaga original tahlil qo‘shaman va foydalanish xavfini o‘zim baholayman.</label>
    </div>`;

  const explainerForm = () => {
    const long = (current.defaultFormat || 'long') === 'long';
    return `
    <div class="row" style="align-items:flex-start;gap:16px">
      ${current.characterFile
        ? `<img src="${characterUrl(current)}" alt="Personaj" class="char-preview">`
        : '<div class="alert warn" style="flex:1;margin:0">Kanal personaji hali yuklanmagan. Pastda shu video uchun yuklang yoki <a href="#/settings">Sozlamalar</a>da kanalga bir marta yuklab qo‘ying.</div>'}
      <div style="flex:1;min-width:220px">
        <label>G‘oya / mavzu *</label>
        <textarea name="idea" rows="3" required placeholder="Masalan: What happens if you stop sleeping for 7 days?"></textarea>
        <div class="help">Bir jumla yetarli. AI ssenariy, sahnalar, rasmlar, ovoz, sarlavha va prevyuni o‘zi tayyorlaydi.</div>
      </div>
    </div>
    <label>Format</label>
    <div class="row">
      <label class="check"><input type="radio" name="format" value="long" ${long ? 'checked' : ''}> Uzun video (gorizontal)</label>
      <label class="check"><input type="radio" name="format" value="short" ${long ? '' : 'checked'}> Shorts (vertikal)</label>
    </div>
    <div class="grid grid-2">
      <div><label>Uzun video davomiyligi (daqiqa)</label><input name="targetMinutes" type="number" min="1" max="15" step="0.5" value="4"></div>
      <div><label>Shorts davomiyligi (soniya)</label><input name="targetSeconds" type="number" min="15" max="170" value="${esc(current.shortsSeconds || 50)}"></div>
    </div>
    <details style="margin-top:12px"><summary><b>📁 Tayyor materiallarim bor (ChatGPT rasmlari, AI Studio ovozi)</b></summary>
      <div class="help" style="margin-top:6px">Rasm va ovozlarni o‘zingiz yasagan bo‘lsangiz — shu yerga tashlang, dastur ularni yig‘ib, yorliq, subtitr, effekt va musiqa qo‘shadi. Fayllar <b>nomi bo‘yicha</b> tartiblanadi (1.png, 2.png, …). Pastdagi “O‘z ssenariyingiz”ga matnni har sahnani yangi qatordan yozing — subtitr shundan olinadi.</div>
      <div class="grid grid-2">
        <div><label>Sahna rasmlari (bir nechta)</label><input type="file" name="importImages" accept=".png,.jpg,.jpeg,.webp" multiple></div>
        <div><label>Ovoz: bitta umumiy yoki har sahnaga bittadan</label><input type="file" name="importVoices" accept=".mp3,.wav,.m4a,.ogg,.flac" multiple>
          <div class="help">Bitta fayl bo‘lsa, dastur uni sahnalarga o‘zi taqsimlaydi.</div></div>
      </div>
    </details>
    <details style="margin-top:12px"><summary><b>Qo‘shimcha (ixtiyoriy)</b></summary>
      <label>O‘z ssenariyingiz</label>
      <textarea name="ownScript" rows="6" placeholder="Bo‘lsa, AI yozmaydi — shu matn sahnalarga bo‘linadi va ovozlanadi."></textarea>
      <label>AI uchun eslatmalar</label>
      <textarea name="notes" rows="3" placeholder="Faktlar, manbalar, uslub istaklari…"></textarea>
      <div class="grid grid-2">
        <div><label>Shu video uchun boshqa personaj</label><input type="file" name="character" accept=".png,.jpg,.jpeg,.webp"></div>
        <div><label>Fon musiqasi</label><input type="file" name="music" accept=".mp3,.wav,.m4a,.ogg"><div class="help">Ovozdan past (10%) eshitiladi.</div></div>
      </div>
    </details>`;
  };

  const draw = () => {
    main.innerHTML = `
      <div class="page-head"><div><h1>Yangi video</h1><div class="sub">Material bering — qolganini dastur bajaradi, oxirida siz tasdiqlaysiz.</div></div></div>
      <div class="channel-pick">${channels.map((c) => `
        <button type="button" data-ch="${c.id}" class="${c.id === current.id ? 'active' : ''}">
          <b><span class="dot" style="background:${esc(c.colors.primary)}"></span>${esc(c.name)}</b>
          <div class="help">${TYPE_DESC[c.type]?.[1] || ''}</div>
        </button>`).join('')}</div>
      <form class="card" id="new-form">
        ${current.type === 'music' ? musicForm() : current.type === 'explainer' ? explainerForm() : fightForm()}
        <div class="row" style="margin-top:18px">
          <button class="btn primary" type="submit">🚀 Yaratishni boshlash</button>
          <span class="upload-progress" id="progress"></span>
        </div>
      </form>`;
    main.querySelectorAll('[data-ch]').forEach((b) =>
      b.addEventListener('click', () => {
        current = channels.find((c) => c.id === b.dataset.ch);
        history.replaceState(null, '', `#/new?channel=${current.id}`);
        draw();
      }),
    );
    document.getElementById('new-form').addEventListener('submit', submit);
  };

  async function submit(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type=submit]');
    const progress = document.getElementById('progress');
    const fd = new FormData(form);
    const inputs = {};
    for (const k of ['songTitle', 'genre', 'mood', 'lyricsLanguage', 'lyrics', 'fighters', 'event', 'notes', 'idea', 'ownScript', 'targetMinutes', 'targetSeconds']) if (fd.has(k)) inputs[k] = fd.get(k);
    const importImages = fd.getAll('importImages').filter((f) => f.size).sort(byName);
    const importVoices = fd.getAll('importVoices').filter((f) => f.size).sort(byName);
    if (current.type === 'explainer' && !current.characterFile && !fd.get('character')?.size && !importImages.length) {
      toast('Personaj rasmini yuklang (shu yerda yoki Sozlamalarda)', 'bad');
      return;
    }
    btn.disabled = true;
    let project;
    try {
      project = await api('POST', '/api/projects', { channelId: current.id, format: fd.get('format'), inputs });
      for (const field of ['audio', 'cover', 'bgvideo', 'clip', 'voice', 'character', 'music']) {
        const file = fd.get(field);
        if (file && file.size) {
          await uploadFile(project.id, field, file, (pct) => {
            progress.textContent = `${file.name} yuklanmoqda… ${pct}%`;
          });
        }
      }
      for (const [kind, files] of [['image', importImages], ['voice', importVoices]]) {
        for (const [i, file] of files.entries()) {
          await putFile(`/api/projects/${project.id}/import?kind=${kind}&name=${encodeURIComponent(file.name)}`, file, (pct) => {
            progress.textContent = `${kind === 'image' ? 'Rasm' : 'Ovoz'} ${i + 1}/${files.length}: ${pct}%`;
          });
        }
      }
      progress.textContent = 'Navbatga qo‘yilmoqda…';
      await api('POST', `/api/projects/${project.id}/run`, {});
      toast('Loyiha navbatga qo‘yildi', 'ok');
      location.hash = `#/project/${project.id}`;
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
      progress.textContent = '';
      if (project) location.hash = `#/project/${project.id}`;
    }
  }

  draw();
};

// ---------- Ko'plab yuklash (Overtone) ----------
views.batch = async () => {
  const channels = (await getChannels()).filter((c) => c.type === 'music');
  if (!channels.length) {
    main.innerHTML = '<div class="alert warn">Musiqa kanali topilmadi.</div>';
    return;
  }
  main.innerHTML = `
    <div class="page-head"><div><h1>Ko‘plab yuklash</h1><div class="sub">Bir haftalik qo‘shiqlarni birdaniga tashlang — har biri alohida loyiha bo‘lib navbatga turadi.</div></div></div>
    <form class="card" id="batch-form">
      <div class="grid grid-2">
        <div><label>Kanal</label><select name="channelId">${channels.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div><label>Qo‘shiqlar va matnlar *</label><input type="file" name="files" multiple required accept=".mp3,.wav,.m4a,.flac,.ogg,.txt,.lrc">
          <div class="help">Audio fayllar bilan birga bir xil nomli <code>.txt</code> yoki <code>.lrc</code> matn fayllarini tanlang: <code>Midnight Echo.mp3</code> + <code>Midnight Echo.txt</code>. Qo‘shiq nomi fayl nomidan olinadi.</div></div>
        <div><label>Janr (hammasiga)</label><input name="genre"></div>
        <div><label>Kayfiyat (hammasiga)</label><input name="mood"></div>
        <div><label>Qo‘shiq tili (hammasiga)</label><input name="lyricsLanguage" placeholder="Arabic, English…"></div>
        <div><label>Umumiy muqova (ixtiyoriy)</label><input type="file" name="cover" accept=".png,.jpg,.jpeg,.webp"></div>
        <div><label>Umumiy fon videosi (ixtiyoriy)</label><input type="file" name="bgvideo" accept=".mp4,.mov,.webm,.mkv"></div>
      </div>
      <div id="batch-preview" style="margin-top:14px"></div>
      <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">🚀 Hammasini navbatga qo‘yish</button></div>
    </form>`;
  const form = document.getElementById('batch-form');
  const base = (name) => name.replace(/\.[^.]+$/, '');
  const pairs = () => {
    const files = [...form.files.files];
    const texts = new Map(files.filter((f) => /\.(txt|lrc)$/i.test(f.name)).map((f) => [base(f.name).toLowerCase(), f]));
    return files.filter((f) => !/\.(txt|lrc)$/i.test(f.name)).map((audio) => ({ audio, text: texts.get(base(audio.name).toLowerCase()) || null, title: base(audio.name).replace(/[_]+/g, ' ').trim() }));
  };
  form.files.addEventListener('change', () => {
    const list = pairs();
    document.getElementById('batch-preview').innerHTML = list.length
      ? `<table><thead><tr><th>Qo‘shiq</th><th>Matn</th><th>Holat</th></tr></thead><tbody>${list.map((x, i) => `<tr><td>${esc(x.title)}</td><td>${x.text ? esc(x.text.name) : '<span class="badge warn">matnsiz</span>'}</td><td id="b-${i}">kutmoqda</td></tr>`).join('')}</tbody></table>`
      : '';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const list = pairs();
    form.querySelector('button[type=submit]').disabled = true;
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      const cell = document.getElementById(`b-${i}`);
      const { audio, text, title } = list[i];
      try {
        const lyrics = text ? await text.text() : '';
        const project = await api('POST', '/api/projects', {
          channelId: fd.get('channelId'),
          inputs: { songTitle: title, genre: fd.get('genre'), mood: fd.get('mood'), lyricsLanguage: fd.get('lyricsLanguage'), lyrics },
        });
        await uploadFile(project.id, 'audio', audio, (pct) => {
          cell.textContent = `yuklanmoqda ${pct}%`;
        });
        for (const field of ['cover', 'bgvideo']) {
          const f = fd.get(field);
          if (f && f.size) await uploadFile(project.id, field, f);
        }
        await api('POST', `/api/projects/${project.id}/run`, {});
        cell.innerHTML = `<a href="#/project/${project.id}">navbatda ✅</a>`;
        ok++;
      } catch (err) {
        cell.innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`;
      }
    }
    toast(`${ok} ta qo‘shiq navbatga qo‘yildi`, 'ok');
    form.querySelector('button[type=submit]').disabled = false;
  });
};

// ---------- To'liq jangdan lavha topish ----------
views.highlights = async (parts) => {
  const channels = (await getChannels()).filter((c) => c.type === 'fight');
  if (parts[0]) return highlightDetail(parts[0], channels);
  const { sources } = await api('GET', '/api/sources');
  main.innerHTML = `
    <div class="page-head"><div><h1>Lavha topish</h1><div class="sub">To‘liq jang videosini bering — dastur harakat va tomoshabinlar ovozi eng keskin bo‘lgan lahzalarni topadi.</div></div></div>
    <form class="card" id="src-form">
      <div class="grid grid-2">
        <div><label>Jang videosi *</label><input type="file" name="file" required accept=".mp4,.mov,.mkv,.webm,.avi"></div>
        <div><label>Jangchilar</label><input name="fighters" placeholder="Fighter A vs Fighter B"></div>
        <div><label>Turnir / kontekst</label><input name="event"></div>
        <div class="grid grid-2">
          <div><label>Lavha uzunligi (s)</label><input name="clipLength" type="number" min="8" max="55" value="20"></div>
          <div><label>Nechta lavha</label><input name="count" type="number" min="1" max="15" value="6"></div>
        </div>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">🔎 Yuklash va tahlil qilish</button><span class="upload-progress" id="src-progress"></span></div>
      <div class="alert warn" style="margin-top:14px">Lavhalardan foydalanish huquqi haqida eslatma “Yangi video” sahifasidagi kabi: original tahlil qo‘shing, Content ID da’volari bo‘lishi mumkin.</div>
    </form>
    <div class="card"><h2>Tahlil qilingan videolar</h2>
      ${sources.length ? `<div class="table-wrap"><table><thead><tr><th>Video</th><th>Holat</th><th>Lavhalar</th><th>Sana</th></tr></thead><tbody>
        ${sources.map((x) => `<tr class="click" data-href="#/highlights/${x.id}"><td><b>${esc(x.name)}</b><div class="help">${esc(x.fighters)}</div></td><td>${badge(SOURCE_STATUS, x.status)}</td><td>${x.candidates.length}</td><td>${fmtDate(x.createdAt)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty-state">Hali video yo‘q</div>'}
    </div>`;
  document.getElementById('src-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get('file');
    e.target.querySelector('button').disabled = true;
    try {
      const src = await api('POST', '/api/sources', { name: file.name, fighters: fd.get('fighters'), event: fd.get('event'), clipLength: fd.get('clipLength'), count: fd.get('count') });
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `/api/sources/${src.id}/upload?name=${encodeURIComponent(file.name)}`);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) document.getElementById('src-progress').textContent = `Yuklanmoqda… ${Math.round((ev.loaded / ev.total) * 100)}%`;
        };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText)));
        xhr.onerror = () => reject(new Error('Tarmoq xatosi'));
        xhr.send(file);
      });
      location.hash = `#/highlights/${src.id}`;
    } catch (err) {
      toast(err.message, 'bad');
      e.target.querySelector('button').disabled = false;
    }
  });
};

const SOURCE_STATUS = {
  uploading: ['Yuklanmoqda', 'info'],
  queued: ['Navbatda', 'info'],
  analyzing: ['Tahlil qilinmoqda', 'info'],
  ready: ['Tayyor', 'ok'],
  failed: ['Xato', 'bad'],
};

async function highlightDetail(id, channels) {
  const draw = async () => {
    const src = await api('GET', `/api/sources/${id}`);
    main.innerHTML = `
      <div class="page-head">
        <div><div class="sub"><a href="#/highlights">Lavha topish</a></div><h1>${esc(src.name)}</h1><div>${badge(SOURCE_STATUS, src.status)} <span class="sub">${src.duration ? `· ${fmtSec(src.duration)}` : ''} ${esc(src.fighters)}</span></div></div>
        <div class="row">
          <button class="btn" id="reanalyze" ${['analyzing', 'queued'].includes(src.status) ? 'disabled' : ''}>🔁 Qayta tahlil</button>
          <button class="btn danger" id="del-src">🗑</button>
        </div>
      </div>
      ${src.error ? `<div class="alert bad">${esc(src.error)}</div>` : ''}
      ${['analyzing', 'queued'].includes(src.status) ? '<div class="alert info">Tahlil ketmoqda. Uzun jangda bir necha daqiqa oladi — sahifa o‘zi yangilanadi.</div>' : ''}
      <div class="grid grid-2">${src.candidates.map((c, i) => `
        <div class="card">
          <div class="row" style="justify-content:space-between"><h3>#${i + 1} · ${fmtSec(c.start)}–${fmtSec(c.end)}</h3><span class="badge ${c.score > 70 ? 'ok' : 'info'}">Qizg‘inlik ${c.score}</span></div>
          <video controls preload="none" poster="/sources/${src.id}/${esc(c.thumb)}" src="/sources/${src.id}/${esc(src.file)}#t=${c.start},${c.end}" style="width:100%;border-radius:10px;background:#000"></video>
          <div class="row" style="margin-top:10px">
            ${c.projectId ? `<a class="btn" href="#/project/${c.projectId}">🎬 Loyihani ochish</a>` : `
              <select data-format="${c.id}" style="max-width:180px"><option value="short">Shorts</option><option value="long">Uzun video</option></select>
              <button class="btn primary" data-create="${c.id}">🎬 Video yaratish</button>`}
          </div>
        </div>`).join('')}</div>
      ${src.status === 'ready' && !src.candidates.length ? '<div class="empty-state">Lavha topilmadi</div>' : ''}`;
    main.querySelectorAll('[data-create]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Kesilmoqda…';
      try {
        const project = await api('POST', `/api/sources/${id}/candidates/${b.dataset.create}/create`, { format: main.querySelector(`[data-format="${b.dataset.create}"]`).value, channelId: channels[0]?.id });
        toast('Loyiha yaratildi va navbatga qo‘yildi', 'ok');
        location.hash = `#/project/${project.id}`;
      } catch (err) {
        toast(err.message, 'bad');
        b.disabled = false;
      }
    }));
    document.getElementById('reanalyze').addEventListener('click', async () => {
      await api('POST', `/api/sources/${id}/analyze`, {});
      await draw();
    });
    document.getElementById('del-src').addEventListener('click', async () => {
      if (!confirm('Video va tahlil o‘chiriladi (yaratilgan loyihalar qoladi). Davom etilsinmi?')) return;
      await api('DELETE', `/api/sources/${id}`);
      location.hash = '#/highlights';
    });
    return src;
  };
  const first = await draw();
  if (['analyzing', 'queued', 'uploading'].includes(first.status)) {
    poll(async () => {
      const src = await api('GET', `/api/sources/${id}`);
      if (!['analyzing', 'queued', 'uploading'].includes(src.status)) {
        clearInterval(pollTimer);
        await draw();
      }
    }, 3000);
  }
}

// ---------- Loyihalar ro'yxati ----------
views.projects = async (parts, query) => {
  const channels = await getChannels();
  const draw = async () => {
    const { projects } = await api('GET', '/api/projects');
    const ch = query.get('channel') || '';
    const st = query.get('status') || '';
    const list = projects.filter((p) => (!ch || p.channelId === ch) && (!st || p.status === st));
    main.innerHTML = `
      <div class="page-head"><div><h1>Loyihalar</h1><div class="sub">${projects.length} ta loyiha</div></div><a class="btn primary" href="#/new">➕ Yangi video</a></div>
      <div class="card">
        <div class="row" style="margin-bottom:12px">
          <select id="f-ch" style="max-width:220px"><option value="">Barcha kanallar</option>${channels.map((c) => `<option value="${c.id}" ${c.id === ch ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          <select id="f-st" style="max-width:220px"><option value="">Barcha holatlar</option>${Object.entries(PROJECT_STATUS).map(([k, [l]]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        </div>
        ${projectTable(list, channels)}
      </div>`;
    const apply = () => {
      const q = new URLSearchParams();
      if (document.getElementById('f-ch').value) q.set('channel', document.getElementById('f-ch').value);
      if (document.getElementById('f-st').value) q.set('status', document.getElementById('f-st').value);
      location.hash = `#/projects${q.toString() ? `?${q}` : ''}`;
    };
    document.getElementById('f-ch').addEventListener('change', apply);
    document.getElementById('f-st').addEventListener('change', apply);
  };
  await draw();
  poll(async () => {
    if (!document.activeElement?.matches('select')) await draw();
  }, 5000);
};

// ---------- Bitta loyiha ----------
views.project = async ([id]) => {
  const channels = await getChannels();
  let p = await api('GET', `/api/projects/${id}`);
  const channel = channels.find((c) => c.id === p.channelId);

  const stamp = () => encodeURIComponent(p.steps.map((s) => s.finishedAt || '').join('|').slice(-40));
  const busy = () => p.status === 'queued' || p.status === 'processing';

  const stepsHtml = () =>
    p.steps
      .map(
        (s) => `<li><span>${STEP_ICON[s.status] || '•'}</span><span>${esc(s.label)}${s.status === 'running' && s.progress ? `<div class="bar"><span style="width:${s.progress}%"></span></div>` : ''}</span>
        <span class="help">${s.finishedAt && s.startedAt ? `${Math.max(0, Math.round((new Date(s.finishedAt) - new Date(s.startedAt)) / 1000))} s` : ''}</span>
        ${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}</li>`,
      )
      .join('');
  const logHtml = () => esc(p.log.slice(-80).map((l) => `${fmtDate(l.at).slice(11)}  ${l.msg}`).join('\n')) || 'Jurnal bo‘sh';
  const statusHtml = () => `${badge(PROJECT_STATUS, p.status)} <span class="sub">· xarajat ${money(p.cost)} · ${fmtDate(p.createdAt)}</span>`;
  const uploadHtml = (o) => {
    const u = o.upload;
    let html = badge(UPLOAD_STATUS, u.status);
    if (u.status === 'uploading') html += ` <span class="help">${u.progress}%</span>`;
    if (u.videoId) html += ` <a href="https://youtu.be/${esc(u.videoId)}" target="_blank" rel="noopener">youtu.be/${esc(u.videoId)}</a>`;
    if (u.error) html += `<div class="help" style="color:var(--bad)">${esc(u.error)}</div>`;
    return html;
  };

  const inputsHtml = () => {
    const files = {
      music: [['audio', 'Qo‘shiq fayli', '.mp3,.wav,.m4a,.flac,.ogg', true], ['cover', 'Muqova', '.png,.jpg,.jpeg,.webp', false], ['bgvideo', 'Fon videosi', '.mp4,.mov,.webm,.mkv', false]],
      fight: [['clip', 'Jang lavhasi', '.mp4,.mov,.mkv,.webm,.avi', true], ['voice', 'O‘z ovozingiz', '.mp3,.wav,.m4a', false]],
      explainer: [['character', 'Shu video personaji (bo‘lmasa — kanalniki)', '.png,.jpg,.jpeg,.webp', false], ['music', 'Fon musiqasi', '.mp3,.wav,.m4a,.ogg', false]],
    }[p.type];
    const texts = {
      music: [['songTitle', 'Qo‘shiq nomi'], ['genre', 'Janr'], ['mood', 'Kayfiyat'], ['lyricsLanguage', 'Qo‘shiq tili']],
      fight: [['fighters', 'Jangchilar'], ['event', 'Turnir / kontekst']],
      explainer: [['idea', 'G‘oya / mavzu'], ['targetMinutes', 'Uzun video (daqiqa)'], ['targetSeconds', 'Shorts (soniya)'], ['notes', 'AI uchun eslatmalar']],
    }[p.type];
    const big = { music: ['lyrics', 'Qo‘shiq matni (asl)'], fight: ['notes', 'Tahlil uchun eslatmalar'], explainer: ['ownScript', 'O‘z ssenariyingiz (bo‘lsa, AI yozmaydi)'] }[p.type];
    return `
      <div class="grid grid-2">
        ${files.map(([f, label, accept, req]) => {
          const name = p.inputs[`${f}File`];
          return `<div><label>${label}${req ? ' *' : ''}</label>
            <div class="row">${name ? `<a href="/files/${p.id}/${esc(name)}" target="_blank">${esc(name)}</a>` : '<span class="sub">yuklanmagan</span>'}
              ${!req && name ? `<button class="btn small danger" data-remove="${f}" type="button">O‘chirish</button>` : ''}</div>
            <input type="file" data-file="${f}" accept="${accept}" style="margin-top:6px"></div>`;
        }).join('')}
      </div>
      <div class="grid grid-2">${texts.map(([k, l]) => `<div><label>${l}</label><input data-input="${k}" value="${esc(p.inputs[k] || '')}"></div>`).join('')}</div>
      <label>${big[1]}</label><textarea data-input="${big[0]}" rows="5">${esc(p.inputs[big[0]] || '')}</textarea>
      <div class="help">Bu ma’lumotlar o‘zgarsa, AI matnni yangilashi uchun “AI bilan qayta yaratish” tugmasini bosing.</div>
      <div class="row" style="margin-top:10px"><button class="btn" id="save-inputs" type="button">Saqlash</button><span class="upload-progress" id="file-progress"></span></div>`;
  };

  const contentHtml = () => {
    const c = p.content || {};
    if (p.type === 'music') {
      return `
        <div class="grid grid-2">
          <div><label>Prevyu yozuvi</label><input data-content="thumbnailText" value="${esc(c.thumbnailText || '')}" maxlength="60"></div>
          <div><label>Shorts boshlanishi (soniya)</label><input data-content="shortStart" type="number" min="0" step="0.5" value="${c.shortStart ?? ''}" placeholder="avto: ${p.analysis ? Math.round(p.analysis.shortStart) : '—'}">
            <div class="help">Bo‘sh qoldirsangiz, eng kuchli parcha avtomatik tanlanadi.</div></div>
        </div>
        <label>Qo‘shiq matni vaqtlari (LRC) ${c.lyricsSource === 'even' ? '<span class="badge warn">taxminiy — tekshiring</span>' : ''}</label>
        <textarea data-content="lyricsLrc" rows="12" style="font-family:ui-monospace,Consolas,monospace">${esc(c.lyricsLrc || '')}</textarea>
        <div class="help">Har qator: [daqiqa:soniya.yuzlik] matn. Masalan [01:05.20] You are my midnight echo</div>
        <label>Inglizcha tarjima qatori (har qatorga bittadan, yuqoridagi tartibda)</label>
        <textarea data-content="translationText" rows="6" placeholder="Qo‘shiq tili inglizcha bo‘lmasa, AI o‘zi tarjima qiladi. Bu yerda tahrirlash mumkin.">${esc((c.translation?.lines || []).join('\n'))}</textarea>
        ${p.analysis?.shorts?.length ? `<div class="help">Shorts parchalari: ${p.analysis.shorts.map((x, i) => `${i + 1}) ${fmtSec(x.start)}–${fmtSec(x.start + x.length)}`).join(' · ')}</div>` : ''}`;
    }
    if (p.type === 'explainer') return explainerContentHtml(c);
    const words = (c.narration || '').split(/\s+/).filter(Boolean).length;
    return `
      <div class="grid grid-2">
        <div><label>Format</label><select data-format>
          <option value="short" ${p.format !== 'long' ? 'selected' : ''}>Shorts (vertikal)</option>
          <option value="long" ${p.format === 'long' ? 'selected' : ''}>Uzun video (gorizontal)</option></select>
          <div class="help">Format o‘zgarsa, “AI bilan qayta yaratish” tavsiya etiladi (matn uzunligi moslashadi).</div></div>
        <div><label>Prevyu yozuvi</label><input data-content="thumbnailText" value="${esc(c.thumbnailText || '')}" maxlength="60"></div>
      </div>
      <div class="grid grid-3">
        <div><label>Muhim lahza (soniya, asl lavhada)</label><input data-content="keyMoment" type="number" min="0" step="0.1" value="${c.keyMoment ?? ''}" placeholder="avto: ${p.analysis?.key ? p.analysis.key.t.toFixed(1) : '—'}"></div>
        <div><label>Belgi joyi — gorizontal (0–1)</label><input data-content="focusX" type="number" min="0" max="1" step="0.05" value="${c.focusX ?? ''}" placeholder="avto: ${p.analysis?.key ? p.analysis.key.fx.toFixed(2) : '0.5'}"></div>
        <div><label>Belgi joyi — vertikal (0–1)</label><input data-content="focusY" type="number" min="0" max="1" step="0.05" value="${c.focusY ?? ''}" placeholder="avto: ${p.analysis?.key ? p.analysis.key.fy.toFixed(2) : '0.5'}"></div>
      </div>
      <label class="check" style="margin-top:8px"><input type="checkbox" data-effects-off ${c.effectsOff ? 'checked' : ''}> Bu videoda effektlarni o‘chirish (to‘xtash, yaqinlashtirish, sekin takror)</label>
      <div class="help">Lahza bo‘sh qolsa, dastur harakat va ovoz eng keskin bo‘lgan joyni o‘zi topadi. 0,0 — chap yuqori burchak, 1,1 — o‘ng pastki burchak.</div>
      <label>Ekrandagi hook (birinchi 3 soniya)</label><input data-content="hook" value="${esc(c.hook || '')}">
      <label>Diktor matni (inglizcha)</label><textarea data-content="narration" rows="9">${esc(c.narration || '')}</textarea>
      <div class="help" id="narr-count">${words} so‘z ≈ ${Math.round(words / 2.5)} s ovoz${p.analysis ? ` · lavha ${Math.round(p.analysis.target)} s` : ''}</div>`;
  };

  const sceneWords = (scenes) => scenes.reduce((n, sc) => n + String(sc.narration || '').split(/\s+/).filter(Boolean).length, 0);
  const explainerContentHtml = (c) => {
    const sc = c.script;
    const formatSel = `<div><label>Format</label><select data-format>
        <option value="long" ${p.format === 'long' ? 'selected' : ''}>Uzun video (gorizontal)</option>
        <option value="short" ${p.format !== 'long' ? 'selected' : ''}>Shorts (vertikal)</option></select>
        <div class="help">Format o‘zgarsa, “AI bilan qayta yaratish” tavsiya etiladi (ssenariy uzunligi moslashadi).</div></div>`;
    if (!sc?.scenes?.length) return `<div class="grid grid-2">${formatSel}</div><div class="empty-state">Ssenariy hali yozilmagan — bosqichlar tugashini kuting.</div>`;
    const words = sceneWords(sc.scenes);
    return `
      <div class="grid grid-2">
        <div><label>Video nomi (ssenariy)</label><input data-content="scriptTitle" value="${esc(sc.title || '')}" maxlength="100"></div>
        <div><label>Prevyu yozuvi</label><input data-content="thumbnailText" value="${esc(c.thumbnailText || '')}" maxlength="60"></div>
        ${formatSel}
        <div><label>Hajm</label><div class="sub" id="scene-count">${sc.scenes.length} sahna · ${words} so‘z ≈ ${fmtSec(words / 2.5)}</div></div>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:16px"><h3 style="margin:0">Sahnalar</h3>
        <button class="btn small" type="button" id="copy-prompts">📋 Rasm va ovoz promptlarini nusxalash</button></div>
      <div class="help">Matnni o‘zgartirsangiz — faqat shu sahnaning ovozi qayta yoziladi; rasm tavsifini o‘zgartirsangiz — faqat shu rasm qayta chiziladi. Diktor matnini bo‘shatsangiz, sahna o‘chadi. 🖼/🎤 tugmalari bilan istalgan sahnaga o‘zingiz yasagan rasm yoki ovozni qo‘yasiz.</div>
      <datalist id="sfx-names">${['whoosh', 'pop', 'ding', 'click', 'thud', 'rise', 'boing'].map((n) => `<option value="${n}">`).join('')}</datalist>
      <div class="scenes">${sc.scenes.map((x, i) => `
        <div class="scene" data-scene="${i}">
          <div>
            ${x.imageFile ? `<a href="/files/${p.id}/${esc(x.imageFile)}?v=${stamp()}" target="_blank"><img alt="Sahna ${i + 1}" src="/files/${p.id}/${esc(x.imageFile)}?v=${stamp()}"></a>` : '<div class="scene-ph">rasm yo‘q</div>'}
            <div class="row scene-tools">
              <label class="btn small" title="O‘z rasmingizni qo‘yish">🖼<input type="file" hidden data-scene-file="image" accept=".png,.jpg,.jpeg,.webp"></label>
              <label class="btn small" title="O‘z ovozingizni qo‘yish">🎤<input type="file" hidden data-scene-file="voice" accept=".mp3,.wav,.m4a,.ogg,.flac"></label>
              ${x.imageManual ? '<button type="button" class="btn small" data-scene-reset="image" title="Rasmni AI chizsin">↺🖼</button>' : ''}
              ${x.voiceManual ? '<button type="button" class="btn small" data-scene-reset="voice" title="Ovozni AI yozsin">↺🎤</button>' : ''}
            </div>
            ${x.imageManual || x.voiceManual ? `<div class="help">O‘zingizniki: ${[x.imageManual && 'rasm', x.voiceManual && 'ovoz'].filter(Boolean).join(', ')}</div>` : ''}
            ${x.voiceFile ? `<audio controls preload="none" src="/files/${p.id}/${esc(x.voiceFile)}"></audio>` : ''}
          </div>
          <div>
            <label>${i + 1}. Diktor matni ${x.duration ? `<span class="help">${x.duration.toFixed(1)} s</span>` : ''}</label>
            <textarea data-scene-narration rows="3">${esc(x.narration)}</textarea>
            <div class="grid grid-3">
              <div><label>Tepadagi yorliq</label><input data-scene-label value="${esc(x.label || '')}" maxlength="40" placeholder="TINY CHEMICAL ATTACK"></div>
              <div><label>Sariq so‘zlar</label><input data-scene-highlight value="${esc((x.highlight || []).join(', '))}" placeholder="chemical, attack"></div>
              <div><label>Effekt</label><input data-scene-sfx value="${esc(x.sfx || '')}" list="sfx-names" placeholder="whoosh"></div>
            </div>
            <label>Rasm tavsifi (AI uchun, inglizcha)</label>
            <textarea data-scene-visual rows="2">${esc(x.visual)}</textarea>
          </div>
        </div>`).join('')}</div>
      <button class="btn small" type="button" id="add-scene" style="margin-top:8px">+ Sahna qo‘shish</button>`;
  };

  const outputHtml = (o) => {
    const titles = p.type === 'music' ? (o.kind === 'long' ? p.content.seo?.titles : p.content.seo?.shortTitles) : p.content.seo?.titles;
    return `
      <div class="card" data-output="${o.id}">
        <div class="row" style="justify-content:space-between"><h2>${esc(outputLabel(o))} ${o.duration ? `<span class="sub">· ${fmtSec(o.duration)}</span>` : ''}</h2><div id="up-${o.id}">${uploadHtml(o)}</div></div>
        <div class="output">
          <div>
            ${o.file ? `<video controls preload="metadata" src="/files/${p.id}/${esc(o.file)}?v=${stamp()}"></video>` : '<div class="empty-state">Video hali tayyor emas</div>'}
            ${o.thumbnail ? `<img class="thumb" alt="Prevyu" src="/files/${p.id}/${esc(o.thumbnail)}?v=${stamp()}">` : ''}
          </div>
          <div>
            <label>Sarlavha <span class="help" data-count>${o.title.length}/100</span></label>
            <input data-o="title" value="${esc(o.title)}" maxlength="100">
            ${titles?.length > 1 ? `<div class="row" style="margin-top:6px">${titles.map((t) => `<button type="button" class="btn small" data-pick="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
            <label>Tavsif</label><textarea data-o="description" rows="7">${esc(o.description)}</textarea>
            <label>Teglar (vergul bilan)</label><input data-o="tags" value="${esc(o.tags.join(', '))}">
            <div class="grid grid-2">
              <div><label>Ko‘rinish</label><select data-o="privacy">${['public', 'unlisted', 'private'].map((v) => `<option value="${v}" ${o.privacy === v ? 'selected' : ''}>${{ public: 'Ommaviy', unlisted: 'Havola orqali', private: 'Yopiq' }[v]}</option>`).join('')}</select></div>
              <div><label>Chiqish vaqti</label><input type="datetime-local" data-o="publishAt" value="${toLocalInput(o.publishAt)}"><div class="help">Bo‘sh bo‘lsa, tasdiqlashda keyingi bo‘sh slot beriladi.</div></div>
            </div>
            <label class="check" style="margin-top:12px"><input type="checkbox" data-o="aiDisclosure" ${o.aiDisclosure ? 'checked' : ''}> Haqiqiydek ko‘rinadigan AI kontenti (YouTube’da “altered or synthetic” belgisi)</label>
            <div class="row" style="margin-top:14px">
              <button class="btn" type="button" data-save-output>💾 Saqlash</button>
              ${o.file ? `<a class="btn" href="/files/${p.id}/${esc(o.file)}?download=1">⬇️ Yuklab olish</a>` : ''}
              ${o.file && o.kind === 'short' ? '<button class="btn" type="button" data-social>📱 TikTok/Reels matni</button>' : ''}
              ${o.file && !['done', 'uploading'].includes(o.upload.status) ? '<button class="btn" type="button" data-upload-now>📤 Hozir YouTube’ga yuklash</button>' : ''}
            </div>
          </div>
        </div>
      </div>`;
  };

  const draw = () => {
    const canApprove = p.status === 'review' && p.outputs.some((o) => o.file);
    main.innerHTML = `
      <div class="page-head">
        <div><div class="sub"><a href="#/projects">Loyihalar</a> / ${esc(channel?.name)}</div><h1>${esc(p.title)}</h1><div id="p-status">${statusHtml()}</div></div>
        <div class="row">
          ${canApprove ? '<button class="btn primary" id="approve">✅ Tasdiqlash va jadvalga qo‘yish</button>' : ''}
          ${p.status === 'approved' ? '<button class="btn" id="unapprove">↩️ Tasdiqni bekor qilish</button>' : ''}
          <button class="btn" id="rerun" ${busy() ? 'disabled' : ''}>🔁 Qayta montaj</button>
          <button class="btn" id="regen" ${busy() ? 'disabled' : ''}>✨ AI bilan qayta yaratish</button>
          <button class="btn danger" id="delete" ${busy() ? 'disabled' : ''}>🗑</button>
        </div>
      </div>
      ${p.error ? `<div class="alert bad"><b>Xato:</b> ${esc(p.error)}<div class="help">Muammoni tuzatib, “Qayta montaj” bosing.</div></div>` : ''}
      ${p.status === 'review' ? '<div class="alert info">Video tayyor. Ko‘rib chiqing, kerak bo‘lsa sarlavha va matnni tahrirlang, so‘ng tasdiqlang — dastur uni jadval bo‘yicha YouTube’ga joylaydi.</div>' : ''}
      <div class="grid grid-2">
        <div class="card"><h2>Bosqichlar</h2><ul class="steps" id="p-steps">${stepsHtml()}</ul></div>
        <div class="card"><h2>Jurnal</h2><div class="log" id="p-log">${logHtml()}</div></div>
      </div>
      ${p.outputs.map(outputHtml).join('')}
      <div class="card" id="content-card"><h2>${{ music: 'Qo‘shiq matni va Shorts parchasi', fight: 'Ssenariy va ovoz', explainer: '🎬 Ssenariy va sahnalar' }[p.type]}</h2>${contentHtml()}
        <div class="row" style="margin-top:14px">
          <button class="btn" type="button" id="save-content">💾 Saqlash</button>
          <button class="btn primary" type="button" id="save-rerun" ${busy() ? 'disabled' : ''}>💾 Saqlash va qayta montaj</button>
        </div>
        <div class="help">Qayta montaj bepul: AI natijalari (matn, SEO, ovoz) keshdan olinadi. Faqat “AI bilan qayta yaratish” qayta pul sarflaydi.</div>
      </div>
      <details class="card"><summary><b>Kiritilgan materiallar</b></summary>${inputsHtml()}</details>`;
    const logEl = document.getElementById('p-log');
    logEl.scrollTop = logEl.scrollHeight;
    bind();
  };

  const reload = async () => {
    p = await api('GET', `/api/projects/${id}`);
    draw();
  };

  const run = async (opts = {}) => {
    try {
      await api('POST', `/api/projects/${id}/run`, opts);
      toast(opts.regenerate ? 'AI hammasini qayta yaratadi' : 'Qayta montaj navbatga qo‘yildi', 'ok');
      await reload();
    } catch (err) {
      toast(err.message, 'bad');
    }
  };

  const collectContent = () => {
    const body = {};
    const c = p.content || {};
    main.querySelectorAll('[data-content]').forEach((el) => {
      const k = el.dataset.content;
      const orig = k === 'translationText' ? (c.translation?.lines || []).join('\n') : k === 'scriptTitle' ? c.script?.title ?? '' : c[k] ?? '';
      if (String(el.value) !== String(orig)) body[k] = el.value;
    });
    return body;
  };

  const saveContent = async () => {
    const content = collectContent();
    const fmt = main.querySelector('[data-format]');
    const fx = main.querySelector('[data-effects-off]');
    if (fx && fx.checked !== Boolean(p.content.effectsOff)) content.effectsOff = fx.checked;
    const sceneEls = [...main.querySelectorAll('[data-scene]')];
    if (sceneEls.length) {
      const val = (el, k) => el.querySelector(`[data-scene-${k}]`)?.value.trim() ?? '';
      const scenes = sceneEls.map((el) => ({
        from: el.dataset.scene === 'new' ? null : Number(el.dataset.scene),
        narration: val(el, 'narration'),
        visual: val(el, 'visual'),
        label: val(el, 'label'),
        highlight: val(el, 'highlight').split(',').map((x) => x.trim()).filter(Boolean),
        sfx: val(el, 'sfx'),
      }));
      const old = p.content.script?.scenes || [];
      const same = (x, o) => o && x.narration === o.narration && x.visual === o.visual && x.label === (o.label || '') && x.sfx === (o.sfx || '') && x.highlight.join() === (o.highlight || []).join();
      if (scenes.length !== old.length || scenes.some((x, i) => !same(x, old[i]))) {
        // Effekt maydoni o'zgarmagan bo'lsa, uni yubormaymiz (AI tanlovi saqlanadi)
        if (scenes.every((x, i) => x.sfx === (old[i]?.sfx || ''))) scenes.forEach((x) => delete x.sfx);
        content.scenes = scenes;
      }
    }
    const body = { content };
    if (fmt && fmt.value !== p.format) body.format = fmt.value;
    if (!Object.keys(content).length && !body.format) return false;
    p = await api('PUT', `/api/projects/${id}`, body);
    return true;
  };

  function bind() {
    document.getElementById('approve')?.addEventListener('click', async () => {
      try {
        p = await api('POST', `/api/projects/${id}/approve`);
        const when = p.outputs.filter((o) => o.publishAt).map((o) => `${outputLabel(o)}: ${fmtDate(o.publishAt)}`).join(', ');
        toast(`Jadvalga qo‘yildi — ${when}`, 'ok');
        draw();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    document.getElementById('unapprove')?.addEventListener('click', async () => {
      p = await api('POST', `/api/projects/${id}/unapprove`);
      draw();
    });
    document.getElementById('rerun').addEventListener('click', () => run());
    document.getElementById('regen').addEventListener('click', () => {
      if (confirm('AI matn, SEO va ovozni qaytadan yaratadi (pullik). Qo‘lda qilgan tahrirlar almashtiriladi. Davom etilsinmi?')) run({ regenerate: true });
    });
    document.getElementById('delete').addEventListener('click', async () => {
      if (!confirm('Loyiha va uning barcha fayllari o‘chiriladi. YouTube’dagi videolarga tegilmaydi. Davom etilsinmi?')) return;
      try {
        await api('DELETE', `/api/projects/${id}`);
        location.hash = '#/projects';
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    document.getElementById('save-content').addEventListener('click', async () => {
      try {
        toast((await saveContent()) ? 'Saqlandi' : 'O‘zgarish yo‘q', 'ok');
        draw();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    document.getElementById('save-rerun').addEventListener('click', async () => {
      try {
        await saveContent();
        await run();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    document.getElementById('copy-prompts')?.addEventListener('click', async () => {
      const { text } = await api('GET', `/api/projects/${id}/prompts`);
      try {
        await navigator.clipboard.writeText(text);
        toast('Promptlar nusxalandi — ChatGPT / AI Studio’ga joylang', 'ok');
      } catch {
        prompt('Nusxa oling:', text);
      }
    });
    main.querySelectorAll('[data-scene-file]').forEach((input) => input.addEventListener('change', async () => {
      const file = input.files[0];
      const idx = input.closest('[data-scene]').dataset.scene;
      if (!file || idx === 'new') return;
      try {
        await saveContent();
        const kind = input.dataset.sceneFile;
        await putFile(`/api/projects/${id}/scenes/${idx}/${kind}?name=${encodeURIComponent(file.name)}`, file);
        toast(`${Number(idx) + 1}-sahna ${kind === 'image' ? 'rasmi' : 'ovozi'} almashtirildi. “Qayta montaj” bosing.`, 'ok');
        await reload();
      } catch (err) {
        toast(err.message, 'bad');
      }
    }));
    main.querySelectorAll('[data-scene-reset]').forEach((b) => b.addEventListener('click', async () => {
      const idx = b.closest('[data-scene]').dataset.scene;
      p = await api('DELETE', `/api/projects/${id}/scenes/${idx}/${b.dataset.sceneReset}`);
      toast('Keyingi montajda AI qayta yaratadi', 'ok');
      draw();
    }));
    document.getElementById('add-scene')?.addEventListener('click', () => {
      const list = main.querySelector('.scenes');
      const i = list.children.length;
      list.insertAdjacentHTML('beforeend', `<div class="scene" data-scene="new"><div class="scene-ph">yangi</div><div>
        <label>${i + 1}. Diktor matni</label><textarea data-scene-narration rows="3"></textarea>
        <div class="grid grid-3"><div><label>Tepadagi yorliq</label><input data-scene-label maxlength="40"></div><div><label>Sariq so‘zlar</label><input data-scene-highlight></div><div><label>Effekt</label><input data-scene-sfx list="sfx-names"></div></div>
        <label>Rasm tavsifi (AI uchun, inglizcha)</label><textarea data-scene-visual rows="2" placeholder="Bo‘sh qolsa, matndan avtomatik tuziladi"></textarea></div></div>`);
      list.lastElementChild.querySelector('textarea').focus();
    });
    const narr = main.querySelector('[data-content="narration"]');
    narr?.addEventListener('input', () => {
      const words = narr.value.split(/\s+/).filter(Boolean).length;
      document.getElementById('narr-count').textContent = `${words} so‘z ≈ ${Math.round(words / 2.5)} s ovoz${p.analysis ? ` · lavha ${Math.round(p.analysis.target)} s` : ''}`;
    });

    main.querySelectorAll('[data-output]').forEach((card) => {
      const oid = card.dataset.output;
      const title = card.querySelector('[data-o="title"]');
      const counter = card.querySelector('[data-count]');
      title.addEventListener('input', () => {
        counter.textContent = `${title.value.length}/100`;
      });
      card.querySelectorAll('[data-pick]').forEach((b) =>
        b.addEventListener('click', () => {
          title.value = b.dataset.pick.slice(0, 100);
          counter.textContent = `${title.value.length}/100`;
        }),
      );
      card.querySelector('[data-save-output]').addEventListener('click', async () => {
        const get = (k) => card.querySelector(`[data-o="${k}"]`);
        const local = get('publishAt').value;
        try {
          p = await api('PUT', `/api/projects/${id}`, {
            outputs: [{
              id: oid,
              title: get('title').value,
              description: get('description').value,
              tags: get('tags').value,
              privacy: get('privacy').value,
              aiDisclosure: get('aiDisclosure').checked,
              publishAt: local ? new Date(local).toISOString() : null,
            }],
          });
          toast('Saqlandi', 'ok');
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
      card.querySelector('[data-social]')?.addEventListener('click', async () => {
        const o = p.outputs.find((x) => x.id === oid);
        const text = socialCaption(o);
        try {
          await navigator.clipboard.writeText(text);
          toast('Matn nusxalandi — videoni yuklab olib, TikTok/Reels’ga joylang', 'ok');
        } catch {
          prompt('Matnni nusxa oling:', text);
        }
      });
      card.querySelector('[data-upload-now]')?.addEventListener('click', async () => {
        if (!confirm('Video hozir YouTube’ga yuklanadi (jadvalni kutmasdan). Davom etilsinmi?')) return;
        try {
          p = await api('POST', `/api/projects/${id}/outputs/${oid}/upload-now`);
          toast('Yuklash boshlandi', 'ok');
          draw();
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
    });

    main.querySelectorAll('[data-file]').forEach((input) =>
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const prog = document.getElementById('file-progress');
        try {
          await uploadFile(id, input.dataset.file, file, (pct) => {
            prog.textContent = `${file.name}: ${pct}%`;
          });
          toast('Fayl almashtirildi. “Qayta montaj” bosing.', 'ok');
          await reload();
        } catch (err) {
          toast(err.message, 'bad');
        }
      }),
    );
    main.querySelectorAll('[data-remove]').forEach((b) =>
      b.addEventListener('click', async () => {
        await api('DELETE', `/api/projects/${id}/upload?field=${b.dataset.remove}`);
        await reload();
      }),
    );
    document.getElementById('save-inputs').addEventListener('click', async () => {
      const inputs = {};
      main.querySelectorAll('[data-input]').forEach((el) => {
        inputs[el.dataset.input] = el.value;
      });
      try {
        p = await api('PUT', `/api/projects/${id}`, { inputs });
        toast('Saqlandi', 'ok');
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  }

  draw();

  // Holatni jonli yangilash: tahrir maydonlariga tegmasdan faqat holat bloklari yangilanadi.
  poll(async () => {
    const fresh = await api('GET', `/api/projects/${id}`);
    const statusChanged = fresh.status !== p.status;
    const filesChanged = fresh.outputs.map((o) => o.file).join() !== p.outputs.map((o) => o.file).join();
    p.steps = fresh.steps;
    p.log = fresh.log;
    p.cost = fresh.cost;
    for (const o of fresh.outputs) {
      const local = p.outputs.find((x) => x.id === o.id);
      if (local) local.upload = o.upload;
    }
    if (statusChanged || filesChanged) {
      p = fresh;
      draw();
      return;
    }
    document.getElementById('p-steps').innerHTML = stepsHtml();
    const logEl = document.getElementById('p-log');
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
    logEl.textContent = '';
    logEl.innerHTML = logHtml();
    if (atBottom) logEl.scrollTop = logEl.scrollHeight;
    document.getElementById('p-status').innerHTML = statusHtml();
    for (const o of p.outputs) {
      const el = document.getElementById(`up-${o.id}`);
      if (el) el.innerHTML = uploadHtml(o);
    }
  }, 2000);
};

// ---------- Jadval ----------
views.schedule = async () => {
  const { days, channels } = await api('GET', '/api/schedule?days=21');
  const today = new Date().toDateString();
  main.innerHTML = `
    <div class="page-head"><div><h1>Chiqarish jadvali</h1><div class="sub">Har kanalga kuniga bitta video. Video chiqishdan bir necha soat oldin “yopiq + jadvalli” holatda yuklanadi.</div></div></div>
    ${channels.some((c) => !c.youtube.connected) ? '<div class="alert warn">Ba’zi kanallar YouTube’ga ulanmagan — ularning videolari ulanmaguncha kutib turadi. <a href="#/settings">Sozlamalar</a></div>' : ''}
    <div class="card table-wrap"><table class="cal">
      <thead><tr><th>Kun</th>${channels.map((c) => `<th><span class="dot" style="background:${esc(c.colors.primary)}"></span>${esc(c.name)}</th>`).join('')}</tr></thead>
      <tbody>${days.map((d) => {
        const date = new Date(`${d.date}T12:00:00`);
        return `<tr><td><b>${fmtDate(date.toISOString(), false)}</b>${date.toDateString() === today ? ' <span class="badge info">bugun</span>' : ''}<div class="help">${date.toLocaleDateString('uz-UZ', { weekday: 'long' })}</div></td>
          ${channels.map((c) => {
            const cell = d.channels[c.id];
            return `<td><div class="slot">⏰ ${fmtDate(cell.slot).slice(11)}</div>
              ${cell.items.length ? cell.items.map((it) => `<a class="item" href="#/project/${it.projectId}">${esc(outputLabel({ kind: it.kind, id: it.outputId }))} · ${esc(it.title)}<br>${badge(UPLOAD_STATUS, it.upload)}</a>`).join('') : '<div class="empty">bo‘sh</div>'}</td>`;
          }).join('')}</tr>`;
      }).join('')}</tbody></table></div>`;
};

// ---------- Xarajatlar ----------
views.costs = async () => {
  const channels = await getChannels();
  const draw = async () => {
    const c = await api('GET', '/api/costs');
    const s = (await api('GET', '/api/settings')).settings;
    main.innerHTML = `
      <div class="page-head"><div><h1>Xarajatlar</h1><div class="sub">${esc(c.month)} · oylik chegara ${money(c.budget)}</div></div></div>
      ${c.total >= c.budget && c.budget > 0 ? '<div class="alert bad">Oylik byudjet tugadi: pullik AI chaqiruvlari to‘xtatildi, montaj bepul davom etadi.</div>' : ''}
      <div class="grid grid-4">
        <div class="card kpi"><div class="label">Jami (shu oy)</div><div class="value">${money(c.total)}</div>${budgetBar(c.total, c.budget)}</div>
        <div class="card kpi"><div class="label">AI xizmatlari</div><div class="value">${money(c.variable)}</div></div>
        <div class="card kpi"><div class="label">Obunalar</div><div class="value">${money(c.fixed)}</div><div class="hint">${(s.fixedMonthly || []).map((f) => `${esc(f.name)}: ${money(f.amount)}`).join(', ')}</div></div>
        <div class="card kpi"><div class="label">Bir videoga</div><div class="value">${c.perVideo != null ? money(c.perVideo) : '—'}</div><div class="hint">${c.videos} ta video · bashorat ${money(c.projected)}</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card"><h2>Turlar bo‘yicha</h2>${Object.keys(c.byKind).length ? `<table>${Object.entries(c.byKind).map(([k, v]) => `<tr><td>${esc(COST_KIND[k] || k)}</td><td>${money(v)}</td></tr>`).join('')}</table>` : '<div class="sub">Hali AI xarajati yo‘q</div>'}
          <h3 style="margin-top:16px">Kanallar bo‘yicha</h3>${Object.keys(c.byChannel).length ? `<table>${Object.entries(c.byChannel).map(([k, v]) => `<tr><td>${esc(channels.find((x) => x.id === k)?.name || k)}</td><td>${money(v)}</td></tr>`).join('')}</table>` : '<div class="sub">—</div>'}
        </div>
        <form class="card" id="cost-form"><h2>Qo‘lda xarajat qo‘shish</h2>
          <div class="help">Masalan, Suno kreditlari yoki boshqa xizmat to‘lovi. Doimiy obunalar Sozlamalarda.</div>
          <div class="grid grid-2"><div><label>Summa ($)</label><input name="amount" type="number" step="0.01" min="0.01" required></div>
          <div><label>Kanal</label><select name="channelId"><option value="">Umumiy</option>${channels.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div></div>
          <label>Izoh</label><input name="note" maxlength="200">
          <button class="btn primary" style="margin-top:12px">Qo‘shish</button>
        </form>
      </div>
      <div class="card"><h2>Yozuvlar</h2>
        <div class="help">AI xarajatlari Sozlamalardagi narxlar asosida taxminan hisoblanadi. Aniq summani xizmatlarning hisob-kitob sahifasida tekshiring.</div>
        ${c.entries.length ? `<div class="table-wrap"><table><thead><tr><th>Vaqt</th><th>Turi</th><th>Izoh</th><th>Summa</th><th></th></tr></thead><tbody>
          ${c.entries.map((e) => `<tr><td>${fmtDate(e.at)}</td><td>${esc(COST_KIND[e.kind] || e.kind)}</td><td>${esc(e.note)}${e.projectId ? ` · <a href="#/project/${e.projectId}">loyiha</a>` : ''}</td><td>${money(e.amount)}</td><td><button class="btn small danger" data-del="${e.id}">✕</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty-state">Shu oy yozuv yo‘q</div>'}
      </div>`;
    document.getElementById('cost-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('POST', '/api/costs', Object.fromEntries(fd));
        await draw();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    main.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        await api('DELETE', `/api/costs/${b.dataset.del}`);
        await draw();
      }),
    );
  };
  await draw();
};

// ---------- Analiz ----------
views.analytics = async (parts, query) => {
  const channels = await getChannels();
  if (!channels.length) {
    main.innerHTML = noChannelsHtml('Analiz');
    return;
  }
  const current = channels.find((c) => c.id === query.get('channel')) || channels[0];
  main.innerHTML = `
    <div class="page-head"><div><h1>Analiz</h1><div class="sub">Kanalning ochiq statistikasi va AI tavsiyalari</div></div></div>
    <div class="channel-pick">${channels.map((c) => `<button type="button" data-ch="${c.id}" class="${c.id === current.id ? 'active' : ''}"><b><span class="dot" style="background:${esc(c.colors.primary)}"></span>${esc(c.name)}</b><div class="help">${esc(c.handle || '')}</div></button>`).join('')}</div>
    <div id="report"><div class="empty-state">Yuklanmoqda…</div></div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2>Chuqur statistika (28 kun)</h2><button class="btn" id="deep-btn">📊 Yuklash</button></div>
      <div class="help">Tomosha foizi, o‘rtacha davomiylik va obunachi o‘sishi. Qatorni bosing — tomoshabin videoning qayerida chiqib ketganini ko‘rasiz. Kanal ulangan bo‘lishi kerak.</div>
      <div id="deep-box"></div><div id="retention-box"></div></div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2>Trendlar (oxirgi 7 kun)</h2><button class="btn" id="trends-btn">🔥 Qidirish</button></div>
      <div class="help">Soha kalit so‘zlari: <b>${esc(current.nicheKeywords || 'kiritilmagan — Sozlamalar → Kanallar')}</b>. Har qidiruv YouTube kunlik kvotasidan sezilarli qism oladi — kuniga 1–2 marta yetarli.</div>
      <div id="trends-box"></div></div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2>Javobsiz izohlar</h2><div class="row"><button class="btn" id="comments-btn">💬 Yuklash</button><button class="btn" id="drafts-btn" disabled>✨ AI javob qoralamalari</button></div></div>
      <div class="help">AI qoralama yozadi, siz tekshirib “Javob berish”ni bosasiz — hech narsa o‘zicha joylanmaydi.</div>
      <div id="comments-box"></div></div>`;
  main.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => {
    location.hash = `#/analytics?channel=${b.dataset.ch}`;
  }));
  growthTools(current);
  const box = document.getElementById('report');
  let r;
  try {
    r = await api('GET', `/api/analytics/${current.id}`);
  } catch (err) {
    box.innerHTML = `<div class="alert warn">${esc(err.message)}</div>`;
    return;
  }
  const top = r.videos.slice().sort((a, b) => b.viewsPerDay - a.viewsPerDay);
  box.innerHTML = `
    <div class="grid grid-4">
      <div class="card kpi"><div class="label">Obunachilar</div><div class="value">${r.channel.subscribers.toLocaleString()}</div></div>
      <div class="card kpi"><div class="label">Jami ko‘rishlar</div><div class="value">${r.channel.views.toLocaleString()}</div><div class="hint">${r.channel.videoCount} ta video</div></div>
      <div class="card kpi"><div class="label">Shorts o‘rtacha</div><div class="value">${r.averages.shorts.toLocaleString()}</div></div>
      <div class="card kpi"><div class="label">Uzun video o‘rtacha</div><div class="value">${r.averages.long.toLocaleString()}</div></div>
    </div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2>AI tavsiyalari</h2><button class="btn primary" id="insights">✨ Tahlil qilish</button></div><div id="insights-box" class="sub">Oxirgi videolar natijasiga qarab nima ishlayotgani va keyingi mavzular.</div></div>
    <div class="card"><h2>Videolar (kunlik ko‘rish bo‘yicha)</h2><div class="table-wrap"><table>
      <thead><tr><th>Video</th><th>Turi</th><th>Ko‘rish</th><th>Kuniga</th><th>Layk</th><th>Izoh</th><th>Yoshi</th></tr></thead>
      <tbody>${top.map((v) => `<tr><td><a href="https://youtu.be/${esc(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a></td><td>${v.isShort ? 'Shorts' : 'Uzun'}</td><td>${v.views.toLocaleString()}</td><td>${v.viewsPerDay}</td><td>${v.likes}</td><td>${v.comments}</td><td>${v.ageDays} kun</td></tr>`).join('') || '<tr><td colspan="7" class="sub">Video yo‘q</td></tr>'}</tbody>
    </table></div></div>`;
  document.getElementById('insights').addEventListener('click', async (e) => {
    const out = document.getElementById('insights-box');
    e.target.disabled = true;
    out.textContent = 'AI tahlil qilmoqda…';
    try {
      const x = await api('POST', `/api/analytics/${current.id}/insights`);
      out.classList.remove('sub');
      out.innerHTML = `
        <p>${esc(x.summary)}</p>
        <h3>Nima ishlayapti</h3><ul>${(x.whatWorks || []).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
        <h3>Keyingi video g‘oyalari</h3><ul>${(x.ideas || []).map((i) => `<li><b>${esc(i.title)}</b> — ${esc(i.why)}</li>`).join('')}</ul>
        <h3>Sarlavha bo‘yicha maslahatlar</h3><ul>${(x.titleTips || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    } catch (err) {
      out.innerHTML = `<div class="alert warn">${esc(err.message)}</div>`;
    }
    e.target.disabled = false;
  });
};

function growthTools(current) {
  const fail = (box, err) => {
    box.innerHTML = `<div class="alert warn" style="margin-top:10px">${esc(err.message)}</div>`;
  };
  const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

  document.getElementById('deep-btn').addEventListener('click', async () => {
    const box = document.getElementById('deep-box');
    box.innerHTML = '<div class="sub" style="margin-top:10px">Yuklanmoqda…</div>';
    try {
      const r = await api('GET', `/api/analytics/${current.id}/deep?days=28`);
      box.innerHTML = r.videos.length ? `<div class="table-wrap" style="margin-top:10px"><table>
        <thead><tr><th>Video</th><th>Turi</th><th>Ko‘rish</th><th>O‘rtacha tomosha</th><th>Tomosha foizi</th><th>+Obunachi</th><th>Ulashish</th></tr></thead>
        <tbody>${r.videos.map((v) => `<tr class="click" data-ret="${esc(v.id)}" data-title="${esc(v.title)}"><td>${esc(v.title)}</td><td>${v.isShort ? 'Shorts' : 'Uzun'}</td><td>${v.views.toLocaleString()}</td><td>${fmtSec(v.avgDuration)}</td><td>${pct(v.avgPercent)}</td><td>${v.subscribers}</td><td>${v.shares}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="sub" style="margin-top:10px">Bu davrda ma’lumot yo‘q.</div>';
      box.querySelectorAll('[data-ret]').forEach((row) => row.addEventListener('click', () => showRetention(current, row.dataset.ret, row.dataset.title)));
    } catch (err) {
      fail(box, err);
    }
  });

  document.getElementById('trends-btn').addEventListener('click', async (e) => {
    const box = document.getElementById('trends-box');
    e.target.disabled = true;
    box.innerHTML = '<div class="sub" style="margin-top:10px">Qidirilmoqda…</div>';
    try {
      const r = await api('POST', `/api/analytics/${current.id}/trends`);
      const a = r.analysis;
      box.innerHTML = `
        ${a ? `<div style="margin-top:10px"><p>${esc(a.summary)}</p>
          ${a.patterns?.length ? `<h3>Takrorlanayotgan usullar</h3><ul>${a.patterns.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${a.ideas?.length ? `<h3>Bizning kanal uchun g‘oyalar</h3><ul>${a.ideas.map((i) => `<li><b>${esc(i.title)}</b> — ${esc(i.why)}</li>`).join('')}</ul>` : ''}</div>` : ''}
        <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Video</th><th>Kanal</th><th>Turi</th><th>Kuniga ko‘rish</th></tr></thead>
        <tbody>${r.videos.map((v) => `<tr><td><a href="https://youtu.be/${esc(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a></td><td>${esc(v.channel)}</td><td>${v.isShort ? 'Shorts' : 'Uzun'}</td><td>${v.viewsPerDay.toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="4" class="sub">Natija yo‘q</td></tr>'}</tbody></table></div>`;
    } catch (err) {
      fail(box, err);
    }
    e.target.disabled = false;
  });

  let comments = [];
  const draftsBtn = document.getElementById('drafts-btn');
  document.getElementById('comments-btn').addEventListener('click', async () => {
    const box = document.getElementById('comments-box');
    box.innerHTML = '<div class="sub" style="margin-top:10px">Yuklanmoqda…</div>';
    try {
      comments = (await api('GET', `/api/comments/${current.id}`)).comments;
      draftsBtn.disabled = !comments.length;
      box.innerHTML = comments.length ? comments.map((c, i) => `
        <div class="card" style="margin-top:10px" data-comment="${i}">
          <div class="row" style="justify-content:space-between"><b>${esc(c.author)}</b><a class="help" href="https://youtu.be/${esc(c.videoId)}" target="_blank" rel="noopener">${fmtDate(c.publishedAt)}</a></div>
          <p>${esc(c.text)}</p>
          <textarea rows="2" data-reply placeholder="Javobingiz…"></textarea>
          <div class="row" style="margin-top:6px"><button class="btn small primary" data-send>↩️ Javob berish</button><span class="help" data-state></span></div>
        </div>`).join('') : '<div class="sub" style="margin-top:10px">Javobsiz izoh yo‘q 🎉</div>';
      box.querySelectorAll('[data-comment]').forEach((el) => el.querySelector('[data-send]').addEventListener('click', async (e) => {
        const c = comments[Number(el.dataset.comment)];
        const text = el.querySelector('[data-reply]').value;
        e.target.disabled = true;
        try {
          await api('POST', `/api/comments/${current.id}/reply`, { parentId: c.id, text });
          el.querySelector('[data-state]').textContent = '✅ Joylandi';
        } catch (err) {
          toast(err.message, 'bad');
          e.target.disabled = false;
        }
      }));
    } catch (err) {
      fail(box, err);
    }
  });
  draftsBtn.addEventListener('click', async () => {
    draftsBtn.disabled = true;
    try {
      const { replies } = await api('POST', `/api/comments/${current.id}/drafts`, { comments: comments.map(({ author, text }) => ({ author, text })) });
      document.querySelectorAll('[data-comment]').forEach((el) => {
        const draft = replies[Number(el.dataset.comment)];
        if (draft) el.querySelector('[data-reply]').value = draft;
      });
      toast('Qoralamalar tayyor — tekshirib, joylang', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
    draftsBtn.disabled = false;
  });
}

/** Retention: bitta seriyali chiziqli grafik (rang — urg‘u tokeni), sichqoncha bilan qiymat ko‘rinadi. */
async function showRetention(current, videoId, title) {
  const box = document.getElementById('retention-box');
  box.innerHTML = '<div class="sub" style="margin-top:10px">Yuklanmoqda…</div>';
  let points;
  try {
    points = (await api('GET', `/api/analytics/${current.id}/retention/${encodeURIComponent(videoId)}`)).points;
  } catch (err) {
    box.innerHTML = `<div class="alert warn" style="margin-top:10px">${esc(err.message)}</div>`;
    return;
  }
  if (!points.length) {
    box.innerHTML = '<div class="sub" style="margin-top:10px">Bu video uchun hali retention ma’lumoti yo‘q (odatda bir necha yuz ko‘rishdan keyin chiqadi).</div>';
    return;
  }
  const W = 720;
  const H = 240;
  const pad = { l: 44, r: 16, t: 16, b: 28 };
  const maxY = Math.max(1, ...points.map((p) => p.ratio));
  const x = (v) => pad.l + v * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.ratio).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].filter((t) => t <= maxY);
  const at = (frac) => points.reduce((best, p) => (Math.abs(p.x - frac) < Math.abs(best.x - frac) ? p : best), points[0]);
  box.innerHTML = `
    <h3 style="margin-top:16px">Tomoshabinlar qolishi — ${esc(title)}</h3>
    <div class="help">O‘rtada ${Math.round(at(0.5).ratio * 100)}% · oxirida ${Math.round(at(1).ratio * 100)}% tomoshabin qolgan. Keskin tushgan joy — sahnani qisqartirish kerak bo‘lgan joy.</div>
    <div style="position:relative;max-width:${W}px">
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Retention grafigi" style="display:block">
        ${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)" stroke-width="1"/><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(t * 100)}%</text>`).join('')}
        ${[0, 0.5, 1].map((t) => `<text x="${x(t)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${Math.round(t * 100)}%</text>`).join('')}
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <line id="ret-cross" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>
        <circle id="ret-dot" r="4" fill="var(--accent)" stroke="var(--panel)" stroke-width="2" visibility="hidden"/>
        <rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent" id="ret-hit"/>
      </svg>
      <div id="ret-tip" class="toast" style="position:absolute;pointer-events:none;display:none;padding:6px 10px;font-size:13px"></div>
    </div>`;
  const svg = box.querySelector('svg');
  const hit = box.querySelector('#ret-hit');
  const tip = box.querySelector('#ret-tip');
  hit.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const p = at(Math.max(0, Math.min(1, (vx - pad.l) / (W - pad.l - pad.r))));
    for (const el of [box.querySelector('#ret-cross'), box.querySelector('#ret-dot')]) el.setAttribute('visibility', 'visible');
    box.querySelector('#ret-cross').setAttribute('x1', x(p.x));
    box.querySelector('#ret-cross').setAttribute('x2', x(p.x));
    box.querySelector('#ret-dot').setAttribute('cx', x(p.x));
    box.querySelector('#ret-dot').setAttribute('cy', y(p.ratio));
    tip.style.display = 'block';
    tip.style.left = `${(x(p.x) / W) * rect.width + 10}px`;
    tip.style.top = `${(y(p.ratio) / H) * rect.height - 10}px`;
    tip.textContent = `Videoning ${Math.round(p.x * 100)}% qismida — ${Math.round(p.ratio * 100)}% tomoshabin`;
  });
  hit.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
    for (const el of [box.querySelector('#ret-cross'), box.querySelector('#ret-dot')]) el.setAttribute('visibility', 'hidden');
  });
}

// ---------- Raqobatchilar ----------
const fmtNum = (n) => (n == null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
const FORMAT_LABEL = { explainer: 'Animatsion tushuntirish (Pele uslubi)', music: 'Musiqa', fight: 'Jang tahlili', other: 'Boshqa' };
const targetName = (targets, id) => targets.find((t) => t.id === id)?.name || id;

views.competitors = async (parts) => {
  if (parts[0]) return competitorDetail(parts[0]);
  const data = await api('GET', '/api/competitors');
  main.innerHTML = `
    <div class="page-head"><div><h1>🕵️ Raqobatchilar</h1><div class="sub">Raqobatchi kanallarni ulang — dastur ularning eng ko‘p ko‘rilgan videolarini, sarlavha va prevyu formulasini tahlil qiladi va kanallaringiz uchun g‘oya hamda ssenariy yozadi.</div></div>
      <a class="btn primary" href="#/ideas">💡 G‘oyalar va ssenariy</a></div>
    <form class="card" id="comp-add">
      <h2>➕ Raqobatchi qo‘shish</h2>
      <label>Kanal havolasi yoki @handle</label>
      <input name="input" required placeholder="https://www.youtube.com/@PeleExplainss">
      <label>Qaysi kanallarim uchun foydali</label>
      <div class="row">${data.targets.map((t) => `<label class="check"><input type="checkbox" name="target" value="${esc(t.id)}"> ${esc(t.name)}${t.kind === 'planned' ? ' <span class="badge info">reja</span>' : ''}</label>`).join('') || '<span class="sub">Avval kanal yoki rejalashtirilgan kanal qo‘shing</span>'}</div>
      <div class="row" style="margin-top:12px"><button class="btn primary">🔎 Qo‘shish va tahlil qilish</button><span class="help">Ochiq ma’lumot ishlatiladi: YouTube API kaliti yoki ulangan kanalingiz kerak.</span></div>
    </form>
    <div class="grid grid-2">${data.competitors.map((c) => `
      <div class="card">
        <div class="row" style="flex-wrap:nowrap">
          ${c.avatar ? `<img src="${esc(c.avatar)}" alt="" style="width:52px;height:52px;border-radius:50%">` : ''}
          <div style="min-width:0"><h2 style="margin:0">${esc(c.title)}</h2><div class="help">${esc(c.handle || '')} · ${fmtNum(c.subscribers)} obunachi · ${c.videoCount} video</div></div>
        </div>
        <p style="margin-top:10px">O‘rtacha: <b>${fmtNum(c.stats?.medianViews)}</b> ko‘rish · oyiga <b>${c.stats?.uploadsLast30 ?? '—'}</b> video${c.newVideoIds?.length ? ` · <span class="badge ok">${c.newVideoIds.length} ta yangi video</span>` : ''}</p>
        ${c.bestVideo ? `<p class="help">Eng zo‘ri: “${esc(c.bestVideo.title)}” — ${fmtNum(c.bestVideo.views)} (${c.bestVideo.outlier}× o‘rtacha)</p>` : ''}
        <div class="row">${(c.targetIds || []).map((t) => `<span class="badge info">${esc(targetName(data.targets, t))}</span>`).join('')}${c.ai ? '<span class="badge ok">AI tahlil bor</span>' : ''}</div>
        ${c.lastError ? `<div class="help" style="color:var(--bad)">${esc(c.lastError)}</div>` : ''}
        <div class="row" style="margin-top:10px">
          <a class="btn primary" href="#/competitors/${c.id}">📊 Tahlil</a>
          <a class="btn" href="#/ideas?competitor=${c.id}">💡 G‘oyalar</a>
          <button class="btn danger" data-del="${c.id}">🗑</button>
        </div>
        <div class="help">Yangilangan: ${fmtDate(c.lastSync)} · har kuni o‘zi yangilanadi</div>
      </div>`).join('') || '<div class="card empty-state">Hali raqobatchi yo‘q. Yuqoridan qo‘shing — masalan, rasmdagi kanal: <code>@PeleExplainss</code></div>'}
    </div>
    <div class="card">
      <h2>🗂 Rejalashtirilgan kanallar</h2>
      <p class="sub">Hali ochilmagan kanal uchun ham g‘oya va ssenariy olish mumkin — kanal profilini shu yerda yozing.</p>
      ${data.planned.map((p) => `<div class="issue"><div class="row" style="justify-content:space-between"><div><b>${esc(p.name)}</b> <span class="badge">${esc(FORMAT_LABEL[p.format] || p.format)}</span> <span class="badge">${esc(p.language)}</span></div><div class="row"><button class="btn small primary" data-launch="${p.id}">🚀 Ishga tushirish</button><button class="btn small danger" data-del-planned="${p.id}">🗑</button></div></div><div class="help">${esc(p.niche)}${p.audience ? ` · Auditoriya: ${esc(p.audience)}` : ''}${p.style ? ` · Uslub: ${esc(p.style)}` : ''}</div></div>`).join('')}
      <form id="planned-add" style="margin-top:12px">
        <div class="grid grid-3">
          <div><label>Kanal nomi *</label><input name="name" required placeholder="Masalan: Brainy Bean"></div>
          <div><label>Format</label><select name="format">${Object.entries(FORMAT_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div><label>Til</label><input name="language" value="en"></div>
        </div>
        <label>Mavzu va g‘oya *</label><textarea name="niche" rows="2" required placeholder="Masalan: inson tanasi, odatlar va hayvonlar haqida qiziqarli faktlar — Pele Explains uslubida, sariq personaj bilan oddiy animatsiya"></textarea>
        <div class="grid grid-2">
          <div><label>Auditoriya</label><input name="audience" placeholder="AQSh/Yevropa, 13–35 yosh, qiziquvchan"></div>
          <div><label>Uslub</label><input name="style" placeholder="Do‘stona ovoz, qisqa gaplar, har 5–7 soniyada yangi rasm"></div>
        </div>
        <button class="btn" style="margin-top:12px">➕ Rejalashtirilgan kanal qo‘shish</button>
      </form>
    </div>`;
  document.getElementById('comp-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Kanal videolari yuklanmoqda…';
    try {
      const c = await api('POST', '/api/competitors', { input: fd.get('input'), targetIds: fd.getAll('target') });
      toast(`${c.title} qo‘shildi: ${c.videos.length} ta video tahlil qilindi`, 'ok');
      location.hash = `#/competitors/${c.id}`;
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
      btn.textContent = '🔎 Qo‘shish va tahlil qilish';
    }
  });
  document.getElementById('planned-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/planned', Object.fromEntries(new FormData(e.target)));
      toast('Rejalashtirilgan kanal qo‘shildi', 'ok');
      await views.competitors([]);
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
  main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Raqobatchi o‘chirilsinmi?')) return;
    await api('DELETE', `/api/competitors/${b.dataset.del}`);
    await views.competitors([]);
  }));
  main.querySelectorAll('[data-launch]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Rejadagi kanal haqiqiy kanalga aylanadi: g‘oyalar va raqobatchilar unga o‘tkaziladi. Keyin personaj yuklab, YouTube’ga ulaysiz. Davom etilsinmi?')) return;
    try {
      const ch = await api('POST', `/api/planned/${b.dataset.launch}/launch`, {});
      await getChannels(true);
      toast(`“${ch.name}” kanali yaratildi — personaj rasmini yuklang`, 'ok');
      location.hash = '#/settings';
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));
  main.querySelectorAll('[data-del-planned]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Rejalashtirilgan kanal o‘chirilsinmi? Uning g‘oyalari qoladi.')) return;
    await api('DELETE', `/api/planned/${b.dataset.delPlanned}`);
    await views.competitors([]);
  }));
};

async function competitorDetail(id) {
  let { competitor: c, targets, aiReady } = await api('GET', `/api/competitors/${id}`);
  let filter = 'top';
  const localHour = (utc) => {
    if (utc == null) return '—';
    const d = new Date();
    d.setUTCHours(Math.round(utc), 0, 0, 0);
    return `${pad(d.getHours())}:00`;
  };
  const draw = () => {
    const s = c.stats;
    const newSet = new Set(c.newVideoIds || []);
    let list = c.videos.slice();
    if (filter === 'top') list.sort((a, b) => (b.outlier || 0) - (a.outlier || 0));
    if (filter === 'new') list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    if (filter === 'short') list = list.filter((v) => v.isShort).sort((a, b) => (b.outlier || 0) - (a.outlier || 0));
    if (filter === 'long') list = list.filter((v) => !v.isShort).sort((a, b) => (b.outlier || 0) - (a.outlier || 0));
    const ai = c.ai;
    main.innerHTML = `
      <div class="page-head">
        <div class="row" style="flex-wrap:nowrap">
          ${c.avatar ? `<img src="${esc(c.avatar)}" alt="" style="width:64px;height:64px;border-radius:50%">` : ''}
          <div><div class="sub"><a href="#/competitors">Raqobatchilar</a></div><h1>${esc(c.title)}</h1>
            <div class="sub"><a href="https://www.youtube.com/channel/${esc(c.youtubeId)}" target="_blank" rel="noopener">${esc(c.handle || c.youtubeId)} ↗</a> · ${fmtNum(c.subscribers)} obunachi · ${fmtNum(c.views)} ko‘rish · ${c.videoCount} video</div></div>
        </div>
        <div class="row">
          <button class="btn" id="c-sync">🔄 Yangilash</button>
          <button class="btn" id="c-ai" ${aiReady ? '' : 'disabled title="API kalitlar sahifasida matn uchun AI kalitini kiriting"'}>✨ AI tahlil</button>
          <a class="btn primary" href="#/ideas?competitor=${c.id}">💡 Shu asosda g‘oyalar</a>
        </div>
      </div>
      ${s ? `
      <div class="grid grid-4">
        <div class="card kpi"><div class="label">O‘rtacha ko‘rish (mediana)</div><div class="value">${fmtNum(s.medianViews)}</div><div class="hint">Shorts ${fmtNum(s.medianShorts)} · uzun ${fmtNum(s.medianLong)}</div></div>
        <div class="card kpi"><div class="label">Eng zo‘r video</div><div class="value">${Math.max(...c.videos.map((v) => v.outlier || 0))}×</div><div class="hint">o‘rtachadan necha marta ko‘p</div></div>
        <div class="card kpi"><div class="label">Chiqarish tezligi</div><div class="value">${s.uploadsLast30}</div><div class="hint">so‘nggi 30 kunda · har ~${s.medianGapDays ?? '—'} kunda</div></div>
        <div class="card kpi"><div class="label">Eng yaxshi davomiylik</div><div class="value">${s.bestBucket ? esc(s.bestBucket.label) : '—'}</div><div class="hint">${s.bestBucket ? `o‘rtacha ${s.bestBucket.avgOutlier}×` : 'kam ma’lumot'}</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card"><h2>Sarlavha qoliplari</h2>
          <table><thead><tr><th>Odat</th><th>Eng zo‘rlarida</th><th>Hammasida</th></tr></thead><tbody>
            <tr><td>Raqam bor</td><td>${s.titles.number.top}%</td><td>${s.titles.number.all}%</td></tr>
            <tr><td>“You / Your”</td><td>${s.titles.you.top}%</td><td>${s.titles.you.all}%</td></tr>
            <tr><td>Savol belgisi</td><td>${s.titles.question.top}%</td><td>${s.titles.question.all}%</td></tr>
            <tr><td>KATTA harfli so‘z</td><td>${s.titles.caps.top}%</td><td>${s.titles.caps.all}%</td></tr>
            <tr><td>O‘rtacha uzunlik</td><td>${s.titles.topAvgLength} belgi</td><td>${s.titles.avgLength} belgi</td></tr>
          </tbody></table>
          ${s.openers.length ? `<h3 style="margin-top:14px">Ko‘p takrorlanadigan boshlanishlar</h3><table><tbody>${s.openers.map((o) => `<tr><td>“${esc(o.opener)}…”</td><td>${o.count} ta</td><td>${o.avgOutlier ?? '—'}×</td></tr>`).join('')}</tbody></table>` : ''}
          ${s.keywords.length ? `<h3 style="margin-top:14px">Eng zo‘rlarida ko‘p uchraydigan so‘zlar</h3><div class="row">${s.keywords.map((k) => `<span class="badge info" title="lift ${k.lift}">${esc(k.word)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="card"><h2>Davomiylik va vaqt</h2>
          <table><thead><tr><th>Davomiylik</th><th>Video</th><th>O‘rtacha ko‘rish</th><th>× o‘rtacha</th></tr></thead><tbody>
            ${s.buckets.map((b) => `<tr${s.bestBucket?.label === b.label ? ' style="font-weight:700"' : ''}><td>${esc(b.label)}${s.bestBucket?.label === b.label ? ' ✓' : ''}</td><td>${b.count}</td><td>${fmtNum(b.medianViews)}</td><td>${b.avgOutlier}×</td></tr>`).join('')}
          </tbody></table>
          <p style="margin-top:12px">Ko‘pincha <b>${esc(s.topWeekday)}</b> kuni, taxminan <b>${localHour(s.medianHourUtc)}</b> da (sizning vaqtingiz bilan) chiqaradi.</p>
          <div class="help">Shorts ${s.shortsCount} ta · uzun ${s.longCount} ta · ${s.analyzed} ta video tahlil qilindi</div>
        </div>
      </div>` : '<div class="alert warn">Ma’lumot hali yuklanmagan — “Yangilash”ni bosing.</div>'}
      <div class="card"><h2>✨ AI tahlili</h2>
        ${ai ? `
          <p>${esc(ai.summary)}</p>
          ${ai.formula ? `<div class="alert info"><b>Formula:</b> ${esc(ai.formula)}</div>` : ''}
          ${ai.titlePatterns?.length ? `<h3>Sarlavha qoliplari</h3><ul>${ai.titlePatterns.map((x) => `<li><code>${esc(x.pattern)}</code> — ${esc(x.why)} <span class="help">masalan: “${esc(x.example)}”</span></li>`).join('')}</ul>` : ''}
          ${ai.thumbnailStyle?.length ? `<h3>Prevyu uslubi</h3><ul>${ai.thumbnailStyle.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${ai.topicClusters?.length ? `<h3>Mavzu guruhlari</h3><ul>${ai.topicClusters.map((x) => `<li><b>${esc(x.topic)}</b> — ${esc(x.performance)} <span class="help">${(x.examples || []).map(esc).join('; ')}</span></li>`).join('')}</ul>` : ''}
          <div class="grid grid-2">
            ${ai.whatToCopy?.length ? `<div><h3>✅ O‘rganish kerak</h3><ul>${ai.whatToCopy.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
            ${ai.whatToAvoid?.length ? `<div><h3>⛔ Takrorlamaslik kerak</h3><ul>${ai.whatToAvoid.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
          </div>
          ${ai.gaps?.length ? `<h3>🎯 Bo‘sh joylar (siz egallashingiz mumkin)</h3><ul>${ai.gaps.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <div class="help">${fmtDate(ai.at)}</div>` : '<div class="sub">“AI tahlil” tugmasi eng yaxshi videolarning prevyularini ko‘rib, kanalning takrorlanadigan formulasini, sarlavha qoliplarini va siz egallashingiz mumkin bo‘lgan bo‘sh mavzularni topadi (~2–5 sent).</div>'}
      </div>
      <div class="card"><h2>Qaysi kanallarim uchun</h2>
        <div class="row">${targets.map((t) => `<label class="check"><input type="checkbox" data-target value="${esc(t.id)}" ${(c.targetIds || []).includes(t.id) ? 'checked' : ''}> ${esc(t.name)}${t.kind === 'planned' ? ' <span class="badge info">reja</span>' : ''}</label>`).join('')}</div>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between"><h2>Videolar</h2>
          <div class="row">${[['top', '🔥 Eng zo‘rlari'], ['new', '🆕 Yangilari'], ['long', 'Uzun'], ['short', 'Shorts']].map(([k, l]) => `<button class="btn small ${filter === k ? 'primary' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>Video</th><th>Ko‘rish</th><th>× o‘rtacha</th><th>Kuniga</th></tr></thead>
          <tbody>${list.slice(0, 60).map((v) => `<tr>
            <td style="width:130px">${v.thumbnail ? `<a href="https://youtu.be/${esc(v.id)}" target="_blank" rel="noopener"><img src="${esc(v.thumbnail)}" alt="" style="width:120px;border-radius:6px;display:block"></a>` : ''}</td>
            <td><a href="https://youtu.be/${esc(v.id)}" target="_blank" rel="noopener"><b>${esc(v.title)}</b></a> ${newSet.has(v.id) ? '<span class="badge ok">yangi</span>' : ''}<div class="help">${v.isShort ? 'Shorts' : 'Uzun'} · ${fmtSec(v.duration)} · ${Math.round(v.ageDays)} kun oldin</div></td>
            <td>${fmtNum(v.views)}</td>
            <td><span class="badge ${v.outlier >= 3 ? 'ok' : v.outlier >= 1 ? '' : 'warn'}">${v.outlier ?? '—'}×</span></td>
            <td>${fmtNum(v.viewsPerDay)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="help">“× o‘rtacha” — videoning ko‘rishi kanalning o‘rtacha (mediana) ko‘rishidan necha marta ko‘p. 3× va undan yuqori — mavzu va qadoqlash auditoriyaga juda yoqqan.</div>
      </div>`;
    bind();
  };
  function bind() {
    document.getElementById('c-sync').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Yangilanmoqda…';
      try {
        c = await api('POST', `/api/competitors/${id}/sync`);
        toast(c.newVideoIds?.length ? `${c.newVideoIds.length} ta yangi video` : 'Yangilandi', 'ok');
        draw();
      } catch (err) {
        toast(err.message, 'bad');
        e.target.disabled = false;
      }
    });
    document.getElementById('c-ai').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'AI prevyu va sarlavhalarni o‘rganmoqda…';
      try {
        c.ai = await api('POST', `/api/competitors/${id}/ai`);
        draw();
      } catch (err) {
        toast(err.message, 'bad');
        e.target.disabled = false;
        e.target.textContent = '✨ AI tahlil';
      }
    });
    main.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.filter;
      draw();
    }));
    main.querySelectorAll('[data-target]').forEach((cb) => cb.addEventListener('change', async () => {
      const ids = [...main.querySelectorAll('[data-target]:checked')].map((x) => x.value);
      c = { ...c, ...(await api('PUT', `/api/competitors/${id}`, { targetIds: ids })) };
      toast('Saqlandi', 'ok');
    }));
  }
  draw();
}

// ---------- G'oyalar va ssenariylar ----------
const IDEA_STATUS = { new: ['Yangi', 'info'], saved: ['⭐ Saqlangan', 'ok'], used: ['✅ Ishlatilgan', ''], rejected: ['Rad etilgan', 'bad'] };

function scriptToText(idea) {
  const sc = idea.script || {};
  const lines = [`# ${sc.title || idea.title}`, ''];
  if (sc.hook) lines.push(`HOOK: ${sc.hook}`, '');
  if (sc.songConcept) lines.push(`G‘OYA: ${sc.songConcept}`, '');
  if (sc.sunoStyle) lines.push(`SUNO STYLE: ${sc.sunoStyle}`, '');
  if (sc.lyrics) lines.push('LYRICS:', sc.lyrics, '');
  if (sc.clipToFind) lines.push(`LAVHA: ${sc.clipToFind}`, '');
  for (const [i, sec] of (sc.sections || []).entries()) {
    lines.push(`## ${i + 1}. ${sec.heading || ''}`, sec.narration || '');
    if (sec.visual) lines.push(`[KADR] ${sec.visual}`);
    lines.push('');
  }
  if (sc.cta) lines.push(`YAKUN: ${sc.cta}`, '');
  if (sc.thumbnailText) lines.push(`PREVYU: ${sc.thumbnailText}${sc.thumbnailConcept ? ` — ${sc.thumbnailConcept}` : ''}`);
  if (sc.description) lines.push('', 'TAVSIF:', sc.description);
  if (sc.tags?.length) lines.push('', `TEGLAR: ${sc.tags.join(', ')}`);
  return lines.join('\n');
}

views.ideas = async (parts, query) => {
  let data = await api('GET', '/api/ideas');
  const preComp = query.get('competitor');
  let target = query.get('target') || data.competitors.find((c) => c.id === preComp)?.targetIds?.[0] || data.targets[0]?.id || '';
  let statusFilter = 'active';
  let targetFilter = 'all';
  const open = new Set();

  const scriptHtml = (idea) => {
    const sc = idea.script;
    return `<div class="card" style="margin:12px 0 0;background:var(--panel-2)">
      <h3>📝 ${esc(sc.title || idea.title)}</h3>
      ${sc.hook ? `<p><b>Hook:</b> ${esc(sc.hook)}</p>` : ''}
      ${sc.songConcept ? `<p><b>G‘oya:</b> ${esc(sc.songConcept)}</p>` : ''}
      ${sc.sunoStyle ? `<p><b>Suno style:</b> <code>${esc(sc.sunoStyle)}</code></p>` : ''}
      ${sc.lyrics ? `<label>Qo‘shiq matni</label><pre class="log" style="max-height:none">${esc(sc.lyrics)}</pre>` : ''}
      ${sc.shortsMoments?.length ? `<p><b>Shorts uchun:</b> ${sc.shortsMoments.map(esc).join('; ')}</p>` : ''}
      ${sc.clipToFind ? `<p><b>Topiladigan lavha:</b> ${esc(sc.clipToFind)}</p>` : ''}
      ${(sc.sections || []).map((sec, i) => `<div class="issue"><b>${i + 1}. ${esc(sec.heading || '')}</b><p style="margin:6px 0">${esc(sec.narration)}</p>${sec.visual ? `<div class="help">🎨 ${esc(sec.visual)}</div>` : ''}</div>`).join('')}
      ${sc.cta ? `<p><b>Yakun:</b> ${esc(sc.cta)}</p>` : ''}
      <p class="help">${sc.estimatedSeconds ? `~${fmtSec(sc.estimatedSeconds)} · ` : ''}Prevyu: ${esc(sc.thumbnailText || '')}${sc.thumbnailConcept ? ` — ${esc(sc.thumbnailConcept)}` : ''}</p>
      <div class="row">
        <button class="btn small" data-copy-script="${idea.id}">📋 Nusxalash</button>
        <button class="btn small" data-download-script="${idea.id}">⬇️ .txt</button>
        <button class="btn small" data-script="${idea.id}">🔁 Qayta yozish</button>
      </div>
    </div>`;
  };

  const draw = () => {
    const comps = data.competitors.filter((c) => c.ready);
    const linked = (t) => comps.filter((c) => (c.targetIds || []).includes(t)).map((c) => c.id);
    const checked = new Set(preComp ? [preComp] : linked(target).length ? linked(target) : comps.map((c) => c.id));
    const ideas = data.ideas.filter((i) => (targetFilter === 'all' || i.targetId === targetFilter) && (statusFilter === 'all' || (statusFilter === 'active' ? i.status !== 'rejected' : i.status === statusFilter)));
    main.innerHTML = `
      <div class="page-head"><div><h1>💡 G‘oyalar va ssenariy</h1><div class="sub">Raqobatchilarning isbotlangan formulasidan kanallaringiz uchun yangi g‘oyalar — va bir bosishda to‘liq ssenariy.</div></div>
        <a class="btn" href="#/competitors">🕵️ Raqobatchilar</a></div>
      ${!comps.length ? '<div class="alert warn">Avval <a href="#/competitors">Raqobatchilar</a> sahifasida kamida bitta kanal qo‘shing.</div>' : ''}
      ${!data.aiReady ? '<div class="alert warn">G‘oya va ssenariy uchun <a href="#/keys">API kalitlar</a> sahifasida Claude, OpenAI yoki Gemini kalitini kiriting.</div>' : ''}
      <form class="card" id="idea-form">
        <h2>✨ Yangi g‘oyalar</h2>
        <div class="grid grid-3">
          <div><label>Qaysi kanal uchun</label><select name="targetId" id="idea-target">${data.targets.map((t) => `<option value="${esc(t.id)}" ${t.id === target ? 'selected' : ''}>${esc(t.name)}${t.kind === 'planned' ? ' (reja)' : ''}</option>`).join('')}</select>
            <div class="help"><a href="#/competitors">+ rejalashtirilgan kanal qo‘shish</a></div></div>
          <div><label>Format</label><select name="format"><option value="any">Aralash</option><option value="long">Faqat uzun video</option><option value="short">Faqat Shorts</option></select></div>
          <div><label>Nechta g‘oya</label><input name="count" type="number" min="3" max="15" value="8"></div>
        </div>
        <label>Qaysi raqobatchilardan o‘rganish</label>
        <div class="row">${comps.map((c) => `<label class="check"><input type="checkbox" name="competitorIds" value="${c.id}" ${checked.has(c.id) ? 'checked' : ''}> ${esc(c.title)}</label>`).join('') || '<span class="sub">—</span>'}</div>
        <label>Qo‘shimcha istak (ixtiyoriy)</label><textarea name="notes" rows="2" placeholder="Masalan: inson tanasi mavzusida ko‘proq, qo‘rqitmasdan; yoki: arabcha qo‘shiqlar uchun"></textarea>
        <div class="row" style="margin-top:12px"><button class="btn primary" ${comps.length && data.aiReady ? '' : 'disabled'}>✨ G‘oyalar yaratish</button><span class="help">~1–3 sent</span></div>
      </form>
      <div class="card">
        <div class="row" style="justify-content:space-between"><h2>G‘oyalar (${ideas.length})</h2>
          <div class="row">
            <select id="f-target" style="max-width:200px"><option value="all">Barcha kanallar</option>${data.targets.map((t) => `<option value="${esc(t.id)}" ${t.id === targetFilter ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
            <select id="f-status" style="max-width:180px">${[['active', 'Faollar'], ['all', 'Hammasi'], ['new', 'Yangi'], ['saved', 'Saqlangan'], ['used', 'Ishlatilgan'], ['rejected', 'Rad etilgan']].map(([k, l]) => `<option value="${k}" ${k === statusFilter ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </div>
        </div>
        ${ideas.map((i) => {
          const [sl, sc] = IDEA_STATUS[i.status] || IDEA_STATUS.new;
          return `<div class="issue">
            <div class="row" style="justify-content:space-between">
              <div class="row"><span class="badge ${i.potential >= 8 ? 'ok' : i.potential >= 6 ? 'info' : ''}">⭐ ${i.potential}/10</span><b>${esc(i.title)}</b></div>
              <div class="row"><span class="badge ${sc}">${sl}</span><span class="badge">${i.format === 'short' ? 'Shorts' : 'Uzun'}${i.lengthSec ? ` · ${fmtSec(i.lengthSec)}` : ''}</span><span class="badge">${esc(targetName(data.targets, i.targetId))}</span></div>
            </div>
            ${i.hook ? `<p style="margin:6px 0"><i>“${esc(i.hook)}”</i></p>` : ''}
            <div class="help">${esc(i.angle)}</div>
            <div class="help">📈 ${esc(i.why)}${i.inspiredBy ? ` · Ilhom: ${esc(i.inspiredBy)}` : ''}</div>
            <div class="help">🖼 ${esc(i.thumbnailText)} — ${esc(i.thumbnailConcept)}</div>
            <div class="row" style="margin-top:8px">
              ${i.script ? `<button class="btn small primary" data-toggle="${i.id}">📄 Ssenariy ${open.has(i.id) ? 'yopish' : 'ko‘rish'}</button>` : `<button class="btn small primary" data-script="${i.id}" ${data.aiReady ? '' : 'disabled'}>📝 Ssenariy yozish</button>`}
              ${i.projectId ? `<a class="btn small" href="#/project/${esc(i.projectId)}">🎬 Loyihani ochish</a>` : data.targets.find((t) => t.id === i.targetId && t.kind === 'channel' && t.type === 'explainer') ? `<button class="btn small primary" data-produce="${i.id}">🎬 Videoga aylantirish</button>` : ''}
              <button class="btn small" data-status="${i.id}" data-value="saved">⭐</button>
              <button class="btn small" data-status="${i.id}" data-value="used">✅ Ishlatildi</button>
              <button class="btn small" data-status="${i.id}" data-value="rejected">✕</button>
              <button class="btn small danger" data-del-idea="${i.id}">🗑</button>
            </div>
            ${i.script && open.has(i.id) ? scriptHtml(i) : ''}
          </div>`;
        }).join('') || '<div class="empty-state">Hali g‘oya yo‘q — yuqoridagi tugmani bosing.</div>'}
      </div>`;
    bind();
  };

  const refresh = async () => {
    data = await api('GET', '/api/ideas');
    draw();
  };

  function bind() {
    document.getElementById('idea-target').addEventListener('change', (e) => {
      target = e.target.value;
      draw();
    });
    document.getElementById('idea-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'AI g‘oyalar yozmoqda…';
      try {
        const r = await api('POST', '/api/ideas/generate', { targetId: fd.get('targetId'), competitorIds: fd.getAll('competitorIds'), format: fd.get('format'), count: fd.get('count'), notes: fd.get('notes') });
        toast(`${r.ideas.length} ta g‘oya tayyor`, 'ok');
        targetFilter = fd.get('targetId');
        await refresh();
      } catch (err) {
        toast(err.message, 'bad');
        btn.disabled = false;
        btn.textContent = '✨ G‘oyalar yaratish';
      }
    });
    document.getElementById('f-target').addEventListener('change', (e) => {
      targetFilter = e.target.value;
      draw();
    });
    document.getElementById('f-status').addEventListener('change', (e) => {
      statusFilter = e.target.value;
      draw();
    });
    main.querySelectorAll('[data-script]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Ssenariy yozilmoqda…';
      try {
        await api('POST', `/api/ideas/${b.dataset.script}/script`);
        open.add(b.dataset.script);
        await refresh();
      } catch (err) {
        toast(err.message, 'bad');
        b.disabled = false;
        b.textContent = '📝 Ssenariy yozish';
      }
    }));
    main.querySelectorAll('[data-produce]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Bu g‘oyadan to‘liq video yaratiladi: ssenariy, sahna rasmlari, ovoz va prevyu (pullik AI). Davom etilsinmi?')) return;
      b.disabled = true;
      try {
        const project = await api('POST', `/api/ideas/${b.dataset.produce}/produce`);
        toast('Video navbatga qo‘yildi', 'ok');
        location.hash = `#/project/${project.id}`;
      } catch (err) {
        toast(err.message, 'bad');
        b.disabled = false;
      }
    }));
    main.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
      if (open.has(b.dataset.toggle)) open.delete(b.dataset.toggle);
      else open.add(b.dataset.toggle);
      draw();
    }));
    main.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
      await api('PUT', `/api/ideas/${b.dataset.status}`, { status: b.dataset.value });
      await refresh();
    }));
    main.querySelectorAll('[data-del-idea]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('G‘oya o‘chirilsinmi?')) return;
      await api('DELETE', `/api/ideas/${b.dataset.delIdea}`);
      await refresh();
    }));
    main.querySelectorAll('[data-copy-script]').forEach((b) => b.addEventListener('click', async () => {
      const text = scriptToText(data.ideas.find((i) => i.id === b.dataset.copyScript));
      try {
        await navigator.clipboard.writeText(text);
        toast('Ssenariy nusxalandi', 'ok');
      } catch {
        prompt('Nusxa oling:', text);
      }
    }));
    main.querySelectorAll('[data-download-script]').forEach((b) => b.addEventListener('click', () => {
      const idea = data.ideas.find((i) => i.id === b.dataset.downloadScript);
      const blob = new Blob([scriptToText(idea)], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(idea.script?.title || idea.title).replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }));
  }

  draw();
};

// ---------- Kanal tashxisi ----------
const SEVERITY = { high: ['⛔', 'Jiddiy', 'bad'], medium: ['⚠️', 'O‘rta', 'warn'], low: ['•', 'Kichik', ''], info: ['ℹ️', 'Ma’lumot', 'info'] };
const VERDICT = { hit: ['🚀 Uchgan', 'ok'], normal: ['O‘rtacha', ''], flop: ['📉 Uchmagan', 'bad'], new: ['🆕 Yangi', 'info'], unknown: ['?', ''] };
const IMPACT = { yuqori: 'bad', "o'rta": 'warn', 'o‘rta': 'warn', past: '' };

const issueHtml = (i) => {
  const [icon, label, cls] = SEVERITY[i.severity] || SEVERITY.info;
  return `<div class="issue"><div class="row"><span class="badge ${cls}">${icon} ${label}</span><b>${esc(i.title)}</b></div>
    <div class="help">${esc(i.detail)}</div>${i.fix ? `<div class="fix">➜ ${esc(i.fix)}</div>` : ''}</div>`;
};

views.diagnose = async (parts, query) => {
  const channels = await getChannels();
  if (!channels.length) {
    main.innerHTML = noChannelsHtml('Kanal tashxisi');
    return;
  }
  const current = channels.find((c) => c.id === query.get('channel')) || channels[0];
  let filter = query.get('filter') || 'all';
  let state = await api('GET', `/api/diagnose/${current.id}`);
  const open = new Set();

  const aiChannelHtml = (ai) => `
    <p>${esc(ai.summary)}</p>
    ${ai.whyNotGrowing?.length ? `<h3>Nega o‘smayapti</h3>${ai.whyNotGrowing.map((r) => `
      <div class="issue"><div class="row"><span class="badge ${IMPACT[r.impact] ?? ''}">${esc(r.impact || '')}</span><b>${esc(r.reason)}</b></div>
        <div class="help">Dalil: ${esc(r.evidence)}</div><div class="fix">➜ ${esc(r.fix)}</div></div>`).join('')}` : ''}
    ${ai.actionPlan?.length ? `<h3 style="margin-top:14px">2 haftalik reja</h3><ol>${ai.actionPlan.map((x) => `<li><b>${esc(x.step)}</b> <span class="help">— ${esc(x.why)}</span></li>`).join('')}</ol>` : ''}
    ${ai.winningPatterns?.length ? `<h3>Yaxshi ishlaganlarning umumiy jihati</h3><ul>${ai.winningPatterns.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${ai.titleFormula ? `<h3>Sarlavha qolipi</h3><p>${esc(ai.titleFormula)}</p>` : ''}
    ${ai.thumbnailAdvice?.length ? `<h3>Prevyu bo‘yicha</h3><ul>${ai.thumbnailAdvice.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${ai.nextVideos?.length ? `<h3>Keyingi videolar</h3><ul>${ai.nextVideos.map((x) => `<li><b>${esc(x.title)}</b> — ${esc(x.why)} <a class="help" href="#/new?channel=${current.id}">➕ yaratish</a></li>`).join('')}</ul>` : ''}
    <div class="help">AI xulosasi: ${fmtDate(ai.at)}</div>`;

  const aiVideoHtml = (r, v, canEdit) => `
    <div class="card" style="margin:10px 0 0;background:var(--panel-2)">
      <h3>🔍 AI tashxisi</h3>
      <p><b>${esc(r.verdict)}</b></p>
      ${r.reasons?.length ? `<ul>${r.reasons.map((x) => `<li><b>${esc(x.reason)}</b> <span class="badge">${esc(x.confidence || '')}</span><div class="help">${esc(x.evidence)}</div></li>`).join('')}</ul>` : ''}
      ${r.thumbnail ? `<p><b>Prevyu:</b> ${esc(r.thumbnail)}</p>` : ''}
      ${r.hook ? `<p><b>Birinchi soniyalar:</b> ${esc(r.hook)}</p>` : ''}
      ${r.retention?.length ? `<p class="help">Qolgan tomoshabinlar: ${r.retention.map((x) => `${x.at}% → ${x.stillWatching}%`).join(' · ')}</p>` : ''}
      ${r.traffic?.length ? `<p class="help">Trafik manbalari: ${r.traffic.map((t) => `${esc(t.source)} ${t.views}`).join(' · ')}</p>` : ''}
      ${r.betterTitles?.length ? `<b>Yaxshiroq sarlavhalar:</b>${r.betterTitles.map((t) => `
        <div class="row" style="margin-top:6px"><code style="flex:1;min-width:0">${esc(t)}</code>
          <button class="btn small" data-copy="${esc(t)}">📋</button>
          ${canEdit ? `<button class="btn small" data-retitle="${esc(v.id)}" data-title="${esc(t)}">✏️ YouTube’da almashtirish</button>` : ''}</div>`).join('')}` : ''}
      ${r.fixes?.length ? `<h3 style="margin-top:10px">Nima qilish kerak</h3><ol>${r.fixes.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
      ${r.reupload ? `<p><b>Qayta yuklash:</b> ${esc(r.reupload)}</p>` : ''}
      <div class="help">${fmtDate(r.at)} · o‘sha paytda ${r.viewsAtDiagnosis} ko‘rish</div>
    </div>`;

  const draw = () => {
    const d = state.diagnosis;
    const list = d ? d.videos.filter((v) => filter === 'all' || v.verdict === filter) : [];
    main.innerHTML = `
      <div class="page-head">
        <div><h1>🩺 Kanal tashxisi</h1><div class="sub">Nega videolar uchmadi va nima qilish kerak — kanalingizning o‘z raqamlari asosida</div></div>
        <div class="row">
          <button class="btn primary" id="diag-run">🩺 ${d ? 'Qayta tahlil' : 'Tahlil qilish'}</button>
          ${d ? `<button class="btn" id="diag-ai" ${state.aiReady ? '' : 'disabled title="Avval API kalitlar sahifasida matn uchun AI kalitini kiriting"'}>✨ AI xulosa</button>` : ''}
        </div>
      </div>
      <div class="channel-pick">${channels.map((c) => `<button type="button" data-ch="${c.id}" class="${c.id === current.id ? 'active' : ''}"><b><span class="dot" style="background:${esc(c.colors.primary)}"></span>${esc(c.name)}</b><div class="help">${esc(c.handle || '')}</div></button>`).join('')}</div>
      ${!d ? `<div class="card empty-state">
          <p><b>“Tahlil qilish”</b> ni bosing — dastur kanalning so‘nggi 50 ta videosini tekshiradi:</p>
          <p class="help">har bir videoni kanal o‘rtachasi bilan solishtiradi, Content ID bloklari, “bolalar uchun” belgisi, gorizontal qisqa video, sarlavha va tavsif muammolari, tomosha foizi (kanal ulangan bo‘lsa) va boshqa sabablarni topadi. Bu qism bepul; AI xulosasi ixtiyoriy.</p>
        </div>` : `
      ${d.source !== 'oauth' || !d.analyticsAvailable ? `<div class="alert info">Hozir faqat ochiq statistika ishlatildi. Eng muhim sabab — <b>tomoshabinlar qayerda chiqib ketgani</b> (tomosha foizi, retention) — kanal ulanganda ko‘rinadi: <a href="#/keys">API kalitlar → Google OAuth</a>.${d.analyticsError ? ` <span class="help">(${esc(d.analyticsError)})</span>` : ''}</div>` : ''}
      <div class="grid grid-4">
        <div class="card kpi"><div class="label">Sog‘lik bali</div><div class="value">${d.score}/100</div><div class="bar ${d.score < 50 ? 'bad' : d.score < 75 ? 'warn' : ''}"><span style="width:${d.score}%"></span></div><div class="hint">Qoidalar asosida, faqat yo‘nalish uchun</div></div>
        <div class="card kpi"><div class="label">🚀 Uchgan</div><div class="value">${d.counts.hit}</div><div class="hint">kanal o‘rtachasidan 2× va ko‘p</div></div>
        <div class="card kpi"><div class="label">📉 Uchmagan</div><div class="value">${d.counts.flop}</div><div class="hint">o‘rtachadan 0.6× kam</div></div>
        <div class="card kpi"><div class="label">O‘rtacha ko‘rish</div><div class="value">${d.medians.short != null ? Math.round(d.medians.short).toLocaleString() : '—'} / ${d.medians.long != null ? Math.round(d.medians.long).toLocaleString() : '—'}</div><div class="hint">Shorts / uzun video · ${d.channel.subscribers} obunachi</div></div>
      </div>
      <div class="card"><h2>Kanal darajasidagi muammolar</h2>${d.channelIssues.length ? d.channelIssues.map(issueHtml).join('') : '<div class="sub">Kanal darajasida muammo topilmadi.</div>'}</div>
      <div class="card"><div class="row" style="justify-content:space-between"><h2>✨ AI xulosasi</h2></div>
        ${d.ai ? aiChannelHtml(d.ai) : `<div class="sub">“AI xulosa” tugmasi barcha raqamlarni birga ko‘rib, kanal nega o‘smayotganini ustuvorlik bo‘yicha tushuntiradi va 2 haftalik reja beradi (~1–5 sent).</div>`}
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between"><h2>Videolar</h2>
          <div class="row">${[['all', 'Hammasi'], ['flop', '📉 Uchmagan'], ['hit', '🚀 Uchgan'], ['normal', 'O‘rtacha'], ['new', '🆕 Yangi']].map(([k, l]) => `<button class="btn small ${filter === k ? 'primary' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>Video</th><th>Ko‘rish</th><th>O‘rtachaga nisbatan</th><th>Holat</th><th>Muammolar</th></tr></thead>
          <tbody>${list.map((v) => {
            const [vl, vc] = VERDICT[v.verdict] || VERDICT.unknown;
            const serious = v.issues.filter((i) => i.severity === 'high' || i.severity === 'medium').length;
            const ai = d.videoAi?.[v.id];
            return `<tr class="click" data-video="${esc(v.id)}">
              <td style="width:110px">${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="" style="width:100px;border-radius:6px;display:block">` : ''}</td>
              <td><b>${esc(v.title)}</b><div class="help">${v.isShort ? 'Shorts' : 'Uzun'} · ${fmtSec(v.duration)} · ${Math.round(v.ageDays)} kun oldin</div></td>
              <td>${v.views.toLocaleString()}</td>
              <td>${v.perf != null ? `${v.perf}×` : '—'}</td>
              <td><span class="badge ${vc}">${vl}</span></td>
              <td>${serious ? `<span class="badge warn">${serious} ta</span>` : '<span class="help">—</span>'} ${ai ? '<span class="badge info">AI</span>' : ''}</td>
            </tr>
            ${open.has(v.id) ? `<tr><td colspan="6" style="background:var(--bg)">
              ${v.analytics ? `<p class="help">Tomosha foizi: <b>${v.analytics.avgPercent}%</b> · o‘rtacha ${fmtSec(v.analytics.avgDuration)} · +${v.analytics.subscribers} obunachi · ${v.analytics.shares} ulashish</p>` : ''}
              ${v.titleHistory?.length ? `<p class="help">Sarlavha almashtirilgan: ${v.titleHistory.map((h) => `${fmtDate(h.at)} — “${esc(h.from)}” → “${esc(h.to)}”`).join('; ')}</p>` : ''}
              ${v.issues.length ? v.issues.map(issueHtml).join('') : '<div class="sub">Qoidalar bo‘yicha muammo topilmadi.</div>'}
              <div class="row" style="margin-top:10px">
                <button class="btn ${v.verdict === 'flop' ? 'primary' : ''}" data-ai-video="${esc(v.id)}" ${state.aiReady ? '' : 'disabled'}>🔍 ${v.verdict === 'hit' ? 'Nega uchdi?' : 'Nega uchmadi?'} (AI${v.thumbnail ? ' + prevyu' : ''})</button>
                <a class="btn" href="https://studio.youtube.com/video/${esc(v.id)}/edit" target="_blank" rel="noopener">YouTube Studio ↗</a>
                <a class="btn" href="https://youtu.be/${esc(v.id)}" target="_blank" rel="noopener">▶ Ko‘rish</a>
              </div>
              ${ai ? aiVideoHtml(ai, v, d.source === 'oauth') : ''}
            </td></tr>` : ''}`;
          }).join('') || '<tr><td colspan="6" class="sub">Bu filtrda video yo‘q</td></tr>'}</tbody>
        </table></div>
        <div class="help">Tahlil: ${fmtDate(d.at)} · “O‘rtachaga nisbatan” — shu formatdagi (Shorts yoki uzun) videolarning o‘rtacha ko‘rishiga nisbat.</div>
      </div>`}`;
    bind();
  };

  function bind() {
    main.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => {
      location.hash = `#/diagnose?channel=${b.dataset.ch}`;
    }));
    document.getElementById('diag-run').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Tahlil qilinmoqda…';
      try {
        state = await api('POST', `/api/diagnose/${current.id}/run`);
        draw();
      } catch (err) {
        toast(err.message, 'bad');
        e.target.disabled = false;
        e.target.textContent = '🩺 Tahlil qilish';
      }
    });
    document.getElementById('diag-ai')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'AI tahlil qilmoqda…';
      try {
        state.diagnosis.ai = await api('POST', `/api/diagnose/${current.id}/ai`);
        draw();
      } catch (err) {
        toast(err.message, 'bad');
        e.target.disabled = false;
        e.target.textContent = '✨ AI xulosa';
      }
    });
    main.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.filter;
      draw();
    }));
    main.querySelectorAll('tr[data-video]').forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('a,button')) return;
      const id = row.dataset.video;
      if (open.has(id)) open.delete(id);
      else open.add(id);
      draw();
    }));
    main.querySelectorAll('[data-ai-video]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'AI prevyu va raqamlarni ko‘rmoqda…';
      try {
        const r = await api('POST', `/api/diagnose/${current.id}/video/${encodeURIComponent(b.dataset.aiVideo)}`);
        state.diagnosis.videoAi = { ...state.diagnosis.videoAi, [b.dataset.aiVideo]: r };
        draw();
      } catch (err) {
        toast(err.message, 'bad');
        b.disabled = false;
        b.textContent = '🔍 Qayta urinish';
      }
    }));
    main.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        toast('Nusxalandi', 'ok');
      } catch {
        prompt('Nusxa oling:', b.dataset.copy);
      }
    }));
    main.querySelectorAll('[data-retitle]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`YouTube’dagi sarlavha shunga almashtiriladi:\n\n${b.dataset.title}\n\nDavom etilsinmi?`)) return;
      b.disabled = true;
      try {
        await api('POST', `/api/diagnose/${current.id}/video/${encodeURIComponent(b.dataset.retitle)}/title`, { title: b.dataset.title });
        toast('Sarlavha YouTube’da almashtirildi. 3–7 kundan keyin qayta tahlil qilib natijani solishtiring.', 'ok');
        state = await api('GET', `/api/diagnose/${current.id}`);
        draw();
      } catch (err) {
        toast(err.message, 'bad');
        b.disabled = false;
      }
    }));
  }

  draw();
};

// ---------- API kalitlar ----------
const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — tez va eng arzon', input: 1, output: 5 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — sifatliroq', input: 2, output: 10 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — eng kuchli', input: 4, output: 20 },
];
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'];

const KEY_CARDS = [
  {
    id: 'anthropic',
    title: 'Anthropic (Claude)',
    use: 'Ssenariy, SEO sarlavhalar, tarjima qatori, analiz tavsiyalari, izohlarga javob',
    link: 'https://console.anthropic.com/settings/keys',
    steps: ['console.anthropic.com da ro‘yxatdan o‘ting', 'Billing → balansni to‘ldiring ($5 bir necha oyga yetadi)', 'Settings → API Keys → “Create Key”', 'Kalitni (sk-ant-…) nusxalab shu yerga qo‘ying'],
    fields: [{ key: 'anthropicKey', label: 'API kalit', secret: true, placeholder: 'sk-ant-…' }],
  },
  {
    id: 'openai',
    title: 'OpenAI',
    use: 'Diktor ovozi (TTS) va qo‘shiq matnini vokalga moslab vaqtlash (Whisper). Matn uchun ham tanlash mumkin.',
    link: 'https://platform.openai.com/api-keys',
    steps: ['platform.openai.com da ro‘yxatdan o‘ting', 'Billing → kredit qo‘shing ($5 yetarli)', 'API keys → “Create new secret key”', 'Kalitni (sk-…) nusxalab shu yerga qo‘ying'],
    fields: [{ key: 'openaiKey', label: 'API kalit', secret: true, placeholder: 'sk-…' }],
  },
  {
    id: 'gemini',
    title: 'Google Gemini',
    use: 'Google AI Studio: diktor ovozi (ohang bilan), sahna rasmlari va matn — Claude yoki OpenAI o‘rniga ham ishlaydi (bepul limiti bor)',
    link: 'https://aistudio.google.com/apikey',
    steps: ['aistudio.google.com ga Google hisobingiz bilan kiring', '“Get API key” → “Create API key”', 'Kalitni (AIza…) nusxalab shu yerga qo‘ying va tekshiring', 'Yuqorida “Matn” uchun Gemini’ni tanlang'],
    fields: [{ key: 'geminiKey', label: 'API kalit', secret: true, placeholder: 'AIza…' }],
  },
  {
    id: 'elevenlabs',
    title: 'ElevenLabs — o‘z ovozingiz (ixtiyoriy)',
    use: 'Diktor sizning klonlangan ovozingiz bilan gapiradi',
    link: 'https://elevenlabs.io/app/settings/api-keys',
    steps: ['elevenlabs.io da ro‘yxatdan o‘ting (Starter yoki undan yuqori tarif)', 'Voices → “Instant Voice Clone” → 1–2 daqiqa toza ovoz yozuvini yuklang', 'Settings → API Keys → kalit yarating', 'Kalitni kiriting va “Tekshirish”ni bosing — ovozingizni ro‘yxatdan tanlaysiz'],
    fields: [{ key: 'elevenKey', label: 'API kalit', secret: true, placeholder: 'sk_…' }],
  },
  {
    id: 'google',
    title: 'Google OAuth — YouTube’ga yuklash',
    use: 'Videolarni kanalingizga yuklash, chuqur statistika va izohlarga javob. Parolingiz kerak emas.',
    link: 'https://console.cloud.google.com/apis/credentials',
    steps: [
      'Pastdagi “Oson sozlash” bo‘limidagi 4 ta tugmani tartib bilan bosing',
      'Oxirida yuklab olingan JSON faylni shu kartaga tashlang — Client ID va Secret o‘zi to‘ldiriladi',
    ],
    fields: [
      { key: 'googleClientId', label: 'Client ID', placeholder: '…apps.googleusercontent.com' },
      { key: 'googleClientSecret', label: 'Client Secret', secret: true, placeholder: 'GOCSPX-…' },
    ],
  },
  {
    id: 'youtubeKey',
    title: 'YouTube API kaliti (ixtiyoriy)',
    use: 'Kanal ulanmagan bo‘lsa ham ochiq statistika va trendlarni ko‘rish',
    link: 'https://console.cloud.google.com/apis/credentials',
    steps: ['Yuqoridagi Google Cloud loyihasida: Credentials → Create credentials → API key', 'Kalitni nusxalab shu yerga qo‘ying'],
    fields: [{ key: 'youtubeApiKey', label: 'API kalit', secret: true, placeholder: 'AIza…' }],
  },
  {
    id: 'github',
    title: 'GitHub — dasturni yangilash (ixtiyoriy)',
    use: 'Faqat dastur yopiq repozitoriydan yangilansa kerak. Ochiq versiyada “yangilash.bat” tokensiz ishlaydi — bu kartani o‘tkazib yuboring.',
    link: 'https://github.com/settings/tokens/new',
    steps: [
      'Havolani oching (GitHub’ga kirgan bo‘ling) → Note: “youtube-machine”',
      'Faqat “repo” katagini belgilang',
      '“Generate token” → tokenni (ghp_…) nusxalab shu yerga qo‘ying',
    ],
    fields: [{ key: 'githubToken', label: 'Token', secret: true, placeholder: 'ghp_… yoki github_pat_…' }],
  },
  {
    id: 'telegram',
    title: 'Telegram bot',
    use: 'Video tayyor bo‘lsa telefoningizga xabar va telefondan tasdiqlash',
    link: 'https://t.me/BotFather',
    steps: ['Telegram’da @BotFather ni oching', '/newbot → botga nom va username bering', 'Bergan token’ni nusxalab shu yerga qo‘ying', 'O‘z botingizni oching va /start yozing — bot sizga bog‘lanadi'],
    fields: [{ key: 'telegramToken', label: 'Bot token', secret: true, placeholder: '123456:ABC…' }],
  },
];

views.keys = async (parts, query) => {
  const data = await api('GET', '/api/keys');
  const s = data.settings;
  const checks = data.checks;
  const has = (card) => card.fields.every((f) => s[f.key]);
  const status = (card) => {
    const c = checks[card.id];
    if (!has(card)) return '<span class="badge">Kiritilmagan</span>';
    if (!c) return '<span class="badge warn">Tekshirilmagan</span>';
    return c.ok ? '<span class="badge ok">✓ Ishlayapti</span>' : '<span class="badge bad">✕ Xato</span>';
  };
  const modelValue = CLAUDE_MODELS.find((m) => String(s.anthropicModel || '').startsWith(m.id))?.id || 'custom';
  const extra = {
    anthropic: `<div><label>Claude modeli</label><select data-model>
        ${CLAUDE_MODELS.map((m) => `<option value="${m.id}" ${modelValue === m.id ? 'selected' : ''}>${esc(m.label)} ($${m.input}/$${m.output} har 1M token)</option>`).join('')}
        ${modelValue === 'custom' ? `<option value="custom" selected>${esc(s.anthropicModel)}</option>` : ''}
      </select><div class="help">Haiku bir videoga ~1 sent; Opus ~3–5 sent. Model almashsa, Xarajatlardagi narxlar ham o‘zi yangilanadi.</div></div>`,
    openai: `<div class="grid grid-2">
        <div><label>Diktor ovozi (OpenAI)</label><select data-set="ttsVoice">${OPENAI_VOICES.map((v) => `<option ${s.ttsVoice === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label>Matn modeli (OpenAI tanlansa)</label><input data-set="openaiTextModel" value="${esc(s.openaiTextModel)}"></div>
        <div><label>Rasm modeli</label><input data-set="openaiImageModel" value="${esc(s.openaiImageModel || 'gpt-image-1')}"></div>
      </div>`,
    gemini: `<div><label>Gemini modeli</label><select data-set="geminiModel" id="gemini-models">
        <option value="${esc(s.geminiModel)}" selected>${esc(s.geminiModel)}</option>
      </select><div class="help">Tekshirgandan keyin ro‘yxatda mavjud barcha modellar chiqadi. Gemini tanlansa, Sozlamalar → Byudjet’dagi matn narxlarini Gemini tarifiga moslang.</div></div>
      <div><label>Rasm modeli</label><input data-set="geminiImageModel" value="${esc(s.geminiImageModel || 'gemini-2.5-flash-image')}"></div>
      <div class="grid grid-2">
        <div><label>Diktor ovozi (AI Studio)</label><select data-set="geminiVoice">${GEMINI_VOICES.map((v) => `<option ${(s.geminiVoice || 'Puck') === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <div class="help">Puck — quvnoq, Kore — qat’iy, Charon — ma’lumot beruvchi, Fenrir — hayajonli, Aoede — yengil. Tepada “Diktor ovozi”da Google AI Studio’ni tanlang.</div></div>
        <div><label>Ovoz modeli</label><input data-set="geminiTtsModel" value="${esc(s.geminiTtsModel || 'gemini-2.5-flash-preview-tts')}"><div class="help">Sifatliroq: gemini-2.5-pro-preview-tts</div></div>
      </div>`,
    elevenlabs: `<div><label>Ovoz</label><select data-set="elevenVoiceId" id="eleven-voices">
        ${s.elevenVoiceId ? `<option value="${esc(s.elevenVoiceId)}" selected>${esc(s.elevenVoiceId)}</option>` : '<option value="">— avval kalitni tekshiring —</option>'}
      </select></div>`,
    google: `<div class="wizard">
        <b>⚡ Oson sozlash — 4 qadam, har biri bitta tugma</b>
        <ol>
          <li><a class="btn small" target="_blank" rel="noopener" href="https://console.cloud.google.com/flows/enableapi?apiid=youtube.googleapis.com,youtubeanalytics.googleapis.com">1. YouTube API’larini yoqish ↗</a>
            <div class="help">Loyiha so‘ralsa — istalganini tanlang yoki “Create project”. Keyin “Next” → “Enable”.</div></li>
          <li><a class="btn small" target="_blank" rel="noopener" href="https://console.cloud.google.com/auth/branding">2. Ilova nomi ↗</a>
            <div class="help">Ilova nomi: istalgan (masalan, “YouTube Machine”), emailingizni ikki joyga tanlang → Save. Logo yuklamang.</div></li>
          <li><a class="btn small" target="_blank" rel="noopener" href="https://console.cloud.google.com/auth/audience">3. “Publish app” ↗</a>
            <div class="help">“Publish app” → Confirm. Bu bo‘lmasa, ulanish har 7 kunda o‘chadi.</div></li>
          <li><a class="btn small" target="_blank" rel="noopener" href="https://console.cloud.google.com/auth/clients/create">4. Kalit yaratish ↗</a>
            ${data.serverMode
              ? `<div class="help">Application type: <b>Web application</b> → “Authorized redirect URIs” → <b>+ Add URI</b> → <code>${esc(data.redirectUri)}</code> → Create → <b>Download JSON</b>.</div>`
              : '<div class="help">Application type: <b>Desktop app</b> → Create → <b>Download JSON</b>.</div>'}</li>
        </ol>
        <label class="dropzone" id="google-json-drop">📄 Yuklab olingan JSON faylni shu yerga tashlang yoki bosib tanlang
          <input type="file" accept=".json,application/json" id="google-json" hidden></label>
        <div class="help">Hamma qadamlar <b>bitta</b> Google akkaunt va <b>bitta</b> loyihada bo‘lsin (sahifa tepasidagi loyiha nomiga qarang).</div>
      </div>
      <div class="help" style="margin-top:8px">${data.serverMode ? 'Redirect URI (Web application kalitiga qo‘shing)' : 'Redirect URI (Desktop app uchun alohida kiritish shart emas)'}: <code>${esc(data.redirectUri)}</code></div>
      <div style="margin-top:10px">${data.channels.map((c) => `
        <div class="row" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--border)">
          <span><span class="dot" style="background:${esc(c.colors.primary)}"></span><b>${esc(c.name)}</b>
            ${c.youtube.connected ? `<span class="badge ${c.youtube.expired ? 'bad' : 'ok'}">${c.youtube.expired ? 'Muddati tugagan' : 'Ulangan'}: ${esc(c.youtube.title)}</span>` : '<span class="badge warn">Ulanmagan</span>'}</span>
          <a class="btn small ${c.youtube.connected ? '' : 'primary'}" href="/api/youtube/auth/${c.id}">${c.youtube.connected ? 'Qayta ulash' : '🔗 YouTube’ga ulash'}</a>
        </div>`).join('')}</div>`,
    telegram: `<div class="help" style="margin-top:8px">${s.telegramChatId ? `Bog‘langan chat: <code>${esc(s.telegramChatId)}</code> <button type="button" class="btn small danger" id="tg-unlink">Uzish</button>` : 'Hali hech kim bog‘lanmagan — botga /start yozing.'}</div>`,
  };

  main.innerHTML = `
    <div class="page-head"><div><h1>🔑 API kalitlar</h1><div class="sub">Kalitlar faqat shu kompyuterda (<code>data/db.json</code>) saqlanadi va hech qayerga yuborilmaydi — faqat o‘z xizmatiga.</div></div></div>
    ${query.get('connected') ? `<div class="alert ok">YouTube kanal ulandi: <b>${esc(query.get('connected'))}</b></div>` : ''}
    ${query.get('error') ? `<div class="alert bad">${esc(query.get('error'))}</div>` : ''}
    <div class="card">
      <h2>Qaysi xizmat nima qiladi</h2>
      <div class="grid grid-2">
        <div><label>Matn (ssenariy, SEO, tahlil)</label><select data-set="textProvider">
          <option value="anthropic" ${s.textProvider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude) — tavsiya</option>
          <option value="openai" ${s.textProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
          <option value="gemini" ${s.textProvider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
          <option value="none" ${s.textProvider === 'none' ? 'selected' : ''}>AI’siz (shablonlar)</option></select></div>
        <div><label>Diktor ovozi</label><select data-set="ttsProvider">
          <option value="openai" ${s.ttsProvider !== 'elevenlabs' ? 'selected' : ''}>OpenAI TTS — arzon</option>
          <option value="elevenlabs" ${s.ttsProvider === 'elevenlabs' ? 'selected' : ''}>ElevenLabs — o‘z ovozingiz</option>
          <option value="gemini" ${s.ttsProvider === 'gemini' ? 'selected' : ''}>Google AI Studio (Gemini) — ohang bilan, arzon</option></select></div>
        <div><label>Sahna rasmlari (personajli videolar)</label><select data-set="imageProvider">
          <option value="openai" ${s.imageProvider !== 'gemini' ? 'selected' : ''}>OpenAI gpt-image — personajni aniq saqlaydi</option>
          <option value="gemini" ${s.imageProvider === 'gemini' ? 'selected' : ''}>Gemini (Nano Banana) — arzon, ~$0.04/rasm</option></select></div>
        <div><label>Rasm sifati (OpenAI)</label><select data-set="imageQuality">
          ${[['low', 'Past — ~$0.02/rasm'], ['medium', 'O‘rta — ~$0.06/rasm (tavsiya)'], ['high', 'Yuqori — ~$0.25/rasm']].map(([v, l]) => `<option value="${v}" ${(s.imageQuality || 'medium') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="help" style="margin-top:8px">4 daqiqalik tushuntiruvchi video ≈ 35 sahna: OpenAI o‘rta sifatda ~$2.2, Gemini’da ~$1.4, OpenAI past sifatda ~$0.6. Shorts ≈ 8 sahna — 4–5 barobar arzon.</div>
      <div class="help" style="margin-top:8px">Minimal to‘plam: <b>Anthropic + OpenAI</b> (matn va ovoz) + <b>Google OAuth</b> (yuklash). Qolganlari ixtiyoriy. Kalitsiz ham montaj ishlaydi.</div>
    </div>
    <div class="grid grid-2">
      ${KEY_CARDS.map((card) => `
        <div class="card" data-card="${card.id}">
          <div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(card.title)}</h2><span data-status>${status(card)}</span></div>
          <p class="sub" style="margin-top:6px">${esc(card.use)}</p>
          <details><summary class="help" style="cursor:pointer">Kalitni qanday olaman?</summary>
            <ol class="help" style="padding-left:18px">${card.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
            <a class="help" href="${card.link}" target="_blank" rel="noopener">${esc(card.link)} ↗</a>
          </details>
          ${card.fields.map((f) => `
            <label>${esc(f.label)}</label>
            <div class="row" style="flex-wrap:nowrap">
              <input data-field="${f.key}" type="${f.secret ? 'password' : 'text'}" value="${esc(s[f.key])}" placeholder="${esc(f.placeholder || '')}" autocomplete="off" spellcheck="false">
              ${f.secret ? '<button type="button" class="btn small" data-reveal title="Ko‘rsatish">👁</button>' : ''}
            </div>`).join('')}
          ${extra[card.id] || ''}
          <div class="row" style="margin-top:12px">
            <button type="button" class="btn primary" data-save>💾 Saqlash va tekshirish</button>
            ${has(card) ? '<button type="button" class="btn danger" data-clear>O‘chirish</button>' : ''}
          </div>
          <div class="help" data-result style="margin-top:8px">${checks[card.id] ? `${esc(checks[card.id].detail)} <span class="sub">· ${fmtDate(checks[card.id].at)}</span>` : ''}</div>
        </div>`).join('')}
    </div>
    <div class="card" id="custom-keys">
      <h2>➕ Boshqa API kalitlar</h2>
      <p class="sub">Boshqa xizmatlar (Suno, Kling, Runway, Pexels va h.k.) kalitlarini shu yerda bir joyda saqlang. Dastur hozircha ulardan foydalanmaydi — qaysi xizmatni ulash kerakligini aytsangiz, shu kalit bilan integratsiya qo‘shiladi.</p>
      <datalist id="key-presets">${['Suno', 'Kling AI', 'Runway', 'Luma AI', 'Higgsfield', 'Pexels', 'Pixabay', 'Replicate', 'Stability AI', 'Midjourney', 'Groq', 'DeepSeek', 'Mistral', 'xAI (Grok)', 'TikTok', 'Instagram / Meta', 'Cloudflare'].map((n) => `<option value="${n}">`).join('')}</datalist>
      <div id="custom-rows">${(s.customKeys || []).map((c) => customKeyRow(c)).join('')}</div>
      <div class="row" style="margin-top:10px">
        <button type="button" class="btn" id="custom-add">+ Kalit qo‘shish</button>
        <button type="button" class="btn primary" id="custom-save">💾 Saqlash</button>
      </div>
    </div>`;

  // Oddiy tanlovlar darhol saqlanadi
  main.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', async () => {
    try {
      await api('PUT', '/api/settings', { [el.dataset.set]: el.value });
      toast('Saqlandi', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));
  main.querySelector('[data-model]')?.addEventListener('change', async (e) => {
    const m = CLAUDE_MODELS.find((x) => x.id === e.target.value);
    if (!m) return;
    await api('PUT', '/api/settings', { anthropicModel: m.id, prices: { llmInputPer1M: m.input, llmOutputPer1M: m.output } });
    toast(`Model: ${m.label.split(' —')[0]}`, 'ok');
  });
  main.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const input = b.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
  }));
  // Google'dan yuklangan client_secret_*.json — Client ID va Secret'ni o'zi oladi
  const importGoogleJson = async (file) => {
    try {
      const j = JSON.parse(await file.text());
      const c = j.installed || j.web || j;
      if (!c.client_id || !c.client_secret) throw new Error('Bu faylda Client ID topilmadi — Google Cloud → Clients’dan “Download JSON” qiling.');
      if (j.web && !data.serverMode) toast('Bu “Web application” kaliti. Ishlamasa, “Desktop app” turida yangisini yarating.', 'bad');
      if (j.installed && data.serverMode) toast('Bu “Desktop app” kaliti — saytda “Web application” turidagi kalit kerak.', 'bad');
      await api('PUT', '/api/settings', { googleClientId: c.client_id, googleClientSecret: c.client_secret });
      const r = await api('POST', '/api/keys/google/verify');
      toast(r.ok ? 'Google kaliti saqlandi ✓ Endi kanallarni ulang' : r.detail, r.ok ? 'ok' : 'bad');
      await views.keys([], new URLSearchParams());
    } catch (err) {
      toast(err.message.startsWith('Unexpected') ? 'Fayl o‘qilmadi — Google’dan yuklangan JSON faylni tanlang' : err.message, 'bad');
    }
  };
  const gInput = document.getElementById('google-json');
  gInput?.addEventListener('change', () => gInput.files[0] && importGoogleJson(gInput.files[0]));
  const gDrop = document.getElementById('google-json-drop');
  gDrop?.addEventListener('dragover', (e) => {
    e.preventDefault();
    gDrop.classList.add('over');
  });
  gDrop?.addEventListener('dragleave', () => gDrop.classList.remove('over'));
  gDrop?.addEventListener('drop', (e) => {
    e.preventDefault();
    gDrop.classList.remove('over');
    if (e.dataTransfer.files[0]) importGoogleJson(e.dataTransfer.files[0]);
  });
  document.getElementById('tg-unlink')?.addEventListener('click', async () => {
    await api('PUT', '/api/settings', { telegramChatId: '' });
    await views.keys([], new URLSearchParams());
  });

  const fillVoices = (voices) => {
    const sel = document.getElementById('eleven-voices');
    if (!sel || !voices?.length) return;
    const current = s.elevenVoiceId;
    sel.innerHTML = `<option value="">— ovozni tanlang —</option>${voices.map((v) => `<option value="${esc(v.id)}" ${v.id === current ? 'selected' : ''}>${esc(v.name)}${v.category === 'cloned' ? ' (sizning klon)' : ''}</option>`).join('')}`;
  };

  const fillGeminiModels = (models) => {
    const sel = document.getElementById('gemini-models');
    if (!sel || !models?.length) return;
    const current = s.geminiModel;
    const list = models.some((m) => m.id === current) ? models : [{ id: current, name: current }, ...models];
    sel.innerHTML = list.map((m) => `<option value="${esc(m.id)}" ${m.id === current ? 'selected' : ''}>${esc(m.name)} (${esc(m.id)})</option>`).join('');
  };

  main.querySelectorAll('[data-card]').forEach((cardEl) => {
    const id = cardEl.dataset.card;
    const card = KEY_CARDS.find((c) => c.id === id);
    const result = cardEl.querySelector('[data-result]');
    const verify = async () => {
      result.textContent = 'Tekshirilmoqda…';
      const r = await api('POST', `/api/keys/${id}/verify`);
      result.textContent = r.detail;
      cardEl.querySelector('[data-status]').innerHTML = r.ok ? '<span class="badge ok">✓ Ishlayapti</span>' : '<span class="badge bad">✕ Xato</span>';
      if (r.voices) fillVoices(r.voices);
      if (r.model) s.geminiModel = r.model;
      if (r.models) fillGeminiModels(r.models);
      return r;
    };
    cardEl.querySelector('[data-save]').addEventListener('click', async (e) => {
      const body = {};
      for (const f of card.fields) {
        const v = cardEl.querySelector(`[data-field="${f.key}"]`).value.trim();
        // Yashirin ko'rinishdagi (••••) qiymat o'zgarmagan bo'lsa, server eskisini saqlab qoladi
        if (v) body[f.key] = v;
      }
      if (!Object.keys(body).length) {
        toast('Avval kalitni kiriting', 'bad');
        return;
      }
      e.target.disabled = true;
      try {
        await api('PUT', '/api/settings', body);
        const r = await verify();
        toast(r.ok ? `${card.title}: ishlayapti ✓` : `${card.title}: ${r.detail}`, r.ok ? 'ok' : 'bad');
      } catch (err) {
        toast(err.message, 'bad');
      }
      e.target.disabled = false;
    });
    cardEl.querySelector('[data-clear]')?.addEventListener('click', async () => {
      if (!confirm(`${card.title} kaliti o‘chirilsinmi?`)) return;
      await api('PUT', '/api/settings', Object.fromEntries(card.fields.map((f) => [f.key, ''])));
      await views.keys([], new URLSearchParams());
    });
  });
  document.getElementById('custom-add').addEventListener('click', () => {
    document.getElementById('custom-rows').insertAdjacentHTML('beforeend', customKeyRow({ name: '', value: '', note: '' }));
  });
  document.getElementById('custom-rows').addEventListener('click', (e) => {
    if (e.target.matches('[data-ck-del]')) e.target.closest('.ck-row').remove();
    if (e.target.matches('[data-ck-reveal]')) {
      const input = e.target.closest('.ck-row').querySelector('[data-ck-value]');
      input.type = input.type === 'password' ? 'text' : 'password';
    }
  });
  document.getElementById('custom-save').addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('#custom-rows .ck-row')].map((r) => ({
      name: r.querySelector('[data-ck-name]').value,
      value: r.querySelector('[data-ck-value]').value,
      note: r.querySelector('[data-ck-note]').value,
    }));
    if (rows.some((r) => !r.name.trim() && r.value.trim())) {
      toast('Har bir kalitga nom bering', 'bad');
      return;
    }
    const names = rows.map((r) => r.name.trim()).filter(Boolean);
    if (new Set(names).size !== names.length) {
      toast('Bir xil nomli ikkita kalit bo‘lmasin', 'bad');
      return;
    }
    try {
      await api('PUT', '/api/settings', { customKeys: rows });
      toast('Saqlandi', 'ok');
      await views.keys([], new URLSearchParams());
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  // ElevenLabs kaliti saqlangan bo'lsa, ovozlar ro'yxatini darhol olib kelamiz
  if (s.elevenKey) api('POST', '/api/keys/elevenlabs/verify').then((r) => fillVoices(r.voices)).catch(() => {});
};

const GEMINI_VOICES = ['Puck', 'Kore', 'Charon', 'Fenrir', 'Aoede', 'Zephyr', 'Leda', 'Orus', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

function customKeyRow(c) {
  return `<div class="row ck-row" style="margin-top:8px">
    <input data-ck-name list="key-presets" placeholder="Xizmat nomi" value="${esc(c.name)}">
    <input data-ck-value type="password" placeholder="Kalit" value="${esc(c.value)}" autocomplete="off" spellcheck="false">
    <button type="button" class="btn small" data-ck-reveal title="Ko‘rsatish">👁</button>
    <input data-ck-note placeholder="Izoh (ixtiyoriy)" value="${esc(c.note || '')}">
    <button type="button" class="btn small danger" data-ck-del title="O‘chirish">✕</button>
  </div>`;
}

// ---------- Sozlamalar ----------
views.settings = async (parts, query) => {
  const { settings: s, channels } = await api('GET', '/api/settings');
  channelCache = channels;
  const field = (key, label, { type = 'text', help = '', placeholder = '' } = {}) =>
    `<div><label>${label}</label><input data-key="${key}" type="${type}" value="${esc(s[key])}" placeholder="${esc(placeholder)}" autocomplete="off">${help ? `<div class="help">${help}</div>` : ''}</div>`;
  const price = (key, label) => `<div><label>${label}</label><input data-price="${key}" type="number" step="0.001" min="0" value="${esc(s.prices[key])}"></div>`;
  main.innerHTML = `
    <div class="page-head"><div><h1>Sozlamalar</h1><div class="sub">Byudjet, montaj va kanallar.</div></div></div>
    ${query.get('connected') ? `<div class="alert ok">YouTube kanal ulandi: <b>${esc(query.get('connected'))}</b></div>` : ''}
    ${query.get('error') ? `<div class="alert bad">${esc(query.get('error'))}</div>` : ''}

    <a class="card" href="#/keys" style="display:block;text-decoration:none;color:inherit">
      <h2>🔑 API kalitlar va ulanishlar</h2>
      <div class="sub">Claude, OpenAI, ElevenLabs, Google (YouTube) va Telegram kalitlari endi alohida sahifada — har birini kiritib, ishlayotganini bir tugma bilan tekshirasiz. →</div>
    </a>

    <div class="card"><h2>YouTube yuklash</h2>
      <div class="grid grid-2">
        ${field('uploadLeadHours', 'Chiqishdan necha soat oldin yuklash', { type: 'number', help: 'Video shu vaqtda “yopiq + jadvalli” holatda yuklanadi va YouTube uni o‘zi belgilangan soatda ochadi.' })}
      </div>
    </div>

    <div class="card"><h2>Byudjet</h2>
      <div class="grid grid-3">
        ${field('monthlyBudget', 'Oylik chegara ($)', { type: 'number', help: 'Chegaraga yetganda pullik AI chaqiruvlari to‘xtaydi' })}
      </div>
      <h3 style="margin-top:14px">Doimiy oylik obunalar</h3>
      <div id="fixed">${(s.fixedMonthly || []).map((f) => `<div class="row fixed-row" style="margin-bottom:6px"><input data-fixed-name value="${esc(f.name)}" style="max-width:260px"><input data-fixed-amount type="number" step="0.01" value="${esc(f.amount)}" style="max-width:120px"><button type="button" class="btn small danger" data-fixed-del>✕</button></div>`).join('')}</div>
      <button type="button" class="btn small" id="fixed-add">+ Obuna qo‘shish</button>
      <h3 style="margin-top:14px">Taxminiy narxlar (USD)</h3>
      <div class="grid grid-4">
        ${price('llmInputPer1M', 'Matn: 1M kirish tokeni')}
        ${price('llmOutputPer1M', 'Matn: 1M chiqish tokeni')}
        ${price('ttsPer1MChars', 'Ovoz: 1M belgi')}
        ${price('transcribePerMin', 'Transkripsiya: 1 daqiqa')}
        ${price('elevenPer1MChars', 'ElevenLabs: 1M belgi')}
      </div>
      <div class="help">Narxlar o‘zgarib turadi — xizmatlarning rasmiy narx sahifasi bilan solishtiring.</div>
    </div>

    <div class="card"><h2>Montaj</h2>
      <div class="grid grid-2">
        <div><label>Tezlik / sifat</label><select data-key="renderPreset">${['ultrafast', 'veryfast', 'faster', 'medium'].map((v) => `<option ${s.renderPreset === v ? 'selected' : ''}>${v}</option>`).join('')}</select><div class="help">veryfast — tez; medium — fayl kichikroq, lekin sekinroq</div></div>
        ${field('fontName', 'Shrift', { help: 'Kompyuterda o‘rnatilgan shrift nomi (Arial, Montserrat…)' })}
      </div>
    </div>
    <div class="row" style="margin-bottom:24px"><button class="btn primary" id="save-settings">💾 Sozlamalarni saqlash</button></div>

    ${channels.some((c) => c.type === 'explainer') ? `<div class="card"><h2>🔊 Ovoz effektlari kutubxonasi</h2>
      <p class="sub">Tushuntiruvchi videolarda ishlatiladi. 7 ta oddiy effekt dasturda tayyor (bepul). O‘zingiz yuklagan effektlar <b>fayl nomi</b> bo‘yicha topiladi — masalan, <code>sizzle-frying.mp3</code> “sizzle” so‘ralganda qo‘yiladi.</p>
      <div id="sfx-list"><span class="sub">Yuklanmoqda…</span></div>
      <label class="btn small" style="margin-top:8px">+ Effekt qo‘shish<input type="file" hidden multiple id="sfx-add" accept=".mp3,.wav,.m4a,.ogg"></label>
    </div>` : ''}

    <div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">Kanallar</h2><button type="button" class="btn primary" id="new-channel-btn">➕ Yangi kanal</button></div>
    <form class="card" id="new-channel" hidden>
      <h2>Yangi kanal</h2>
      <div class="grid grid-3">
        <div><label>Nomi *</label><input name="name" required placeholder="Masalan: Bubu Explains"></div>
        <div><label>Turi</label><select name="type">
          <option value="explainer">🎬 Tushuntiruvchi (personaj + g‘oya)</option>
          <option value="music">🎵 Musiqa (Suno)</option>
          <option value="fight">🥊 Jang tahlili</option></select></div>
        <div><label>Til</label><input name="language" value="en"></div>
      </div>
      <label>Mavzu / auditoriya</label><input name="niche" placeholder="Science and body facts for curious teens and adults">
      <label>Rasm uslubi (ixtiyoriy)</label><input name="style" placeholder="Bo‘sh qolsa: oddiy 2D multfilm, qalin qora chiziqlar, oq fon">
      <div class="row" style="margin-top:12px"><button class="btn primary">Yaratish</button><button type="button" class="btn" id="new-channel-cancel">Bekor qilish</button></div>
    </form>
    ${channels.map((c) => `
      <form class="card" data-channel="${c.id}">
        <div class="row" style="justify-content:space-between">
          <h2><span class="dot" style="background:${esc(c.colors.primary)}"></span>${esc(c.name)}</h2>
          <div class="row">
            ${c.youtube.connected ? `<span class="badge ${c.youtube.expired ? 'bad' : 'ok'}">${c.youtube.expired ? 'Muddati tugagan' : 'Ulangan'}: ${esc(c.youtube.title)}</span>` : '<span class="badge warn">Ulanmagan</span>'}
            <a class="btn small" href="/api/youtube/auth/${c.id}">${c.youtube.connected ? 'Qayta ulash' : '🔗 YouTube’ga ulash'}</a>
            ${c.youtube.connected ? `<button type="button" class="btn small danger" data-disconnect="${c.id}">Uzish</button>` : ''}
          </div>
        </div>
        <div class="grid grid-3">
          <div><label>Nomi</label><input name="name" value="${esc(c.name)}"></div>
          <div><label>Handle</label><input name="handle" value="${esc(c.handle)}"></div>
          <div><label>Chiqish vaqti (har kuni)</label><input name="publishTime" type="time" value="${esc(c.publishTime)}"></div>
          <div><label>Shorts uzunligi (s)</label><input name="shortsSeconds" type="number" min="10" max="180" value="${esc(c.shortsSeconds)}"></div>
          <div><label>Standart ko‘rinish</label><select name="defaultPrivacy">${['public', 'unlisted', 'private'].map((v) => `<option value="${v}" ${c.defaultPrivacy === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div><label>Kategoriya ID</label><input name="categoryId" value="${esc(c.categoryId)}"><div class="help">10 — Music, 17 — Sports, 27 — Education</div></div>
          <div><label>Asosiy rang</label><input name="primary" type="color" value="${esc(c.colors.primary)}"></div>
          <div><label>Ikkinchi rang</label><input name="secondary" type="color" value="${esc(c.colors.secondary)}"></div>
          ${c.type === 'explainer' ? `<div><label>Fon rangi</label><input name="background" type="color" value="${esc(c.colors.background || '#ffffff')}"></div>` : ''}
          <div><label>Til</label><input name="language" value="${esc(c.language)}"></div>
        </div>
        <label>Doimiy teglar (vergul bilan)</label><input name="baseTags" value="${esc(c.baseTags.join(', '))}">
        <label>Tavsif oxiridagi matn</label><textarea name="descriptionFooter" rows="3">${esc(c.descriptionFooter)}</textarea>
        ${c.type === 'music' ? `
          <div class="grid grid-3">
            <div><label>Har qo‘shiqdan nechta Shorts</label><input name="shortsPerSong" type="number" min="1" max="5" value="${esc(c.shortsPerSong ?? 3)}"></div>
          </div>
          <label class="check" style="margin-top:10px"><input type="checkbox" name="karaoke" ${c.karaoke !== false ? 'checked' : ''}> Karaoke: so‘zlar aytilganda birma-bir yonadi</label>
          <label class="check"><input type="checkbox" name="translateLyrics" ${c.translateLyrics !== false ? 'checked' : ''}> Inglizcha bo‘lmagan qo‘shiqlarda ostiga inglizcha tarjima qatori</label>
          <label class="check"><input type="checkbox" name="bgMotion" ${c.bgMotion !== false ? 'checked' : ''}> Jonli fon: rasm sekin suzib turadi</label>` : c.type === 'explainer' ? `
          <h3 style="margin-top:14px">Personaj</h3>
          <div class="row" style="align-items:flex-start;gap:16px">
            ${c.characterFile ? `<img src="${characterUrl(c)}" alt="Personaj" class="char-preview">` : '<div class="char-preview empty">Personaj yo‘q</div>'}
            <div style="flex:1;min-width:220px">
              <input type="file" data-character="${c.id}" accept=".png,.jpg,.jpeg,.webp">
              <div class="help">Personajingiz rasmi (PNG, oq yoki shaffof fonda eng yaxshisi). Har bir sahna rasmi shu personaj asosida chiziladi.</div>
              ${c.character?.description ? `<div class="help" style="margin-top:6px"><b>AI ko‘rgani:</b> ${esc(c.character.description)}</div>` : ''}
            </div>
          </div>
          <label>Mavzu / auditoriya</label><input name="niche" value="${esc(c.niche || '')}">
          <label>Rasm uslubi</label><input name="style" value="${esc(c.style || '')}" placeholder="oddiy 2D multfilm, qalin qora chiziqlar, oq fon">
          <div class="grid grid-3">
            <div><label>Standart format</label><select name="defaultFormat"><option value="long" ${c.defaultFormat !== 'short' ? 'selected' : ''}>Uzun video</option><option value="short" ${c.defaultFormat === 'short' ? 'selected' : ''}>Shorts</option></select></div>
            <div><label>Bir sahna (soniya)</label><input name="sceneSeconds" type="number" min="3" max="20" value="${esc(c.sceneSeconds ?? 7)}"><div class="help">Kam — tezroq almashinadi, lekin rasm ko‘proq (qimmatroq)</div></div>
          </div>
          <label class="check" style="margin-top:10px"><input type="checkbox" name="captionsShort" ${c.captionsShort !== false ? 'checked' : ''}> Shorts’da subtitrlar</label>
          <label class="check"><input type="checkbox" name="captionsLong" ${c.captionsLong ? 'checked' : ''}> Uzun videoda ham subtitrlar</label>
          <label class="check"><input type="checkbox" name="sceneLabels" ${c.sceneLabels !== false ? 'checked' : ''}> Har sahna tepasida rangli yorliq (masalan, “TINY CHEMICAL ATTACK”)</label>
          <div class="grid grid-3">
            <div><label>Subtitr uslubi</label><select name="captionStyle"><option value="pill" ${(c.captionStyle || 'pill') === 'pill' ? 'selected' : ''}>Qora fonli, kalit so‘z sariq</option><option value="outline" ${c.captionStyle === 'outline' ? 'selected' : ''}>Katta oq harf, qora chiziq</option></select></div>
            <div><label>Effektlar ovozi (0–1.5)</label><input name="sfxVolume" type="number" min="0" max="1.5" step="0.05" value="${esc(c.sfxVolume ?? 0.5)}"></div>
            <div><label>Musiqa ovozi (0–1.5)</label><input name="musicVolume" type="number" min="0" max="1.5" step="0.05" value="${esc(c.musicVolume ?? 0.15)}"></div>
          </div>
          <label class="check" style="margin-top:10px"><input type="checkbox" name="sfx" ${c.sfx !== false ? 'checked' : ''}> Ovoz effektlari (whoosh, pop, ding…) — AI har sahnaga mosini tanlaydi</label>
          <label class="check"><input type="checkbox" name="sfxGenerate" ${c.sfxGenerate !== false ? 'checked' : ''}> Kutubxonada yo‘q effektni ElevenLabs bilan yaratish (~$0.02, kalit bo‘lsa)</label>
          <label class="check"><input type="checkbox" name="musicAuto" ${c.musicAuto !== false ? 'checked' : ''}> Har videoga pastdagi ro‘yxatdan fon musiqasi qo‘yish</label>
          <label>Diktor ohangi (AI ovozga ko‘rsatma)</label><input name="voiceStyle" value="${esc(c.voiceStyle || '')}" placeholder="Upbeat, curious, playful narrator, medium-fast pace">
          <h3 style="margin-top:14px">🎵 Fon musiqalari</h3>
          <div class="music-list" data-music-list="${c.id}"><span class="sub">Yuklanmoqda…</span></div>
          <label class="btn small" style="margin-top:6px">+ Musiqa qo‘shish<input type="file" hidden multiple data-music-add="${c.id}" accept=".mp3,.wav,.m4a,.ogg"></label>
          <div class="help">Mualliflik huquqisiz musiqa qo‘ying (YouTube Audio Library, Suno’da o‘zingiz yaratgan va h.k.). Har videoga bittasi avtomatik tanlanadi.</div>` : `
          <label class="check" style="margin-top:10px"><input type="checkbox" name="fightEffects" ${c.fightEffects !== false ? 'checked' : ''}> Tahlil effektlari: asosiy lahzada to‘xtash, yaqinlashtirish, belgi va sekin takror</label>
          <label class="check"><input type="checkbox" name="smartCrop" ${c.smartCrop !== false ? 'checked' : ''}> Aqlli vertikal kesish: kadr harakat bo‘lgan joyga ergashadi</label>`}
        <label>Soha kalit so‘zlari (trendlar qidiruvi uchun, vergul bilan)</label><input name="nicheKeywords" value="${esc(c.nicheKeywords || '')}" placeholder="${{ music: 'arabic sad song, emotional arabic music', fight: 'UFC knockout, boxing highlights', explainer: 'why do we, explained animation, body facts' }[c.type] || ''}">
        <label class="check" style="margin-top:10px"><input type="checkbox" name="aiDisclosure" ${c.aiDisclosure ? 'checked' : ''}> Yangi videolarda “AI bilan yaratilgan realistik kontent” belgisini yoqish</label>
        <button class="btn" style="margin-top:12px">💾 Kanalni saqlash</button>
      </form>`).join('')}`;

  document.getElementById('fixed-add').addEventListener('click', () => {
    document.getElementById('fixed').insertAdjacentHTML('beforeend', '<div class="row fixed-row" style="margin-bottom:6px"><input data-fixed-name placeholder="Nomi" style="max-width:260px"><input data-fixed-amount type="number" step="0.01" placeholder="$" style="max-width:120px"><button type="button" class="btn small danger" data-fixed-del>✕</button></div>');
  });
  document.getElementById('fixed').addEventListener('click', (e) => {
    if (e.target.matches('[data-fixed-del]')) e.target.closest('.fixed-row').remove();
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    const body = { prices: {} };
    main.querySelectorAll('[data-key]').forEach((el) => {
      body[el.dataset.key] = el.value;
    });
    main.querySelectorAll('[data-price]').forEach((el) => {
      body.prices[el.dataset.price] = el.value;
    });
    body.fixedMonthly = [...main.querySelectorAll('.fixed-row')].map((r) => ({ name: r.querySelector('[data-fixed-name]').value, amount: r.querySelector('[data-fixed-amount]').value }));
    try {
      await api('PUT', '/api/settings', body);
      toast('Sozlamalar saqlandi', 'ok');
      history.replaceState(null, '', '#/settings');
      await views.settings([], new URLSearchParams());
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  main.querySelectorAll('form[data-channel]').forEach((form) =>
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = Object.fromEntries(fd);
      const ch = channels.find((x) => x.id === form.dataset.channel);
      body.colors = { ...ch.colors, primary: body.primary, secondary: body.secondary, ...(body.background ? { background: body.background } : {}) };
      delete body.primary;
      delete body.secondary;
      delete body.background;
      for (const k of ['aiDisclosure', 'karaoke', 'translateLyrics', 'bgMotion', 'fightEffects', 'smartCrop', 'captionsShort', 'captionsLong', 'sceneLabels', 'sfx', 'sfxGenerate', 'musicAuto']) {
        if (form.querySelector(`[name="${k}"]`)) body[k] = fd.has(k);
      }
      body.shortsSeconds = Number(body.shortsSeconds);
      if (body.shortsPerSong) body.shortsPerSong = Number(body.shortsPerSong);
      try {
        await api('PUT', `/api/channels/${form.dataset.channel}`, body);
        await getChannels(true);
        toast('Kanal saqlandi', 'ok');
      } catch (err) {
        toast(err.message, 'bad');
      }
    }),
  );
  const newForm = document.getElementById('new-channel');
  if (query.get('new') || !channels.length) newForm.hidden = false;
  document.getElementById('new-channel-btn').addEventListener('click', () => {
    newForm.hidden = false;
    newForm.querySelector('[name=name]').focus();
  });
  document.getElementById('new-channel-cancel').addEventListener('click', () => {
    newForm.hidden = true;
  });
  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const ch = await api('POST', '/api/channels', Object.fromEntries(new FormData(newForm)));
      await getChannels(true);
      toast(`“${ch.name}” kanali yaratildi${ch.type === 'explainer' ? ' — endi personaj rasmini yuklang' : ''}`, 'ok');
      await views.settings([], new URLSearchParams());
      document.querySelector(`form[data-channel="${ch.id}"]`)?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
  main.querySelectorAll('[data-character]').forEach((input) =>
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const res = await fetch(`/api/channels/${input.dataset.character}/character?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        await getChannels(true);
        toast('Personaj saqlandi', 'ok');
        await views.settings([], new URLSearchParams());
      } catch (err) {
        toast(err.message, 'bad');
      }
    }),
  );
  const audioRow = (src, name, del) => `<div class="row audio-row"><span class="audio-name">${esc(name)}</span><audio controls preload="none" src="${src}"></audio>${del ? `<button type="button" class="btn small danger" ${del}>✕</button>` : ''}</div>`;
  const drawMusic = async (cid) => {
    const box = main.querySelector(`[data-music-list="${cid}"]`);
    if (!box) return;
    const { files } = await api('GET', `/api/channels/${cid}/music`);
    box.innerHTML = files.map((f) => audioRow(`/channel-files/${cid}/${encodeURIComponent(f)}`, f.replace(/^music-/, ''), `data-music-del="${esc(f)}"`)).join('') || '<span class="sub">Hali musiqa yo‘q</span>';
    box.querySelectorAll('[data-music-del]').forEach((b) => b.addEventListener('click', async () => {
      await api('DELETE', `/api/channels/${cid}/music/${encodeURIComponent(b.dataset.musicDel)}`);
      drawMusic(cid);
    }));
  };
  main.querySelectorAll('[data-music-list]').forEach((el) => drawMusic(el.dataset.musicList));
  main.querySelectorAll('[data-music-add]').forEach((input) => input.addEventListener('change', async () => {
    try {
      for (const f of input.files) await putFile(`/api/channels/${input.dataset.musicAdd}/music?name=${encodeURIComponent(f.name)}`, f);
      toast('Musiqa qo‘shildi', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
    drawMusic(input.dataset.musicAdd);
  }));
  const drawSfx = async () => {
    const box = document.getElementById('sfx-list');
    if (!box) return;
    const { files } = await api('GET', '/api/sfx');
    const nice = (f) => f.replace(/^builtin-/, '⭐ ').replace(/^gen-/, '✨ ').replace(/\.[a-z0-9]+$/, '');
    box.innerHTML = files.map((f) => audioRow(`/sfx-files/${encodeURIComponent(f)}`, nice(f), f.startsWith('builtin-') ? '' : `data-sfx-del="${esc(f)}"`)).join('');
    box.querySelectorAll('[data-sfx-del]').forEach((b) => b.addEventListener('click', async () => {
      await api('DELETE', `/api/sfx/${encodeURIComponent(b.dataset.sfxDel)}`);
      drawSfx();
    }));
  };
  drawSfx();
  document.getElementById('sfx-add')?.addEventListener('change', async (e) => {
    try {
      for (const f of e.target.files) await putFile(`/api/sfx?name=${encodeURIComponent(f.name)}`, f);
      toast('Effekt qo‘shildi', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
    drawSfx();
  });
  main.querySelectorAll('[data-disconnect]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Kanal ulanishi o‘chiriladi. Davom etilsinmi?')) return;
      await api('POST', `/api/youtube/disconnect/${b.dataset.disconnect}`);
      await views.settings([], new URLSearchParams());
    }),
  );
};

// ---------- Til va kun/tun ----------
const langPick = document.getElementById('lang-pick');
langPick.value = getLang();
langPick.addEventListener('change', () => setLang(langPick.value));
const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: '🌓', light: '☀️', dark: '🌙' };
const themeBtn = document.getElementById('theme-pick');
const applyTheme = (th) => {
  if (th === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;
  themeBtn.textContent = THEME_ICON[th];
  themeBtn.title = t({ auto: 'Avto (tizim bo‘yicha)', light: 'Kunduzgi', dark: 'Tungi' }[th]);
};
let theme = 'auto';
try {
  theme = localStorage.getItem('ytm-theme') || 'auto';
} catch {
  // xotira yopiq
}
applyTheme(theme);
themeBtn.addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try {
    localStorage.setItem('ytm-theme', theme);
  } catch {
    // xotira yopiq
  }
  applyTheme(theme);
});
startI18n();

// Sayt rejimida (gateway orqali) — hisob va chiqish tugmasi
fetch('/gw/me').then((r) => (r.ok ? r.json() : null)).then((me) => {
  if (!me?.email) return;
  const box = document.createElement('div');
  box.className = 'account';
  box.innerHTML = `<span class="help" data-no-i18n>${esc(me.email)}</span>${me.admin ? ' <a href="/gw/admin">Admin</a>' : ''} <a href="/gw/logout">Chiqish</a>`;
  document.querySelector('.prefs')?.after(box);
}).catch(() => {});

window.addEventListener('hashchange', render);
render();
updateQueueStatus();
setInterval(updateQueueStatus, 5000);
