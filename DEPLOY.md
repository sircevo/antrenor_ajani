# Yayına alma (Railway) — Antrenör Ajanı

Uygulama artık tek bir web servisidir. Telegram tarafı emekliye ayrıldı
(`src/agent/poll.ts`, `telegram.ts` ve webhook route'u referans olarak repoda
duruyor ama çalışmıyor).

| Servis | Ne yapar | Başlatma komutu |
|---|---|---|
| **web** | Tüm uygulama: giriş, sohbet, takvim, panel | `npm run start` |
| **summarize** (Cron Job, opsiyonel) | Haftalık olarak geçmişi özetleyip `StyleProfile`'ı günceller | `npm run agent:summarize` |

> 🔒 Uygulama tek şifreyle korunuyor (`APP_PASSWORD`). Giriş yaptıktan sonra
> çerez 60 gün geçerli — telefonda her açtığında şifre sormaz.

---

## 0. Önce: repoyu gizli yap

`SKILL.md` kişisel sağlık bilgin içeriyor ve repoda tutulmak zorunda (ajan onu
okuyor). Repo **private** olmalı:
GitHub → repo **Settings** → **Danger Zone** → **Change visibility** → **Private**.

---

## 1. Railway projesi + PostgreSQL

1. Railway'de proje aç (veya mevcut projeyi kullan).
2. **New → Database → PostgreSQL** ekle. Railway otomatik `DATABASE_URL` üretir.

## 2. "web" servisi (webhook + dashboard)

1. **New → GitHub Repo → `antrenor_ajani`** seç.
2. Bu servisin adını **web** yap.
3. **Settings → Networking → Generate Domain** ile herkese açık bir URL al
   (örn. `https://web-production-xxxx.up.railway.app`). Bu URL'yi not et —
   hem Telegram webhook'u hem de dashboard (`/`) bu URL üzerinden çalışır.
4. **Variables** sekmesine şunları ekle (aşağıdaki listeye bak).
5. Build/Start komutları otomatik algılanır:
   - Build: `npm run build`
   - Start: `npm run start` (bu, veritabanı tablolarını da otomatik kurar)

## 3. "agent" servisi (cevap üreten kısım)

1. Aynı projede **New → GitHub Repo → `antrenor_ajani`** (aynı repo) tekrar seç.
2. Adını **agent** yap.
3. **Settings → Deploy → Custom Start Command**: `npm run agent:poll`
4. Bu servise **public domain VERME** (arka planda çalışır, dışarı açık olmasına gerek yok).
5. **Variables**: web ile aynı değişkenleri ekle.

## 3b. "summarize" servisi (haftalık kişiselleştirme, opsiyonel)

Konuşma/antrenman geçmişini haftalık özetleyip `StyleProfile`'ı güncelleyen,
çalışıp kapanan bir iş. Railway'de bunun için ayrı bir **Cron Job** servis
tipi var (sürekli açık kalmaz, sadece zamanlanmış saatte çalışır):

1. Aynı projede **New → Cron Job** (veya "New → GitHub Repo" seçip
   Settings'ten servis tipini Cron Job'a çevir).
2. Repo: `antrenor_ajani`. **Start Command**: `npm run agent:summarize`.
3. **Schedule**: örn. `0 6 * * 1` (her Pazartesi 06:00 UTC).
4. **Variables**: `DATABASE_URL`, `KIMI_API_KEY`, `KIMI_MODEL` yeterli
   (Telegram değişkenlerine gerek yok). Public domain gerekmez.

## 4. Ortam değişkenleri (her iki servise de)

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | Postgres bağlantısı. Railway Postgres'ten `${{Postgres.DATABASE_URL}}` ile bağla. |
| `KIMI_API_KEY` | Moonshot (Kimi) API anahtarı. |
| `KIMI_MODEL` | `kimi-k2.6` |
| `APP_PASSWORD` | Uygulamaya girerken yazacağın şifre. |
| `AUTH_SECRET` | Oturum çerezini imzalayan rastgele anahtar. Üret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CONTEXT_MESSAGE_LIMIT` | `20` |

## 5. Telegram webhook'unu kaydet

`web` servisinin URL'sini ve secret'ı kullanarak (terminalden **bir kez**):

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<WEB_URL>/api/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

`<BOT_TOKEN>`, `<WEB_URL>` ve `<TELEGRAM_WEBHOOK_SECRET>` yerine kendi değerlerini yaz.
`{"ok":true,...}` dönerse kayıt tamam.

Kontrol: `https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo`

## 6. Test

Botuna Telegram'dan yaz. `agent` servisinin **Logs** ekranında
`Event ... replied & logged ✅` satırını görmeli ve Telegram'a cevap düşmeli.

---

### Sağlık kontrolü
`https://<WEB_URL>/api/telegram-webhook` adresini tarayıcıda açarsan
`{"status":"ok",...}` dönmeli (webhook ayakta demektir).
