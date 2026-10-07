# 🎬 YouTube Machine

YouTube kanallari uchun avtomatik video ishlab chiqarish dasturi — **bepul, har kim o‘z kompyuterida, o‘z kalitlari bilan** ishlatadi.
Siz material berasiz, dastur ssenariy, ovoz, subtitr, montaj, prevyu, SEO va jadval bo‘yicha YouTube’ga yuklashni o‘zi bajaradi.
Har bir videoni chiqishdan oldin siz ko‘rib tasdiqlaysiz.

Dastur o‘z kompyuteringizda ishlaydi. Montaj ham shu yerda bepul bajariladi, pul faqat AI xizmatlariga (matn va ovoz) ketadi.
Tashqi kutubxonalarga bog‘liq emas. API kalitlaringiz, kanallaringiz va videolaringiz faqat sizning kompyuteringizdagi `data` papkasida saqlanadi — hech qayerga yuborilmaydi.

---

## Nima qiladi

| Kanal | Siz berasiz | Dastur bajaradi |
|---|---|---|
| 🎵 **Musiqa kanali** | Suno qo‘shig‘i (MP3/WAV), matni, muqova va fon videosi (ixtiyoriy) | Fon (sekin suzuvchi rasm yoki takrorlanuvchi video) → qo‘shiq matnini vaqtlash → **karaoke** uslubidagi **1920×1080 lyric video** + inglizcha **tarjima qatori** → qo‘shiqning eng kuchli joylaridan **3 tagacha 1080×1920 Shorts** → prevyu → SEO |
| 🥊 **Jang tahlili kanali** | Jang lavhasi yoki **to‘liq jang videosi**, jangchilar va faktlar | Muhim lahzani topish → **to‘xtash + yaqinlashtirish + aylana belgi + sekin takror** → inglizcha **original tahlil** → diktor ovozi (OpenAI yoki **o‘z ovozingiz klon**i, ElevenLabs) → subtitrlar → harakatga ergashadigan **vertikal Shorts** yoki gorizontal video → prevyu → SEO |
| 🎬 **Tushuntiruvchi kanal** | Personaj rasmi + bir jumlalik g‘oya (yoki o‘zingiz yasagan rasmlar va ovoz) | Ssenariy → sahna-sahna personajli rasmlar → ovoz (OpenAI, ElevenLabs yoki Google AI Studio) → rangli yorliqlar, sariq kalit so‘zli subtitrlar, ovoz effektlari, fon musiqasi → prevyu → SEO |

Umumiy imkoniyatlar:
- 📊 **Boshqaruv paneli** — sozlash holati, oylik xarajat, ko‘rib chiqish kutayotgan videolar, kanallarning keyingi bo‘sh sloti.
- ✅ **Ko‘rib chiqish** — videoni ko‘rasiz; sarlavha (AI 3 ta variant beradi), tavsif, teglar, matn va vaqtlarni tahrirlaysiz.
- 📅 **Jadval** — har kanalga kuniga bitta video, belgilangan soatda. Uzun video va Shorts turli kunlarga qo‘yiladi.
- 📤 **Yuklash** — rasmiy Google ruxsati (OAuth) orqali ishlaydi, parol kerak emas. Video “private + publishAt” holatida yuklanadi va YouTube uni o‘zi belgilangan vaqtda ochadi. Prevyu ham o‘rnatiladi.
- 📈 **Analiz** — kanal statistikasi, kunlik ko‘rishlar bo‘yicha reyting, AI tavsiyalari va keyingi video g‘oyalari.
- 💵 **Xarajatlar** — har bir AI chaqiruvi hisoblanadi. Oylik chegaraga (standart $100) yetganda pullik chaqiruvlar to‘xtaydi, montaj esa bepul davom etadi.
- 🔁 **Qayta montaj bepul** — AI natijalari keshdan olinadi. Faqat “AI bilan qayta yaratish” tugmasi qayta pul sarflaydi.
- 📦 **Ko‘plab yuklash** — bir haftalik qo‘shiqlarni birdaniga tashlaysiz (`Qo‘shiq.mp3` + `Qo‘shiq.txt`), har biri alohida loyiha bo‘ladi.
- 🔎 **Lavha topish** — to‘liq jang videosidan harakat va tomoshabin shovqini eng keskin bo‘lgan lahzalarni topadi; bir bosishda ulardan video yaratiladi.
- 📱 **Telegram bot** — video tayyor bo‘lsa telefoningizga prevyu keladi: **Tasdiqlash**, **Qayta montaj**, **Videolarni yuborish**, **TikTok/Reels matni** tugmalari bilan. `/status` va `/next` buyruqlari bor.
- 📈 **Chuqur statistika** — tomosha foizi, o‘rtacha davomiylik, obunachi o‘sishi va **retention grafigi** (tomoshabin qayerda chiqib ketgani).
- 🩺 **Kanal tashxisi** — “nega videolar uchmadi”: har bir video kanalning o‘z o‘rtachasi bilan solishtiriladi (🚀 uchgan / 📉 uchmagan) va sabablar dalil bilan ko‘rsatiladi:
  Content ID bloklari, “bolalar uchun” belgisi, o‘chirilgan izohlar, gorizontal qisqa video, uzun/hashtagli sarlavha, sarlavha tili, bo‘sh tavsif,
  past layk ulushi, past tomosha foizi (kanal ulangan bo‘lsa), yuklashlardagi tanaffuslar, kanal tavsifi va boshqalar — har biri tuzatish yo‘li bilan.
  **AI xulosa** kanal nega o‘smayotganini ustuvorlik bo‘yicha tushuntirib, 2 haftalik reja beradi; **“Nega uchmadi?”** tugmasi bitta videoni
  prevyu rasmi, retention va trafik manbalari bilan tahlil qilib, yaxshiroq sarlavhalar taklif qiladi — sarlavhani bir tugma bilan YouTube’da almashtirish mumkin.
  Telegram’da `/tashxis` buyrug‘i qisqa xulosa yuboradi.
- 🕵️ **Raqobatchilar** — istalgan kanalni havola yoki @handle bilan qo‘shasiz (masalan, `@PeleExplainss`). Dastur 200 tagacha videosini oladi va hisoblaydi:
  o‘rtacha ko‘rish, **outlier**lar (o‘rtachadan necha marta ko‘p ko‘rilgan), sarlavha odatlari (raqam, “you/your”, savol, KATTA so‘z), ko‘p takrorlanadigan boshlanishlar,
  eng yaxshi davomiylik, chiqarish tezligi va kuni. **AI tahlil** eng zo‘r videolarning prevyularini ham ko‘rib, kanal formulasini, sarlavha qoliplarini va
  siz egallashingiz mumkin bo‘lgan bo‘sh mavzularni topadi. Raqobatchilar har kuni o‘zi yangilanadi, yangi video chiqsa Telegram xabar beradi.
- 💡 **G‘oyalar va ssenariy** — raqobatchilar formulasidan mavjud yoki **rejalashtirilgan** kanalingiz uchun g‘oyalar (sarlavha, hook, prevyu, potentsial bahosi)
  va bir bosishda to‘liq ssenariy: tushuntiruvchi kanal uchun sahna-sahna matn + rasm tavsifi, jang kanali uchun diktor matni + kerakli lavha,
  musiqa kanali uchun Suno uslubi + to‘liq qo‘shiq matni. Ssenariyni nusxalash yoki `.txt` qilib yuklab olish mumkin.
- 🔥 **Trendlar** — sohangizda oxirgi 7 kunda eng tez o‘sayotgan videolar va AI g‘oyalari.
- 💬 **Izohlar** — javobsiz izohlarga AI qoralama yozadi, siz tekshirib joylaysiz.
- 🎵 **TikTok / Instagram Reels** — Shorts’ni yuklab olib qo‘lda joylash uchun tayyor matn. To‘g‘ridan-to‘g‘ri joylash bu platformalarning alohida ruxsati (TikTok audit, Instagram Business + Facebook ilova) bilan mumkin, shuning uchun hozircha qo‘lda.
- ☁️ **Bulutda ishlash** — Docker bilan VPS serverga qo‘yish mumkin, kompyuteringiz o‘chiq bo‘lsa ham videolar chiqaveradi.

---

## Eng oson yo‘l (Windows)

1. Dasturni yuklab oling: [github.com/Farruh2004/youtube-machine](https://github.com/Farruh2004/youtube-machine) sahifasida **Code → Download ZIP**, so‘ng ZIP’ni chiqaring (Extract All), masalan `D:\youtube` papkasiga.
2. **`ishga-tushirish.bat`** faylini ikki marta bosing.
3. Brauzerda ochilgan dasturda: **Sozlamalar → ➕ Yangi kanal**, keyin **🔑 API kalitlar** — kamida bitta matn AI kaliti (Claude, OpenAI yoki Gemini).

Birinchi marta fayl Node.js va ffmpeg’ni o‘zi o‘rnatadi. Agar “qayta bosing” deb chiqsa, oynani yopib, faylni yana bir marta bosing.
Keyin dastur ishga tushadi va brauzer o‘zi ochiladi. Qora oynani yopmang: yopilsa, dastur to‘xtaydi.

### Yangilash (Windows)

**`yangilash.bat`** ni bosing — u eng so‘nggi versiyani yuklab, shu papkaga ko‘chiradi. Yangilashdan oldin dasturning qora oynasini yoping.
`data` papkasi (sozlamalar, kalitlar, videolar) tegilmay qoladi. Manba `update-source.txt` faylida yozilgan; ochiq repozitoriydan
token kerak emas. Yopiq repozitoriy bo‘lsa, bir marta **GitHub token** so‘raladi (🔑 API kalitlar → GitHub).

## Qo‘lda o‘rnatish (Windows / macOS / Linux)

1. **Node.js 20+** o‘rnating: https://nodejs.org (LTS versiyasi).
2. **ffmpeg** o‘rnating:
   - Windows: `winget install Gyan.FFmpeg` (so‘ng terminalni qayta oching)
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`
3. Papkaga kirib dasturni ishga tushiring:
   ```bash
   cd youtube-machine
   npm start
   ```
4. Brauzerda oching: **http://127.0.0.1:4300**

`npm install` shart emas, chunki dastur tashqi kutubxonalarsiz yozilgan.
Tekshiruv uchun `npm test` ni ishga tushiring: u ikkala kanal bo‘yicha sinov videolarini montaj qilib, natijani tekshiradi.

Boshqa port kerak bo‘lsa: `PORT=5000 npm start`. ffmpeg PATH’da bo‘lmasa, `FFMPEG_PATH` va `FFPROBE_PATH` o‘zgaruvchilarida yo‘lini ko‘rsating.

---

## Sozlash (bir marta)

Dastur kalitlarsiz ham ishlaydi: montaj bajariladi, matn esa shablondan yoki siz yozgan eslatmalardan olinadi.
To‘liq avtomatik ishlashi uchun chap menyudagi **🔑 API kalitlar** sahifasini oching. U yerda har bir xizmatning kartochkasi bor:
kalit qayerdan olinishi bo‘yicha qadamlar, kalit maydoni va **“Saqlash va tekshirish”** tugmasi — kalit ishlayotgani darhol ko‘rinadi
(✓ Ishlayapti / ✕ Xato). Claude modelini ham shu yerda tanlaysiz (Haiku — arzon, Sonnet 5.5 — sifatliroq, Opus 5.5 — eng kuchli).

### 1. AI kalitlari
| Kalit | Nima uchun | Qayerdan |
|---|---|---|
| **Anthropic** (yoki OpenAI) | Ssenariy, SEO, analiz tavsiyalari | console.anthropic.com → API Keys |
| **OpenAI** | Diktor ovozi (TTS), qo‘shiq matnini vokalga moslab vaqtlash (Whisper) | platform.openai.com → API keys |
| **Google Gemini** (ixtiyoriy) | Matn uchun Claude/OpenAI o‘rniga (bepul limiti bor) | aistudio.google.com/apikey |
| **ElevenLabs** (ixtiyoriy) | O‘z ovozingiz kloni bilan diktor | elevenlabs.io → Voices → Instant Voice Clone → Voice ID; Profile → API key |
| **GitHub token** | `yangilash.bat` uchun (yopiq repozitoriy) | github.com/settings/personal-access-tokens/new |

API kalitlar sahifasining pastida **“Boshqa API kalitlar”** bo‘limi bor: Suno, Kling, Runway, Pexels va boshqa xizmatlarning kalitlarini
bir joyda saqlab qo‘yish mumkin. Dastur ulardan hozircha foydalanmaydi — kerakli xizmat integratsiyasi alohida qo‘shiladi.

### Telegram bot (ixtiyoriy, tavsiya etiladi)
1. Telegram’da **@BotFather** → `/newbot` → token’ni nusxalang.
2. Sozlamalar → Telegram bot → token’ni kiriting va saqlang.
3. O‘z botingizga `/start` yozing — bot sizga bog‘lanadi (faqat siz boshqara olasiz).

### 2. YouTube’ni ulash
1. https://console.cloud.google.com da yangi loyiha yarating.
2. **APIs & Services → Library** bo‘limida **YouTube Data API v3** ni yoqing.
3. **OAuth consent screen** sahifasida turini *External* qiling va o‘z emailingizni *Test users* ro‘yxatiga qo‘shing.
4. **Credentials → Create credentials → OAuth client ID** sahifasida turini **Desktop app** qiling. Client ID va Client Secret’ni Sozlamalarga kiriting.
5. **APIs & Services → Library** da **YouTube Analytics API** ni ham yoqing (chuqur statistika uchun).
6. Sozlamalar → Kanallar bo‘limida har bir kanal uchun **“YouTube’ga ulash”** tugmasini bosing va Google’da aynan shu kanalni (brand account) tanlang.

> Avval ulangan kanal bo‘lsa, yangi imkoniyatlar (statistika, izohlar) uchun **“Qayta ulash”** ni bosing — Google yangi ruxsatlarni so‘raydi.

> ⚠️ **Muhim cheklovlar (Google tomonidan):**
> - OAuth ilovasi *Testing* holatida bo‘lsa, ruxsat **7 kunda** tugaydi va kanalni qayta ulash kerak bo‘ladi. Buning oldini olish uchun consent screen’da **“Publish app”** tugmasini bosing. Shaxsiy foydalanishda “tasdiqlanmagan ilova” ogohlantirishi chiqadi — *Advanced → Continue* orqali o‘tasiz.
> - Tekshiruvdan (audit) o‘tmagan API loyihalari orqali yuklangan videolar **faqat yopiq (private)** bo‘lib qoladi. Cheklovni olib tashlash uchun YouTube API audit arizasini topshirish kerak. Ungacha dastur videoni yuklaydi, siz esa YouTube Studio’da ko‘rinishini qo‘lda o‘zgartirasiz yoki “Yuklab olish” tugmasi bilan o‘zingiz joylaysiz.
> - YouTube API’ning kunlik kvotasi cheklangan va video yuklash eng ko‘p kvota oladigan amal. Ikki kanalga kuniga bittadan video sig‘adi.
> - Maxsus prevyu o‘rnatish uchun kanal telefon raqami orqali tasdiqlangan bo‘lishi kerak.

---

## Ish jarayoni

1. **Yangi video** sahifasida kanalni tanlang va materialni yuklang.
2. Dastur bosqichlarni ketma-ket bajaradi. Jarayonni jonli kuzatish mumkin, bir vaqtda bitta loyiha montaj qilinadi.
3. Holat **“Ko‘rib chiqish kerak”** bo‘lganda videoni ko‘ring va kerak bo‘lsa tahrirlang:
   - Musiqa: qo‘shiq matni vaqtlari (LRC formatida), Shorts boshlanish soniyasi, prevyu yozuvi
   - Jang tahlili: hook, diktor matni (so‘z soni va taxminiy davomiylik ko‘rinadi), format
   - Har bir video uchun: sarlavha, tavsif, teglar, ko‘rinish, chiqish vaqti, AI belgisi
4. **“Tasdiqlash va jadvalga qo‘yish”** bosilganda video keyingi bo‘sh slotga yoziladi va vaqti kelganda o‘zi yuklanadi.
   Kutmaslik uchun **“Hozir YouTube’ga yuklash”** tugmasi ham bor.

Dastur yopiq bo‘lsa, yuklash ham bo‘lmaydi. Kompyuter yoqilib, dastur qayta ishga tushirilganda kechikkan yuklashlar avtomatik davom etadi.

---

## Personajli tushuntiruvchi kanal (Pele Explains uslubi)

Siz **personaj rasmi** va **g‘oya** berasiz — qolganini dastur qiladi:

1. **Sozlamalar → ➕ Yangi kanal** → turi “Tushuntiruvchi” → personaj rasmini yuklang (PNG, oq yoki shaffof fon).
   Raqobatchilar sahifasidagi rejadagi kanalni **🚀 Ishga tushirish** tugmasi bilan ham yaratish mumkin.
2. **Yangi video** → kanalni tanlang → bir jumlalik g‘oya yozing (masalan, *What happens if you stop sleeping?*) → Uzun video yoki Shorts.
   Yoki **G‘oyalar** sahifasida tayyor g‘oyadagi **🎬 Videoga aylantirish** tugmasini bosing.
3. Dastur o‘zi: personajni o‘rganadi → ssenariyni sahnalarga bo‘lib yozadi → har sahna uchun personajli rasm chizadi (OpenAI gpt-image yoki Gemini) → ovoz beradi → prevyu yasaydi → yengil kamera harakati bilan montaj qiladi.
4. Loyiha sahifasida sahnalarni tahrirlang: matn o‘zgarsa faqat shu sahna ovozi, rasm tavsifi o‘zgarsa faqat shu rasm qayta yaratiladi (qolgani keshdan, bepul).
5. Tasdiqlang — jadval bo‘yicha YouTube’ga chiqadi.

**Tayyor materiallar bilan (ChatGPT rasmlari + Google AI Studio ovozi).** Rasmlarni va ovozni o‘zingiz yasasangiz:
Yangi video → “📁 Tayyor materiallarim bor” → rasmlarni (1.png, 2.png… nomi bo‘yicha tartiblanadi) va ovozni (bitta umumiy yoki har sahnaga bittadan) tashlang, “O‘z ssenariyingiz”ga matnni har sahnani yangi qatordan yozing.
Dastur ularni yig‘adi: har sahna tepasida rangli yorliq, pastda qora fonli subtitr (kalit so‘z sariq), sahna almashganda ovoz effektlari, fon musiqasi (ovoz paytida pasayadi). Personaj rasmi shart emas.
Loyiha sahifasida istalgan sahnaga 🖼/🎤 bilan alohida rasm yoki ovoz qo‘yish, “📋 promptlarni nusxalash” bilan esa barcha rasm/ovoz promptlarini ChatGPT yoki AI Studio’ga olib o‘tish mumkin.

**Ovoz:** API kalitlar → “Diktor ovozi” → *Google AI Studio (Gemini)* — AI Studio’dagi ovozlar (Puck, Kore, Charon…) ohang ko‘rsatmasi bilan, ~$0.015/daqiqa. Kanal sozlamasidagi “Diktor ohangi” va har sahnadagi ohang hisobga olinadi.
**Effektlar:** 7 ta oddiy effekt (whoosh, pop, ding, click, thud, rise, boing) bepul ichida bor; Sozlamalar → “Ovoz effektlari kutubxonasi”ga o‘zingiznikini yuklang (fayl nomi bo‘yicha topiladi). ElevenLabs kaliti bo‘lsa, yo‘q effektni AI yaratadi (~$0.02).
**Musiqa:** Sozlamalar → kanal → “🎵 Fon musiqalari”ga bir nechta trek yuklang — har videoga bittasi tanlanadi.
**Subtitr vaqti:** OpenAI kaliti bo‘lsa, so‘zlar ovozga aniq moslanadi (Whisper, ~$0.006/daqiqa); bo‘lmasa — taxminan.

Narx (bitta video): 4 daqiqalik ≈ 35 sahna — OpenAI o‘rta sifat ~$2.2, Gemini ~$1.4, OpenAI past sifat ~$0.6; Shorts ≈ 8 sahna — $0.15–0.5. Rasm xizmati va sifati **API kalitlar** sahifasida tanlanadi. Rasm kaliti bo‘lmasa, sahnalarda personajning o‘zi ishlatiladi (bepul, lekin oddiyroq).

## Telefon yoki boshqa kompyuterdan foydalanish

Dastur bitta asosiy kompyuterda ishlaydi (montaj o‘sha yerda bo‘ladi), siz esa unga telefondan yoki boshqa kompyuterdan kirasiz.

**Uyda (bir Wi‑Fi’da):**
1. Asosiy kompyuterda `ishga-tushirish.bat` o‘rniga **`telefon-rejimi.bat`** ni bosing.
2. Birinchi marta parol so‘raydi (kamida 8 ta harf/raqam). Windows ruxsat so‘rasa — “Private” tarmoqqa ruxsat bering.
3. Qora oynada `http://192.168.x.x:4300` manzili chiqadi — uni telefon brauzerida oching. Login — istalgan so‘z, parol — siz bergan parol.
4. Telefonda: Chrome → ⋮ → **“Bosh ekranga qo‘shish”** (iPhone: Safari → Ulashish → **“Add to Home Screen”**) — dastur ilova kabi belgi bilan chiqadi.

**Uydan tashqarida (istalgan joydan) — `hamma-joydan.bat`:** asosiy kompyuterda shuni bosing. U bepul **Tailscale** shaxsiy tarmog‘ini o‘zi o‘rnatadi va sozlaydi: dastur ochiq internetga chiqmaydi, uni faqat sizning qurilmalaringiz ko‘radi, API kalitlar shu kompyuterdagi `data` papkasida qoladi. 4300-port faqat Tailscale tarmog‘i uchun ochiladi.
Telefonga **Tailscale** ilovasini o‘rnatib, shu Google akkauntga kiring va oynada chiqqan `http://100.x.x.x:4300` manzilini oching (Telegram bot ham shu manzilni yuboradi). Manzil doimiy — “Bosh ekranga qo‘shish” qiling. Birinchi marta “kompyuter yoqilganda o‘zi ishga tushsinmi” va “uxlab qolmasinmi” deb so‘raydi; avtostartni `avtostart-ochirish.bat` o‘chiradi.

**Faqat tasdiqlash va xabarlar uchun** — Telegram bot yetarli (API kalitlar → Telegram).

Eslatmalar: YouTube’ga ulash tugmasini faqat asosiy kompyuterning o‘zida bosing. Dasturni ikkinchi kompyuterga to‘liq ko‘chirmoqchi bo‘lsangiz — papkani nusxalang (`data` papkasi bilan birga), lekin ikkalasini bir vaqtda ishlatmang, aks holda videolar ikki marta yuklanadi.

## Bulutda ishlatish (ixtiyoriy)

Kompyuter o‘chiq bo‘lsa ham videolar chiqishi uchun dasturni oyiga ~$5–6 turadigan Linux VPS’ga qo‘yish mumkin (2 GB RAM va undan ko‘p tavsiya etiladi; montaj protsessorga og‘ir).

```bash
# Serverda (Docker o‘rnatilgan bo‘lsin)
git clone <repo> && cd <repo>/youtube-machine
docker compose up -d
```

**Kirish — SSH tunnel orqali (eng xavfsiz):** o‘z kompyuteringizda
`ssh -L 4300:127.0.0.1:4300 user@SERVER_IP` ni ishga tushirib, brauzerda **http://127.0.0.1:4300** ni oching.
YouTube’ni ulash ham shu yo‘l bilan ishlaydi. Telefondan boshqarish uchun Telegram bot yetarli.

**Parol bilan ochiq kirish:** `docker-compose.yml` da `APP_PASSWORD` ni to‘ldiring va portni `"4300:4300"` qiling.
Bunda HTTPS uchun Caddy yoki Cloudflare Tunnel qo‘yish tavsiya etiladi. Parolsiz rejimda dastur faqat `127.0.0.1` dan so‘rov qabul qiladi.

---

## Xarajat taxmini (oyiga 60 ta video)

| Xizmat | Bir videoga (taxminan) | Oyiga |
|---|---|---|
| SEO / ssenariy (Claude Haiku) | ~ $0.01 | ~ $0.6 |
| Diktor ovozi (jang tahlili, ~1 daqiqa, OpenAI) | ~ $0.015 | ~ $0.5 |
| — yoki ElevenLabs (o‘z ovozingiz) | ~ $0.2 | ~ $6 |
| Tarjima qatori, izoh javoblari, trend tahlili | ~ $0.01 | ~ $1 |
| Qo‘shiq matnini vaqtlash (Whisper, ~3 daqiqa) | ~ $0.02 | ~ $0.3 |
| Montaj (o‘z kompyuteringizda) | $0 | $0 |
| Suno obunasi | — | $10 (Pro) / $30 (Premier) |

Bu hisob Sozlamalardagi taxminiy narxlarga asoslangan. Xizmat narxlari o‘zgarib turadi, shuning uchun aniq summani ularning hisob-kitob sahifasida tekshiring.
Dastur har bir chaqiruvni **Xarajatlar** sahifasida ko‘rsatadi.

---

## Huquqiy eslatmalar

- **Suno:** pullik tarifda yaratilgan qo‘shiqlarni monetizatsiya qilish mumkin. Obuna shartlarini o‘zingiz tekshiring.
- **Jang lavhalari:** lavhani kesib olishning o‘zi undan foydalanish huquqini bermaydi. Original tahlil qo‘shish YouTube monetizatsiyasida yordam beradi, lekin manba egasi Content ID orqali da’vo qilishi mumkin.
- **AI belgisi:** haqiqiydek ko‘rinadigan AI kontenti uchun “altered or synthetic content” belgisi qo‘yiladi (`containsSyntheticMedia`). Har bir video uchun alohida yoqiladi yoki o‘chiriladi.

---

## Tuzilishi

```
youtube-machine/
├── server.js              # HTTP server (faqat 127.0.0.1)
├── public/                # Boshqaruv oynasi (HTML/CSS/JS)
├── src/
│   ├── store.js           # data/db.json — sozlamalar, kanallar, loyihalar, xarajatlar
│   ├── pipeline.js        # Ishlab chiqarish navbati
│   ├── scheduler.js       # Jadval va avtomatik yuklash
│   ├── youtube.js         # OAuth, yuklash, prevyu, statistika
│   ├── costs.js           # Xarajat hisobi va byudjet chegarasi
│   ├── routes.js          # API (+ parol rejimi)
│   ├── highlights.js      # To‘liq jangdan lavha topish
│   ├── diagnose.js        # Kanal tashxisi (qoidalar + AI)
│   ├── competitors.js     # Raqobatchilar, g‘oyalar, ssenariylar
│   ├── keys.js            # API kalitlarini tekshirish
│   ├── telegram.js        # Telegram bot
│   ├── events.js          # Ichki hodisalar
│   ├── ai/                # Matn (Claude/OpenAI), ovoz (TTS), Whisper, ko‘rsatmalar
│   ├── media/             # ffmpeg, ASS subtitrlar/karaoke, qo‘shiq matni vaqtlari, harakat tahlili
│   └── workflows/         # music.js (musiqa), fight.js (jang tahlili), explainer.js (tushuntiruvchi)
├── test/smoke.js          # To‘liq montaj testi (ikkala kanal, lavha topish, Telegram)
├── Dockerfile, docker-compose.yml
└── data/                  # Ish ma’lumotlari (git’ga kirmaydi)
```

## Keyingi qadamlar

- Suno API’sini ulash, shunda qo‘shiq ham avtomatik yaratiladi (kirish ochiq bo‘lsa)
- AI video xizmati (Kling, Veo) API’si orqali fon videosini avtomatik yaratish — hozircha fon videosini o‘zingiz yuklaysiz
- TikTok va Instagram’ga to‘g‘ridan-to‘g‘ri joylash (platformalar ruxsati olingach)
- Bir xil kontentning ikkita sarlavha yoki prevyu variantini sinash (A/B test)

## Sayt sifatida (ko‘p foydalanuvchi)

Dasturni o‘z serveringizda sayt qilib ochish mumkin: odamlar ro‘yxatdan o‘tadi, har biri o‘z kanallari va o‘z kalitlari bilan ishlaydi
(har foydalanuvchiga alohida nusxa, ma’lumotlar bir-biridan ajratilgan). O‘rnatish — [`docs/SAYT-ORNATISH.md`](docs/SAYT-ORNATISH.md),
keyingi bosqichlar rejasi — [`docs/SAYT-REJASI.md`](docs/SAYT-REJASI.md). Mahalliy sinov: `npm run site` → http://127.0.0.1:8080

## Litsenziya

[MIT](LICENSE) — bepul ishlatish, o‘zgartirish va tarqatish mumkin; muallif ko‘rsatilishi shart.
