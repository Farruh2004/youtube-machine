# Saytni ishga tushirish (ko‘p foydalanuvchili rejim)

Natija: `https://studio.sizningdomen.uz` — odamlar ro‘yxatdan o‘tib, har biri o‘z kanallari va o‘z kalitlari bilan ishlaydi.
Har foydalanuvchiga dasturning alohida nusxasi ochiladi: kalitlar, kanallar va videolar boshqalarga ko‘rinmaydi.

```
Brauzer ──HTTPS──▶ Caddy (avtomatik SSL) ──▶ gateway (kirish, sessiya) ──▶ foydalanuvchining o‘z nusxasi
                                                                          (data-site/users/<id>/)
```

## 1. Kerakli narsalar

| Nima | Qayerdan | Taxminiy narx |
|---|---|---|
| VPS server: 4 vCPU, 8 GB RAM, 80+ GB disk, Ubuntu 22.04/24.04 | Hetzner, DigitalOcean, Contabo va h.k. | oyiga ~$10–40 |
| Domen (yoki subdomen) | istalgan registrator | yiliga ~$10–15 |

Narxlar o‘zgarib turadi — provayder sahifasini tekshiring. Video montaj protsessorni ko‘p ishlatadi: foydalanuvchi ko‘paysa, kuchliroq server oling.

## 2. Domen

Domen boshqaruv panelida **A yozuvi** qo‘shing: `studio` (yoki `@`) → serverning IP manzili. 5–30 daqiqada kuchga kiradi.

## 3. Serverga o‘rnatish (bir marta, ~10 daqiqa)

Serverga SSH orqali kiring va quyidagilarni ketma-ket bajaring:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Dastur
git clone https://github.com/Farruh2004/youtube-machine.git
cd youtube-machine

# Sozlamalar
cp .env.example .env
nano .env          # DOMAIN, ADMIN_EMAIL, INVITE_CODE ni yozing, Ctrl+O, Enter, Ctrl+X

# Ishga tushirish
docker compose -f docker-compose.site.yml up -d --build
```

Bir-ikki daqiqadan keyin `https://DOMENINGIZ` ni oching → **Ro‘yxatdan o‘tish** → `ADMIN_EMAIL` dagi email bilan ro‘yxatdan o‘ting (taklif kodi — `.env` dagi `INVITE_CODE`).
Siz admin bo‘lasiz: chap menyu pastida **Admin** havolasi chiqadi.

## 4. Foydalanuvchilarni qo‘shish

- Do‘stlaringizga sayt manzili va **taklif kodini** bering — ular o‘zlari ro‘yxatdan o‘tadi.
- Hamma uchun ochish: `.env` da `INVITE_CODE=` ni bo‘sh qoldiring. Ro‘yxatni yopish: `ALLOW_SIGNUP=0`.
- **Admin** sahifasida har foydalanuvchini o‘chirish/yoqish va dasturini qayta ishga tushirish mumkin.
- O‘zgartirishdan keyin: `docker compose -f docker-compose.site.yml up -d`

## 5. Har bir foydalanuvchi o‘zi qiladigan sozlash

Dastur ichidagi yo‘riqnoma bo‘yicha (🔑 API kalitlar):
1. AI kalitlari — Claude / OpenAI / Gemini (har kim o‘zinikini kiritadi, o‘zi to‘laydi).
2. **YouTube’ga ulash** — Google kartasidagi “Oson sozlash”. Saytda kalit turi **Web application** bo‘ladi va
   **Authorized redirect URIs** ga `https://DOMENINGIZ/oauth/callback` qo‘shiladi (dastur bu manzilni o‘zi ko‘rsatadi).

Keyinchalik (foydalanuvchilar ko‘paysa) bitta umumiy Google ilovasini Google tekshiruvidan o‘tkazish mumkin — `docs/SAYT-REJASI.md`, 4-bo‘lim.

## 6. Kundalik ishlar

| Ish | Buyruq |
|---|---|
| Yangilash | `git pull && docker compose -f docker-compose.site.yml up -d --build` |
| Jurnal (xatolarni ko‘rish) | `docker compose -f docker-compose.site.yml logs -f gateway` |
| Bitta foydalanuvchi jurnali | `tail -f data-site/users/<id>/app.log` |
| Zaxira nusxa | `tar czf zaxira-$(date +%F).tgz data-site` (videolarsiz: `--exclude='*/projects'`) |
| To‘xtatish | `docker compose -f docker-compose.site.yml down` |

`data-site/` papkasida hamma narsa bor: foydalanuvchilar, sessiyalar (`gateway.json`), har foydalanuvchining kalitlari va videolari.
Shu papkani muntazam zaxiralang va hech kimga bermang.

## 7. Xavfsizlik — qanday himoyalangan

- Parollar ochiq saqlanmaydi (scrypt), sessiya cookie’si `HttpOnly`, `Secure`, `SameSite=Lax`.
- Kirish urinishlari cheklangan (bitta manzildan 15 daqiqada 10 ta).
- Har foydalanuvchining dasturi faqat serverning ichida (`127.0.0.1`) ishlaydi va faqat gateway’ning maxfiy belgisi bilan kelgan so‘rovni qabul qiladi —
  boshqa foydalanuvchi uning ma’lumotiga yeta olmaydi.
- Boshqa saytlardan yuborilgan so‘rovlar rad etiladi; HTTPS’ni Caddy avtomatik yangilaydi.

Hozirgi cheklov: barcha nusxalar bitta server foydalanuvchisi ostida ishlaydi (bir-biridan dastur darajasida ajratilgan).
Begona odamlarga keng ochishdan oldin har nusxani alohida Docker konteynerga ko‘chirish tavsiya etiladi (`docs/SAYT-REJASI.md`, 2–3-bo‘limlar).
