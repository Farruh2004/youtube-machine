// Kanal tashxisi: nega videolar "uchmadi" — dalilga asoslangan qoidalar + AI xulosasi.
// Qoidalar bepul (faqat YouTube ma'lumotlari), AI qismi ixtiyoriy va keshlanadi.
import { db, save } from './store.js';
import { channelSnapshot, deepReport, retention, trafficSources } from './youtube.js';
import { generateJson, fetchImage } from './ai/llm.js';
import { channelDiagnosisPrompt, videoDiagnosisPrompt } from './ai/prompts.js';

const DAY = 86_400_000;
const WEIGHT = { high: 15, medium: 7, low: 3, info: 0 };

export function median(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const issue = (code, severity, title, detail, fix) => ({ code, severity, title, detail, fix });

function nonLatinShare(text) {
  const letters = String(text).match(/\p{L}/gu) || [];
  if (letters.length < 4) return 0;
  const latin = String(text).match(/\p{Script=Latin}/gu) || [];
  return 1 - latin.length / letters.length;
}

function hashtags(text) {
  return String(text).match(/#[\p{L}\p{N}_]+/gu) || [];
}

function titleKey(title) {
  return String(title)
    .toLowerCase()
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
}

const pct = (n) => `${(Math.round(n * 1000) / 10).toString()}%`;

/** Har bir videoni kanalning o'z o'rtachasi bilan solishtiradi (bir xil format ichida). */
export function classify(videos, now = Date.now()) {
  for (const v of videos) v.ageDays = Math.max(0, (now - new Date(v.publishedAt).getTime()) / DAY);
  const mature = videos.filter((v) => v.ageDays >= 3);
  const groupMedian = {};
  for (const type of ['short', 'long']) {
    const pool = mature.filter((v) => (v.isShort ? 'short' : 'long') === type);
    groupMedian[type] = pool.length >= 3 ? median(pool.map((v) => v.views)) : median(mature.map((v) => v.views));
  }
  for (const v of videos) {
    const med = groupMedian[v.isShort ? 'short' : 'long'];
    v.perf = med ? Math.round((v.views / med) * 100) / 100 : null;
    if (v.ageDays < 2) v.verdict = 'new';
    else if (v.perf == null) v.verdict = 'unknown';
    else if (v.perf >= 2) v.verdict = 'hit';
    else if (v.perf >= 0.6) v.verdict = 'normal';
    else v.verdict = 'flop';
    v.likeRate = v.likes != null && v.views >= 50 ? v.likes / v.views : null;
  }
  return groupMedian;
}

export function videoIssues(v, ctx) {
  const out = [];
  const isMusic = ctx.channelType === 'music';
  const blocked = v.regionBlocked?.length || 0;
  if (blocked || (v.regionAllowed && v.regionAllowed.length < 100)) {
    out.push(issue('REGION_BLOCKED', 'high', 'Ba’zi davlatlarda bloklangan',
      blocked
        ? `Video ${blocked} ta davlatda ko‘rsatilmaydi. Bu odatda mualliflik huquqi egasining Content ID da’vosi natijasi — ko‘rishlar shu sababli keskin cheklanadi.`
        : `Video faqat ${v.regionAllowed.length} ta davlatda ochiq. Bu odatda Content ID da’vosi natijasi.`,
      'YouTube Studio → Content → Restrictions ustunini tekshiring. Da’vo bo‘lsa: lavhani qisqartiring, original sharh ulushini oshiring yoki boshqa manbadan foydalaning.'));
  }
  if (v.madeForKids) {
    out.push(issue('MADE_FOR_KIDS', 'high', '“Bolalar uchun” deb belgilangan',
      'Bunday videolarda izohlar o‘chadi, obunachilarga bildirishnoma bormaydi va tavsiyalarga kam chiqadi.',
      'YouTube Studio → video → Audience → “No, it’s not made for kids”.'));
  } else if (v.comments == null) {
    out.push(issue('COMMENTS_OFF', 'medium', 'Izohlar o‘chirilgan',
      'Izohlar — muhim faollik signali; o‘chirilgan bo‘lsa algoritm videoni kamroq sinaydi.',
      'YouTube Studio → video → Comments: “On”.'));
  }
  if (v.isVertical === false && v.duration <= 180) {
    out.push(issue('HORIZONTAL_SHORT', 'high', 'Qisqa, lekin gorizontal video',
      `${v.duration} soniyalik gorizontal video Shorts tasmasiga tushmaydi, oddiy video sifatida esa juda qisqa — ikki formatning hech biriga to‘g‘ri kelmaydi.`,
      '1080×1920 vertikal qilib qayta montaj qiling (dastur Shorts’ni shunday tayyorlaydi) va qayta yuklang.'));
  }
  if (v.definition === 'sd') {
    out.push(issue('LOW_QUALITY', 'medium', 'Past sifat (SD)', 'Video HD emas — tavsiyalarda va katta ekranda yomon ko‘rinadi.', 'Kamida 1080p da eksport qiling.'));
  }

  const title = v.title || '';
  if (title.length > 70) {
    out.push(issue('TITLE_LONG', 'medium', `Sarlavha uzun (${title.length} belgi)`, 'Telefonda ~40–60 belgidan keyin kesiladi — asosiy so‘z ko‘rinmay qolishi mumkin.', 'Eng kuchli so‘zni boshiga qo‘ying va 60 belgigacha qisqartiring.'));
  } else if (title.replace(/#[\p{L}\p{N}_]+/gu, '').trim().length < 15) {
    out.push(issue('TITLE_SHORT', 'low', 'Sarlavha juda qisqa', 'Qisqa sarlavha qidiruvda topilishi uchun yetarli kalit so‘z bermaydi.', 'Mavzu, janr yoki jangchi ismini qo‘shing.'));
  }
  if (hashtags(title).length >= 3) {
    out.push(issue('TITLE_HASHTAGS', 'medium', 'Sarlavhada ko‘p hashtag', 'Hashtaglar sarlavhaning asosiy qismini egallab, tomoshabinga nima haqida ekanini aytmaydi.', 'Sarlavhada 0–1 hashtag qoldiring, qolganini tavsifga o‘tkazing.'));
  }
  const letters = title.match(/\p{L}/gu) || [];
  const upper = title.match(/\p{Lu}/gu) || [];
  if (letters.length > 12 && upper.length / letters.length > 0.7) {
    out.push(issue('TITLE_CAPS', 'low', 'Sarlavha to‘liq katta harflarda', 'Butunlay KATTA harfli sarlavha spamdek ko‘rinadi va o‘qilishi qiyin.', 'Faqat 1–2 urg‘u so‘zni katta harf bilan yozing.'));
  }
  if (ctx.channelLanguage === 'en' && nonLatinShare(title) > 0.3) {
    out.push(issue('TITLE_LANGUAGE', 'medium', 'Sarlavha lotin yozuvida emas',
      'Kanal inglizcha auditoriyaga mo‘ljallangan, sarlavha esa boshqa yozuvda — qidiruv va tavsiyalar boshqa auditoriyaga yo‘naladi.',
      'Inglizcha sarlavha qiling (asl nomni qavsda qoldirish mumkin) yoki kanal yo‘nalishini aniq shu tilga belgilang.'));
  }
  const desc = (v.description || '').trim();
  if (desc.length < 100) {
    out.push(issue('DESC_SHORT', 'medium', 'Tavsif juda qisqa', 'Tavsif qidiruv va tavsiyalar uchun kontekst beradi; bo‘sh tavsif — yo‘qotilgan imkoniyat.', 'Birinchi 2 qatorda asosiy kalit so‘zlar bilan 2–3 gaplik tavsif yozing.'));
  }
  const tagCount = hashtags(`${title} ${desc}`).length;
  if (tagCount > 60) {
    out.push(issue('HASHTAGS_IGNORED', 'high', `Hashtaglar e’tiborsiz qoldiriladi (${tagCount})`, '60 tadan ortiq hashtag bo‘lsa, YouTube videodagi barcha hashtaglarni e’tiborsiz qoldiradi.', '3–5 ta aniq hashtag qoldiring.'));
  } else if (tagCount > 15) {
    out.push(issue('HASHTAGS_MANY', 'medium', `Hashtag juda ko‘p (${tagCount})`, 'Ko‘p hashtag spamdek ko‘rinadi va mavzuni chalkashtiradi.', '3–5 ta aniq hashtag qoldiring.'));
  }
  if (!v.tags?.length) {
    out.push(issue('NO_TAGS', 'low', 'Teglar yo‘q', 'Teglarning ta’siri kichik, lekin noto‘g‘ri yoziladigan nomlar (jangchi, qo‘shiq) uchun foydali.', 'Asosiy nom, janr va imlo variantlarini teg sifatida qo‘shing.'));
  }
  if ((ctx.titleKeyCount[titleKey(title)] || 0) >= 3 && titleKey(title).split(' ').length >= 2) {
    out.push(issue('REPETITIVE_TITLES', 'low', 'Sarlavhalar bir xil qolipda', 'Bir xil boshlanadigan sarlavhalar takroriy kontentdek ko‘rinadi va tomoshabin farqini sezmaydi.', 'Har bir videoning o‘ziga xos jihatini sarlavha boshiga chiqaring.'));
  }
  const expectedCategory = isMusic ? '10' : ctx.channelType === 'fight' ? '17' : null;
  if (expectedCategory && v.categoryId && v.categoryId !== expectedCategory) {
    out.push(issue('CATEGORY', 'low', 'Kategoriya kanal yo‘nalishiga mos emas', `Kategoriya: ${v.categoryId}, kutilgan: ${expectedCategory} (${isMusic ? 'Music' : 'Sports'}).`, 'YouTube Studio → video → Category ni to‘g‘rilang.'));
  }
  if (ctx.channelType === 'fight' && !v.isShort && v.duration > 120 && !v.caption) {
    out.push(issue('NO_CAPTIONS', 'low', 'Subtitr fayli yo‘q', 'Sharhli uzun videoda subtitr qidiruvga matn beradi va ovozsiz ko‘ruvchilarni ushlab qoladi.', 'Dastur yasagan subtitrni yoki YouTube avtomatik subtitrini tasdiqlang.'));
  }
  if (v.likeRate != null && v.views >= 100 && ctx.medianLikeRate && v.likeRate < ctx.medianLikeRate * 0.5) {
    out.push(issue('LOW_LIKES', 'medium', `Layk ulushi past (${pct(v.likeRate)}, kanalda ${pct(ctx.medianLikeRate)})`,
      'Tomoshabinga yoqmagan yoki sarlavha/prevyu va’da qilgan narsa videoda berilmagan.',
      'Sarlavha va prevyu va’da qilgan narsani videoning birinchi soniyalarida bering.'));
  }

  const a = ctx.analytics?.[v.id];
  if (a) {
    if (v.isShort && a.avgPercent < 60) {
      out.push(issue('LOW_RETENTION_SHORT', 'high', `Shorts oxirigacha ko‘rilmayapti (o‘rtacha ${a.avgPercent}%)`,
        'Shorts tasmasida YouTube asosan videoni qancha qismi ko‘rilgani va qayta ko‘rilishiga qaraydi; past bo‘lsa, video yangi tomoshabinlarga ko‘rsatilmay qo‘yadi.',
        isMusic
          ? 'Shorts’ni qo‘shiqning eng kuchli joyidan (naqarotdan) boshlang, sekin kirishni kesing va 20–35 soniyaga qisqartiring.'
          : 'Birinchi soniyada eng kuchli lahzani (zarbani) ko‘rsating, kirish so‘zlarini olib tashlang va videoni qisqartiring.'));
    } else if (!v.isShort && a.avgPercent < 30) {
      out.push(issue('LOW_RETENTION_LONG', 'high', `Tomoshabin erta chiqib ketyapti (o‘rtacha ${a.avgPercent}%)`,
        'Uzun videoda o‘rtacha tomosha foizi past bo‘lsa, tavsiyalarga kam chiqadi.',
        'Birinchi 30 soniyada videoning eng qiziq qismini va’da qiling, cho‘ziq joylarni qisqartiring.'));
    }
    if (v.views >= 300 && a.subscribers === 0) {
      out.push(issue('NO_SUBS', 'low', 'Ko‘rish bor, obuna yo‘q', 'Tomoshabinlar videoni ko‘rmoqda, lekin kanalga qaytish uchun sabab topmayapti.', 'Oxirida aniq chaqiriq va keyingi videoga havola (end screen) qo‘shing; kanal mavzusini izchil qiling.'));
    }
  }

  if (v.verdict === 'flop' && !out.some((x) => x.severity === 'high' || x.severity === 'medium')) {
    out.push(issue('PACKAGING_OR_TOPIC', 'info', 'Aniq texnik muammo topilmadi',
      'Ehtimoliy sabab — qadoqlash (sarlavha va prevyu) yoki mavzuga qiziqish past.',
      '“🔍 Nega uchmadi?” tugmasi bilan AI prevyu, sarlavha va raqamlarni birga tahlil qiladi.'));
  }
  return out.sort((x, y) => WEIGHT[y.severity] - WEIGHT[x.severity]);
}

export function channelIssues(snapshot, ctx) {
  const out = [];
  const { channel, videos } = snapshot;
  if (videos.length < 30) {
    out.push(issue('FEW_VIDEOS', 'info', `Kanalda hali kam video (${videos.length})`,
      'YouTube kanal auditoriyasini aniqlashi uchun odatda 30–50 ta izchil video kerak; birinchi videolarning kam ko‘rilishi — odatiy holat.',
      'Bir yo‘nalishda muntazam (har kuni yoki haftasiga 4–5 ta) chiqarishni davom ettiring.'));
  }
  const dates = videos.map((v) => new Date(v.publishedAt).getTime()).sort((a, b) => b - a).slice(0, 15);
  const gaps = dates.slice(1).map((d, i) => (dates[i] - d) / DAY);
  if (gaps.length) {
    const maxGap = Math.max(...gaps);
    const medGap = median(gaps);
    if (maxGap > 14) {
      out.push(issue('UPLOAD_GAPS', 'medium', `Yuklashlar orasida ${Math.round(maxGap)} kunlik tanaffus bor`,
        'Uzoq tanaffusdan keyin algoritm kanalni “qaytadan sinaydi” va obunachilar odatini yo‘qotadi.',
        'Jadval bo‘yicha muntazam chiqaring — dastur har kanalga kuniga bitta slot beradi.'));
    } else if (medGap > 3) {
      out.push(issue('LOW_FREQUENCY', 'low', `Odatda har ${Math.round(medGap)} kunda bitta video`, 'Yangi kanal uchun bu sekin — sinov uchun ma’lumot kam yig‘iladi.', 'Haftasiga kamida 4–5 ta video (asosan Shorts) chiqaring.'));
    }
  }
  if ((channel.description || '').trim().length < 80) {
    out.push(issue('CHANNEL_DESC', 'medium', 'Kanal tavsifi bo‘sh yoki juda qisqa', 'Tavsif kanalning nima haqida ekanini YouTube va tomoshabinga tushuntiradi.', 'YouTube Studio → Customization → Basic info: 2–3 gapda kanal mavzusi, kim uchun va qancha tez-tez video chiqishini yozing.'));
  }
  if (!String(channel.keywords || '').trim()) {
    out.push(issue('CHANNEL_KEYWORDS', 'low', 'Kanal kalit so‘zlari kiritilmagan', 'Kichik signal, lekin yangi kanal uchun mavzuni aniqlashtiradi.', 'YouTube Studio → Settings → Channel → Keywords.'));
  }
  if (!channel.country) {
    out.push(issue('CHANNEL_COUNTRY', 'low', 'Kanal davlati ko‘rsatilmagan', 'Monetizatsiya va ba’zi tavsiyalar uchun kerak.', 'YouTube Studio → Settings → Channel → Country of residence.'));
  }
  const langMixed = videos.filter((v) => nonLatinShare(v.title) > 0.3).length;
  if (langMixed >= 2 && videos.length - langMixed >= 2) {
    out.push(issue('MIXED_LANGUAGES', 'medium', 'Sarlavhalar turli tillarda',
      `${langMixed} ta video sarlavhasi lotin yozuvida emas, qolganlari lotinda. Algoritm kanalni qaysi auditoriyaga ko‘rsatishni bilmay qoladi.`,
      'Bitta asosiy auditoriyani tanlang va sarlavha, tavsif hamda kanal tilini shunga moslang.'));
  }
  const blocked = videos.filter((v) => v.regionBlocked?.length || (v.regionAllowed && v.regionAllowed.length < 100)).length;
  if (blocked >= 2) {
    out.push(issue('MANY_CLAIMS', 'high', `${blocked} ta video davlatlarda bloklangan`,
      'Bu mualliflik huquqi da’volari tizimli muammo ekanini ko‘rsatadi; takrorlansa, kanal ogohlantirish olishi mumkin.',
      'Begona lavhalarning ulushini kamaytiring va original tahlil/sharhni oshiring.'));
  }
  const { short, long } = ctx.groupMedian;
  const shorts = videos.filter((v) => v.isShort).length;
  if (short && long && shorts >= 2 && videos.length - shorts >= 2) {
    const ratio = short / long;
    if (ratio >= 3) out.push(issue('FORMAT_SHORTS_WIN', 'info', `Shorts uzun videolardan ~${Math.round(ratio)} marta ko‘p ko‘rilmoqda`, 'Hozir kanalga Shorts orqali yangi tomoshabin kelmoqda.', 'Har bir uzun video uchun 2–3 ta Shorts chiqaring va ulardan uzun videoga havola bering.'));
    else if (ratio <= 1 / 3) out.push(issue('FORMAT_LONG_WIN', 'info', `Uzun videolar Shorts’dan ~${Math.round(1 / ratio)} marta ko‘p ko‘rilmoqda`, 'Kanal auditoriyasi uzunroq formatni afzal ko‘ryapti.', 'Uzun videolar ulushini oshiring, Shorts’ni ularga “treyler” sifatida ishlating.'));
  }
  return out.sort((x, y) => WEIGHT[y.severity] - WEIGHT[x.severity]);
}

/** Qoidaga asoslangan sog'lik bali (0–100). Faqat yo'nalish ko'rsatkichi — aniq baho emas. */
function healthScore(chIssues, videos) {
  const ch = chIssues.reduce((s, i) => s + WEIGHT[i.severity], 0);
  const perVideo = videos.length ? videos.reduce((s, v) => s + v.issues.reduce((t, i) => t + WEIGHT[i.severity], 0), 0) / videos.length : 0;
  return Math.max(0, Math.min(100, Math.round(100 - ch - perVideo * 1.5)));
}

/** Ma'lumot yig'ib, qoidalar bo'yicha tashxis qo'yadi va natijani saqlaydi (AI keshlari saqlanib qoladi). */
export async function runDiagnosis(channel) {
  const snapshot = await channelSnapshot(channel);
  let analytics = null;
  let analyticsError = null;
  if (snapshot.source === 'oauth') {
    try {
      const rep = await deepReport(channel, 365);
      analytics = Object.fromEntries(rep.videos.map((v) => [v.id, v]));
    } catch (err) {
      analyticsError = err.message;
    }
  }
  return buildDiagnosis(channel, snapshot, analytics, analyticsError);
}

export function buildDiagnosis(channel, snapshot, analytics = null, analyticsError = null, now = Date.now()) {
  const videos = snapshot.videos.map((v) => ({ ...v }));
  const groupMedian = classify(videos, now);
  const likeRates = videos.map((v) => v.likeRate).filter((x) => x != null);
  const titleKeyCount = {};
  for (const v of videos) titleKeyCount[titleKey(v.title)] = (titleKeyCount[titleKey(v.title)] || 0) + 1;
  const ctx = {
    channelType: channel.type,
    channelLanguage: channel.language || 'en',
    medianLikeRate: median(likeRates),
    titleKeyCount,
    analytics,
    groupMedian,
  };
  for (const v of videos) {
    v.analytics = analytics?.[v.id] || null;
    v.issues = videoIssues(v, ctx);
  }
  const chIssues = channelIssues({ ...snapshot, videos }, ctx);
  const data = db();
  data.diagnoses ||= {};
  const prev = data.diagnoses[channel.id] || {};
  const result = {
    at: new Date(now).toISOString(),
    source: snapshot.source,
    analyticsAvailable: Boolean(analytics),
    analyticsError,
    channel: snapshot.channel,
    medians: { short: groupMedian.short, long: groupMedian.long, likeRate: ctx.medianLikeRate },
    counts: {
      hit: videos.filter((v) => v.verdict === 'hit').length,
      normal: videos.filter((v) => v.verdict === 'normal').length,
      flop: videos.filter((v) => v.verdict === 'flop').length,
      new: videos.filter((v) => v.verdict === 'new').length,
    },
    score: healthScore(chIssues, videos),
    channelIssues: chIssues,
    videos: videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)),
    ai: prev.ai || null,
    videoAi: prev.videoAi || {},
  };
  data.diagnoses[channel.id] = result;
  save();
  return result;
}

export function getDiagnosis(channelId) {
  return db().diagnoses?.[channelId] || null;
}

/** AI: kanal bo'yicha umumiy xulosa — nega o'smayapti va nima qilish kerak. */
export async function aiChannelAdvice(channel) {
  const d = getDiagnosis(channel.id);
  if (!d) throw new Error('Avval “Tahlil qilish” tugmasini bosing.');
  const advice = await generateJson({ ...channelDiagnosisPrompt({ channel, diagnosis: d }), maxTokens: 4000, cost: { channelId: channel.id } });
  d.ai = { ...advice, at: new Date().toISOString() };
  save();
  return d.ai;
}

function summarizeRetention(points) {
  if (!points?.length) return null;
  const at = (frac) => points.reduce((best, p) => (Math.abs(p.x - frac) < Math.abs(best.x - frac) ? p : best), points[0]);
  return [0.05, 0.1, 0.25, 0.5, 0.75, 0.95].map((f) => ({ at: Math.round(f * 100), stillWatching: Math.round(at(f).ratio * 100) }));
}

/** AI: bitta video — nega uchmadi (prevyu rasmi, sarlavha, raqamlar, retention va trafik manbalari bilan). */
export async function aiVideoDiagnosis(channel, videoId) {
  const d = getDiagnosis(channel.id);
  const video = d?.videos.find((v) => v.id === videoId);
  if (!video) throw new Error('Video topilmadi — tahlilni yangilang.');
  let ret = null;
  let traffic = null;
  if (d.source === 'oauth') {
    try {
      ret = summarizeRetention(await retention(channel, videoId));
    } catch {
      // retention hali yo'q bo'lishi mumkin (kam ko'rish)
    }
    try {
      traffic = (await trafficSources(channel, videoId)).slice(0, 6);
    } catch {
      // ixtiyoriy
    }
  }
  const images = [];
  if (video.thumbnail) {
    try {
      images.push(await fetchImage(video.thumbnail));
    } catch {
      // rasmsiz ham tahlil qilinadi
    }
  }
  const hits = d.videos.filter((v) => v.verdict === 'hit' && v.id !== videoId).slice(0, 3);
  const result = await generateJson({
    ...videoDiagnosisPrompt({ channel, diagnosis: d, video, retention: ret, traffic, hits, hasImage: images.length > 0 }),
    images,
    maxTokens: 3000,
    cost: { channelId: channel.id },
  });
  d.videoAi ||= {};
  d.videoAi[videoId] = { ...result, retention: ret, traffic, viewsAtDiagnosis: video.views, at: new Date().toISOString() };
  save();
  return d.videoAi[videoId];
}
