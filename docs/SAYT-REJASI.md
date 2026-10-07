# YouTube Machine — sayt (ko‘p foydalanuvchili) versiyasi rejasi

**Holat:** 1-bosqich bajarildi — `gateway/` (ro‘yxat, kirish, admin, har foydalanuvchiga alohida nusxa) va Docker + Caddy (HTTPS).
O‘rnatish: [`docs/SAYT-ORNATISH.md`](SAYT-ORNATISH.md). Keyingi bosqichlar: to‘lov, umumiy Google ilova, har nusxani alohida konteynerda ishlatish.

## 1. Hozir allaqachon tayyor bo‘lgan narsalar

| Nima | Qayerda | Nima uchun kerak |
|---|---|---|
| Har foydalanuvchi ma’lumotlari alohida papkada | `YTM_DATA_DIR` | Bir serverda ko‘p foydalanuvchi — har biriga o‘z papkasi |
| Parol bilan himoya (HTTP Basic) | `APP_PASSWORD` | Saytda kirishni yopish |
| Tashqi manzil | `PUBLIC_URL` (masalan `https://ali.studio.uz`) | YouTube’ga ulashda Google shu manzilga qaytaradi |
| Docker | `Dockerfile`, `docker-compose.yml` | Har foydalanuvchini alohida konteynerda ishga tushirish |
| Kanalsiz boshlash, yo‘riqnoma | Boshqaruv paneli | Yangi foydalanuvchi o‘zi sozlay oladi |

## 2. Eng tez yo‘l: “har foydalanuvchiga bitta konteyner”

Dastur kodini deyarli o‘zgartirmasdan saytga aylantirish:

```
foydalanuvchi ──HTTPS──▶ Caddy (reverse proxy, avtomatik SSL)
                           │
                           ├─▶ Kirish sayti (ro‘yxatdan o‘tish, to‘lov, kabinet)
                           │
                           └─▶ ali.studio.uz  ─▶ konteyner "ali"  (YTM_DATA_DIR=/data/ali,  PUBLIC_URL=https://ali.studio.uz)
                               vali.studio.uz ─▶ konteyner "vali" (YTM_DATA_DIR=/data/vali, PUBLIC_URL=https://vali.studio.uz)
```

Qilinadigan ishlar:
1. **Kirish sayti** (kichik alohida dastur): ro‘yxatdan o‘tish, email tasdiqlash, parolni tiklash, tarif/to‘lov.
2. Yangi foydalanuvchi yaratilganda: `docker run` bilan konteyner, `/data/<id>` papka, subdomen.
3. **Caddy** `forward_auth` orqali har so‘rovni kirish saytida tekshiradi (shunda `APP_PASSWORD` kerak emas).
4. Faol bo‘lmagan konteynerlarni to‘xtatish, kirganda qayta yoqish (xotira tejash).
5. Kunlik zaxira nusxa: `/data` papkasi.

Afzalligi: 2–4 haftada ishga tushadi, foydalanuvchilar bir-biridan to‘liq ajratilgan.
Kamchiligi: har konteyner ~150 MB xotira oladi — yuzlab foydalanuvchida qimmatlashadi (keyin 3-bo‘limga o‘tiladi).

## 3. Keyinroq: haqiqiy ko‘p foydalanuvchili tuzilma

- `users` jadvali, `data/db.json` o‘rniga PostgreSQL (har yozuvda `userId`).
- Montaj navbati alohida **worker** serverlarda (ffmpeg og‘ir): Redis/BullMQ navbati.
- Videolar S3/R2 obyekt xotirasida, ma’lum muddatdan keyin avtomatik o‘chirish.
- Foydalanuvchi kalitlari **shifrlangan** holda saqlanadi (serverdagi asosiy kalit bilan AES-GCM).

## 4. Google (YouTube) masalasi — eng muhimi

YouTube’ga yuklash ruxsatlari (`youtube.upload`, `youtube.force-ssl`, `yt-analytics.readonly`) Google uchun **“sensitive”**.

- **A variant (tavsiya, boshlash uchun):** har foydalanuvchi **o‘z Google kalitini** kiritadi (hozirgidek, JSON faylni tashlab).
  Google tekshiruvi kerak emas. Foydalanuvchi uchun 5 daqiqalik ish — dastur ichida yo‘riqnoma bor.
- **B variant (keyin):** bitta umumiy Google ilova. Google’ning ilova tekshiruvidan o‘tish kerak:
  domen, maxfiylik siyosati sahifasi, foydalanish shartlari, ilova qanday ishlashini ko‘rsatadigan video. Odatda bir necha hafta oladi.
  Shundan keyin foydalanuvchi faqat “YouTube’ga ulash” tugmasini bosadi.

Serverda Google Cloud’da **“Web application”** turidagi kalit va redirect manzil: `https://<subdomen>/oauth/callback`.

## 5. AI kalitlari va to‘lov modeli

- **O‘z kalitingiz bilan (BYOK):** foydalanuvchi o‘z Claude/OpenAI/Gemini kalitini kiritadi, siz faqat platforma uchun oylik to‘lov olasiz. Xavf kam.
- **Kreditlar:** siz umumiy kalitlardan foydalanasiz, foydalanuvchi kredit sotib oladi. Dastur allaqachon har AI chaqiruv narxini hisoblaydi (`costs`) — limitlarni foydalanuvchiga bog‘lash qoladi.
- To‘lov: Click, Payme (O‘zbekiston), Stripe (xorij).

## 6. Server va taxminiy xarajat

- Montaj protsessorni ko‘p ishlatadi: 4 yadroli serverda bitta 4 daqiqalik video ~2–5 daqiqada yig‘iladi.
- Boshlash uchun: 4 vCPU / 8 GB RAM / 160 GB disk VPS (Hetzner, DigitalOcean va h.k.) — oyiga taxminan $10–40.
- Foydalanuvchi ko‘paysa: alohida worker serverlar qo‘shiladi.
- Narxlar o‘zgarib turadi — tanlashda provayder sahifasini tekshiring.

## 7. Huquqiy va xavfsizlik

- Maxfiylik siyosati va foydalanish shartlari sahifalari (Google tekshiruvi uchun ham shart).
- YouTube API xizmat shartlariga rioya (foydalanuvchi ma’lumotlarini 30 kundan ortiq keshlamaslik va h.k.).
- HTTPS majburiy, so‘rovlar soniga cheklov, parollar `bcrypt` bilan.
- Har foydalanuvchi faqat o‘z fayllarini ko‘radi (2-bo‘limda konteyner, 3-bo‘limda `userId` tekshiruvi).

## 8. Bosqichlar (keyingi safar shu tartibda)

1. Domen va VPS olish → Docker + Caddy o‘rnatish.
2. Kirish sayti (ro‘yxat, kirish) + konteyner yaratish skripti.
3. 3–5 ta tanish bilan sinov (A variant: o‘z Google va AI kalitlari).
4. To‘lov qo‘shish.
5. Maxfiylik siyosati → Google ilova tekshiruvi (B variant).
6. Foydalanuvchi ko‘payganda — 3-bo‘lim.
