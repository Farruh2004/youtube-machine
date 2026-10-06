// YouTube Data API v3: rasmiy Google OAuth orqali ulanish (parol kerak emas), yuklash va statistika.
import fs from 'node:fs';
import https from 'node:https';
import { db, save } from './store.js';
import { BASE_URL } from './config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  // Chuqur statistika (retention, tomosha davomiyligi)
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  // Izohlarga javob yozish
  'https://www.googleapis.com/auth/youtube.force-ssl',
];
export const REDIRECT_URI = `${BASE_URL}/oauth/callback`;
// Testlarda soxta server ishlatish uchun almashtirsa bo'ladi
const YT_API = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3';
const YTA_API = process.env.YOUTUBE_ANALYTICS_BASE || 'https://youtubeanalytics.googleapis.com/v2';
const tokenCache = new Map();

export function authUrl(channelId) {
  const s = db().settings;
  if (!s.googleClientId || !s.googleClientSecret) throw new Error('Avval Sozlamalarda Google Client ID va Client Secret kiriting.');
  const params = new URLSearchParams({
    client_id: s.googleClientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    state: channelId,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body) {
  const s = db().settings;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s.googleClientId, client_secret: s.googleClientSecret, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google OAuth: ${data.error_description || data.error || res.status}`);
  return data;
}

/** OAuth callback: kodni tokenga almashtiradi va qaysi YouTube kanal ulanganini aniqlaydi. */
export async function completeAuth(channelId, code) {
  const channel = db().channels.find((c) => c.id === channelId);
  if (!channel) throw new Error('Kanal topilmadi');
  const tok = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI });
  if (!tok.refresh_token) throw new Error('Google refresh token bermadi. Ulanishni qayta urinib ko‘ring.');
  tokenCache.set(channelId, { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 });
  const me = await api(tok.access_token, 'channels', { part: 'snippet,statistics', mine: 'true' });
  const yt = me.items?.[0];
  channel.youtube = {
    refreshToken: tok.refresh_token,
    channelId: yt?.id || null,
    title: yt?.snippet?.title || '(nomsiz kanal)',
    connectedAt: new Date().toISOString(),
  };
  save();
  return channel.youtube;
}

export function disconnect(channelId) {
  const channel = db().channels.find((c) => c.id === channelId);
  if (channel) channel.youtube = null;
  tokenCache.delete(channelId);
  save();
}

export async function accessToken(channel) {
  if (!channel.youtube?.refreshToken) throw new Error(`${channel.name} YouTube’ga ulanmagan.`);
  const cached = tokenCache.get(channel.id);
  if (cached && cached.exp > Date.now()) return cached.token;
  try {
    const tok = await tokenRequest({ refresh_token: channel.youtube.refreshToken, grant_type: 'refresh_token' });
    tokenCache.set(channel.id, { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 });
    return tok.access_token;
  } catch (err) {
    if (/invalid_grant|expired|revoked/i.test(err.message)) {
      channel.youtube.expired = true;
      save();
      throw new Error(`${channel.name}: Google ruxsati muddati tugagan — Sozlamalarda kanalni qayta ulang.`);
    }
    throw err;
  }
}

async function api(token, resource, params, { apiKey } = {}) {
  const qs = new URLSearchParams(params);
  if (apiKey) qs.set('key', apiKey);
  const res = await fetch(`${YT_API}/${resource}?${qs}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json();
  if (!res.ok) throw apiError('YouTube API', data, res.status);
  return data;
}

function apiError(prefix, data, status) {
  const msg = data.error?.message || status;
  if (status === 403 && /scope|insufficient|permission/i.test(String(msg))) {
    return new Error(`${prefix}: yangi ruxsat kerak — API kalitlar → Google OAuth bo‘limida kanalni “Qayta ulash” qiling.`);
  }
  return new Error(`${prefix}: ${msg}`);
}

function oauthChannel(channel) {
  if (!channel.youtube?.refreshToken) throw new Error('Bu funksiya uchun kanalni YouTube’ga ulang (API kalitlar → Google OAuth).');
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Videoni resumable usulda yuklaydi. Kelajakdagi publishAt bo'lsa — video jadval bo'yicha ochiladi. */
export async function uploadVideo(channel, output, filePath, onProgress) {
  const token = await accessToken(channel);
  const size = fs.statSync(filePath).size;
  const publishAt = output.publishAt && new Date(output.publishAt).getTime() > Date.now() + 15 * 60_000 ? new Date(output.publishAt).toISOString() : null;
  const meta = {
    snippet: {
      title: output.title.slice(0, 100),
      description: output.description.slice(0, 5000),
      tags: output.tags,
      categoryId: channel.categoryId || '22',
      defaultLanguage: channel.language || 'en',
      defaultAudioLanguage: channel.language || 'en',
    },
    status: {
      privacyStatus: publishAt ? 'private' : output.privacy,
      ...(publishAt ? { publishAt } : {}),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: Boolean(output.aiDisclosure),
      embeddable: true,
    },
  };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(size),
      'x-upload-content-type': 'video/mp4',
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) {
    const err = await init.json().catch(() => ({}));
    throw new Error(`YouTube yuklashni boshlamadi: ${err.error?.message || init.status}`);
  }
  const location = init.headers.get('location');
  const video = await putFile(location, filePath, size, onProgress);
  return video;
}

function putFile(location, filePath, size, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.request(location, { method: 'PUT', headers: { 'content-length': size, 'content-type': 'video/mp4' } }, (res) => {
      let body = '';
      res.on('data', (d) => {
        body += d;
      });
      res.on('end', () => {
        let data = {};
        try {
          data = JSON.parse(body);
        } catch {
          // javob JSON emas
        }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`YouTube yuklash xatosi: ${data.error?.message || res.statusCode}`));
      });
    });
    req.on('error', reject);
    let sent = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      sent += chunk.length;
      onProgress?.(Math.round((sent / size) * 100));
    });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

export async function setThumbnail(channel, videoId, imagePath) {
  const token = await accessToken(channel);
  const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' },
    body: fs.readFileSync(imagePath),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || String(res.status));
  }
}

function isoDuration(iso) {
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
}

/** Kanal va so'nggi videolar statistikasi (OAuth yoki ochiq API kalit + handle orqali). */
export async function channelReport(channel) {
  const s = db().settings;
  let token = null;
  let params;
  let apiKey;
  if (channel.youtube?.refreshToken) {
    token = await accessToken(channel);
    params = { part: 'snippet,statistics,contentDetails', mine: 'true' };
  } else if (s.youtubeApiKey && channel.handle) {
    apiKey = s.youtubeApiKey;
    params = { part: 'snippet,statistics,contentDetails', forHandle: channel.handle };
  } else {
    throw new Error('Tahlil uchun kanalni YouTube’ga ulang yoki Sozlamalarda YouTube API kalitini kiriting.');
  }
  const ch = (await api(token, 'channels', params, { apiKey })).items?.[0];
  if (!ch) throw new Error('YouTube kanal topilmadi.');
  const uploads = ch.contentDetails.relatedPlaylists.uploads;
  const items = (await api(token, 'playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '50' }, { apiKey })).items || [];
  const ids = items.map((i) => i.contentDetails.videoId);
  const videos = ids.length ? (await api(token, 'videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') }, { apiKey })).items || [] : [];
  const now = Date.now();
  const rows = videos.map((v) => {
    const duration = isoDuration(v.contentDetails.duration);
    const ageDays = Math.max(1, Math.round((now - new Date(v.snippet.publishedAt).getTime()) / 86_400_000));
    const views = Number(v.statistics.viewCount || 0);
    return {
      id: v.id,
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      thumbnail: v.snippet.thumbnails?.medium?.url || null,
      duration,
      isShort: duration <= 180,
      views,
      likes: Number(v.statistics.likeCount || 0),
      comments: Number(v.statistics.commentCount || 0),
      ageDays,
      viewsPerDay: Math.round((views / ageDays) * 10) / 10,
    };
  });
  const avg = (list) => (list.length ? Math.round(list.reduce((s, v) => s + v.views, 0) / list.length) : 0);
  return {
    channel: {
      id: ch.id,
      title: ch.snippet.title,
      subscribers: Number(ch.statistics.subscriberCount || 0),
      views: Number(ch.statistics.viewCount || 0),
      videoCount: Number(ch.statistics.videoCount || 0),
    },
    averages: { shorts: avg(rows.filter((r) => r.isShort)), long: avg(rows.filter((r) => !r.isShort)) },
    videos: rows.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)),
  };
}

/** YouTube Analytics: har video bo'yicha tomosha foizi, o'rtacha davomiylik, obunachi o'sishi. */
export async function deepReport(channel, days = 28) {
  oauthChannel(channel);
  const token = await accessToken(channel);
  const end = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  const qs = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: isoDate(start),
    endDate: isoDate(end),
    metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,shares',
    dimensions: 'video',
    sort: '-views',
    maxResults: '50',
  });
  const res = await fetch(`${YTA_API}/reports?${qs}`, { headers: { authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw apiError('YouTube Analytics', data, res.status);
  const cols = (data.columnHeaders || []).map((c) => c.name);
  const rows = (data.rows || []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const ids = rows.map((r) => r.video);
  const titles = {};
  if (ids.length) {
    const vids = await api(token, 'videos', { part: 'snippet,contentDetails', id: ids.join(',') });
    for (const v of vids.items || []) titles[v.id] = { title: v.snippet.title, duration: isoDuration(v.contentDetails.duration) };
  }
  return {
    days,
    videos: rows.map((r) => ({
      id: r.video,
      title: titles[r.video]?.title || r.video,
      isShort: (titles[r.video]?.duration || 0) <= 180,
      views: r.views,
      minutes: r.estimatedMinutesWatched,
      avgDuration: r.averageViewDuration,
      avgPercent: Math.round(r.averageViewPercentage * 10) / 10,
      subscribers: r.subscribersGained,
      likes: r.likes,
      shares: r.shares,
    })),
  };
}

/** Tomoshabinlar videoning qaysi qismida qolishi (audience retention egri chizig'i). */
export async function retention(channel, videoId) {
  oauthChannel(channel);
  const token = await accessToken(channel);
  const qs = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: '2020-01-01',
    endDate: isoDate(new Date()),
    metrics: 'audienceWatchRatio,relativeRetentionPerformance',
    dimensions: 'elapsedVideoTimeRatio',
    filters: `video==${videoId}`,
  });
  const res = await fetch(`${YTA_API}/reports?${qs}`, { headers: { authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw apiError('YouTube Analytics', data, res.status);
  return (data.rows || []).map(([x, ratio, relative]) => ({ x, ratio, relative }));
}

/** Soha kalit so'zlari bo'yicha oxirgi 7 kunning eng ko'p ko'rilgan videolari. */
export async function trends(channel, keywords) {
  const s = db().settings;
  let token = null;
  let apiKey;
  if (channel.youtube?.refreshToken) token = await accessToken(channel);
  else if (s.youtubeApiKey) apiKey = s.youtubeApiKey;
  else throw new Error('Trendlar uchun kanalni ulang yoki YouTube API kalitini kiriting.');
  const after = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const ids = new Set();
  // Har qidiruv kunlik kvotadan 100 birlik oladi — ko'pi bilan 3 ta kalit so'z
  for (const q of keywords.slice(0, 3)) {
    const r = await api(token, 'search', { part: 'id', q, type: 'video', order: 'viewCount', publishedAfter: after, maxResults: '15', relevanceLanguage: 'en' }, { apiKey });
    for (const it of r.items || []) if (it.id?.videoId) ids.add(it.id.videoId);
  }
  if (!ids.size) return [];
  const vids = await api(token, 'videos', { part: 'snippet,statistics,contentDetails', id: [...ids].slice(0, 50).join(',') }, { apiKey });
  const now = Date.now();
  return (vids.items || [])
    .map((v) => {
      const ageDays = Math.max(0.5, (now - new Date(v.snippet.publishedAt).getTime()) / 86_400_000);
      const views = Number(v.statistics.viewCount || 0);
      return {
        id: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        views,
        viewsPerDay: Math.round(views / ageDays),
        isShort: isoDuration(v.contentDetails.duration) <= 180,
        thumbnail: v.snippet.thumbnails?.medium?.url || null,
      };
    })
    .sort((a, b) => b.viewsPerDay - a.viewsPerDay)
    .slice(0, 20);
}

/** Javob berilmagan so'nggi izohlar. */
export async function unansweredComments(channel) {
  oauthChannel(channel);
  const token = await accessToken(channel);
  const r = await api(token, 'commentThreads', { part: 'snippet', allThreadsRelatedToChannelId: channel.youtube.channelId, maxResults: '30', order: 'time', textFormat: 'plainText' });
  return (r.items || [])
    .filter((t) => t.snippet.totalReplyCount === 0 && t.snippet.topLevelComment.snippet.authorChannelId?.value !== channel.youtube.channelId)
    .map((t) => ({
      id: t.snippet.topLevelComment.id,
      videoId: t.snippet.videoId,
      author: t.snippet.topLevelComment.snippet.authorDisplayName,
      text: t.snippet.topLevelComment.snippet.textDisplay,
      publishedAt: t.snippet.topLevelComment.snippet.publishedAt,
    }));
}

export async function replyToComment(channel, parentId, text) {
  oauthChannel(channel);
  const token = await accessToken(channel);
  const res = await fetch(`${YT_API}/comments?part=snippet`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ snippet: { parentId, textOriginal: String(text).slice(0, 2000) } }),
  });
  const data = await res.json();
  if (!res.ok) throw apiError('YouTube izoh', data, res.status);
  return data;
}

/**
 * Tashxis uchun kanal va so'nggi 50 video haqida to'liq ma'lumot: sarlavha, tavsif, teglar,
 * format (vertikal/gorizontal), bloklangan davlatlar, "bolalar uchun" belgisi va statistika.
 */
export async function channelSnapshot(channel) {
  const s = db().settings;
  let token = null;
  let apiKey;
  let params;
  if (channel.youtube?.refreshToken) {
    token = await accessToken(channel);
    params = { part: 'snippet,statistics,contentDetails,brandingSettings', mine: 'true' };
  } else if (s.youtubeApiKey && channel.handle) {
    apiKey = s.youtubeApiKey;
    params = { part: 'snippet,statistics,contentDetails,brandingSettings', forHandle: channel.handle };
  } else {
    throw new Error('Tashxis uchun kanalni YouTube’ga ulang yoki YouTube API kalitini kiriting (API kalitlar sahifasi).');
  }
  const ch = (await api(token, 'channels', params, { apiKey })).items?.[0];
  if (!ch) throw new Error('YouTube kanal topilmadi — handle to‘g‘riligini tekshiring.');
  const items = (await api(token, 'playlistItems', { part: 'contentDetails', playlistId: ch.contentDetails.relatedPlaylists.uploads, maxResults: '50' }, { apiKey })).items || [];
  const ids = items.map((i) => i.contentDetails.videoId);
  const raw = ids.length
    ? (await api(token, 'videos', { part: 'snippet,statistics,contentDetails,status,player', id: ids.join(','), maxWidth: '480' }, { apiKey })).items || []
    : [];
  const videos = raw.map((v) => {
    const duration = isoDuration(v.contentDetails.duration);
    const w = Number(v.player?.embedWidth) || 0;
    const h = Number(v.player?.embedHeight) || 0;
    const isVertical = w && h ? h > w : null;
    const rr = v.contentDetails.regionRestriction || {};
    return {
      id: v.id,
      title: v.snippet.title,
      description: v.snippet.description || '',
      tags: v.snippet.tags || [],
      publishedAt: v.snippet.publishedAt,
      thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || null,
      categoryId: v.snippet.categoryId,
      defaultAudioLanguage: v.snippet.defaultAudioLanguage || null,
      duration,
      isVertical,
      // Shorts: 3 daqiqagacha va vertikal; format noma'lum bo'lsa 60 soniyagacha
      isShort: isVertical === null ? duration <= 60 : isVertical && duration <= 180,
      views: Number(v.statistics.viewCount || 0),
      likes: v.statistics.likeCount == null ? null : Number(v.statistics.likeCount),
      comments: v.statistics.commentCount == null ? null : Number(v.statistics.commentCount),
      definition: v.contentDetails.definition,
      caption: v.contentDetails.caption === 'true',
      regionBlocked: rr.blocked || [],
      regionAllowed: rr.allowed || null,
      madeForKids: Boolean(v.status?.madeForKids),
      privacy: v.status?.privacyStatus || 'public',
    };
  });
  const branding = ch.brandingSettings?.channel || {};
  return {
    source: token ? 'oauth' : 'apikey',
    channel: {
      id: ch.id,
      title: ch.snippet.title,
      description: ch.snippet.description || '',
      keywords: branding.keywords || '',
      country: ch.snippet.country || branding.country || null,
      defaultLanguage: ch.snippet.defaultLanguage || branding.defaultLanguage || null,
      publishedAt: ch.snippet.publishedAt,
      subscribers: Number(ch.statistics.subscriberCount || 0),
      views: Number(ch.statistics.viewCount || 0),
      videoCount: Number(ch.statistics.videoCount || 0),
    },
    videos,
  };
}

/** Video qayerdan ko'rilgan: Shorts tasmasi, qidiruv, tavsiyalar va h.k. */
export async function trafficSources(channel, videoId) {
  oauthChannel(channel);
  const token = await accessToken(channel);
  const qs = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: '2020-01-01',
    endDate: isoDate(new Date()),
    metrics: 'views',
    dimensions: 'insightTrafficSourceType',
    filters: `video==${videoId}`,
    sort: '-views',
  });
  const res = await fetch(`${YTA_API}/reports?${qs}`, { headers: { authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw apiError('YouTube Analytics', data, res.status);
  return (data.rows || []).map(([source, views]) => ({ source, views }));
}

/** Videoning sarlavhasini YouTube'da almashtiradi (tavsif, teglar va kategoriya saqlanadi). */
export async function updateVideoTitle(channel, videoId, title) {
  oauthChannel(channel);
  const token = await accessToken(channel);
  const current = (await api(token, 'videos', { part: 'snippet', id: videoId })).items?.[0];
  if (!current) throw new Error('Video topilmadi (bu kanalga tegishli emasmi?)');
  const sn = current.snippet;
  const body = {
    id: videoId,
    snippet: {
      title: String(title).slice(0, 100),
      categoryId: sn.categoryId,
      description: sn.description,
      tags: sn.tags,
      ...(sn.defaultLanguage ? { defaultLanguage: sn.defaultLanguage } : {}),
      ...(sn.defaultAudioLanguage ? { defaultAudioLanguage: sn.defaultAudioLanguage } : {}),
    },
  };
  const res = await fetch(`${YT_API}/videos?part=snippet`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw apiError('YouTube', data, res.status);
  return data;
}

/** Ochiq ma'lumot o'qish uchun ruxsat: API kaliti, bo'lmasa ulangan istalgan kanal tokeni. */
async function publicCreds() {
  const s = db().settings;
  if (s.youtubeApiKey) return { token: null, apiKey: s.youtubeApiKey };
  const connected = db().channels.find((c) => c.youtube?.refreshToken && !c.youtube.expired);
  if (connected) return { token: await accessToken(connected), apiKey: undefined };
  throw new Error('Raqobatchilarni ko‘rish uchun API kalitlar sahifasida YouTube API kalitini kiriting yoki kanallaringizdan birini ulang.');
}

/** "https://youtube.com/@name", "@name", "UC…" yoki ".../channel/UC…" dan kanalni topadi. */
export async function resolveChannel(input) {
  const raw = decodeURIComponent(String(input || '').trim());
  let params;
  const id = raw.match(/(UC[\w-]{22})/);
  const handle = raw.match(/@([^/?#\s]+)/);
  if (id) params = { id: id[1] };
  else if (handle) params = { forHandle: `@${handle[1]}` };
  else if (/^[\w.-]{3,}$/.test(raw)) params = { forHandle: `@${raw}` };
  else throw new Error('Kanalni @handle yoki youtube.com/@... havolasi ko‘rinishida kiriting.');
  const { token, apiKey } = await publicCreds();
  const ch = (await api(token, 'channels', { part: 'snippet,statistics,contentDetails', ...params }, { apiKey })).items?.[0];
  if (!ch) throw new Error('Kanal topilmadi — havolani tekshiring.');
  return {
    youtubeId: ch.id,
    title: ch.snippet.title,
    handle: ch.snippet.customUrl || params.forHandle || null,
    description: (ch.snippet.description || '').slice(0, 600),
    avatar: ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url || null,
    publishedAt: ch.snippet.publishedAt,
    country: ch.snippet.country || null,
    subscribers: Number(ch.statistics.subscriberCount || 0),
    views: Number(ch.statistics.viewCount || 0),
    videoCount: Number(ch.statistics.videoCount || 0),
    uploads: ch.contentDetails.relatedPlaylists.uploads,
  };
}

/** Kanalning so'nggi `max` ta videosi (sahifalab), statistika va format bilan. */
export async function publicChannelVideos(uploadsPlaylistId, max = 200) {
  const { token, apiKey } = await publicCreds();
  const ids = [];
  let pageToken;
  do {
    const r = await api(token, 'playlistItems', { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) }, { apiKey });
    for (const it of r.items || []) ids.push(it.contentDetails.videoId);
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < max);
  const unique = [...new Set(ids)].slice(0, max);
  const videos = [];
  for (let i = 0; i < unique.length; i += 50) {
    const r = await api(token, 'videos', { part: 'snippet,statistics,contentDetails,player', id: unique.slice(i, i + 50).join(','), maxWidth: '480' }, { apiKey });
    for (const v of r.items || []) {
      if (videos.some((x) => x.id === v.id)) continue;
      const duration = isoDuration(v.contentDetails.duration);
      const w = Number(v.player?.embedWidth) || 0;
      const h = Number(v.player?.embedHeight) || 0;
      const isVertical = w && h ? h > w : null;
      videos.push({
        id: v.id,
        title: v.snippet.title,
        description: (v.snippet.description || '').slice(0, 300),
        tags: (v.snippet.tags || []).slice(0, 15),
        publishedAt: v.snippet.publishedAt,
        thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || null,
        duration,
        isShort: isVertical === null ? duration <= 60 : isVertical && duration <= 180,
        views: Number(v.statistics.viewCount || 0),
        likes: v.statistics.likeCount == null ? null : Number(v.statistics.likeCount),
        comments: v.statistics.commentCount == null ? null : Number(v.statistics.commentCount),
      });
    }
  }
  return videos;
}
