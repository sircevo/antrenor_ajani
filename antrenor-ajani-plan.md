# Kişisel antrenör ajanı — detaylı proje planı

## 1. Genel mimari (özet)

- **Bulut (Railway):** her zaman açık, Telegram ve Apple Watch webhook'larını karşılar, Postgres'e yazar.
- **Yerel ajan (localhost):** sen bilgisayarı açtığında çalışır, kuyruğu okur, Claude API ile işler, Telegram'a cevabı doğrudan gönderir (bunun için ayrı bir "outbox" gerekmez — sadece gelen mesaj için kuyruk şart, giden mesaj için değil, çünkü giden mesajı zaten online olan ajan gönderiyor).
- **Dashboard:** aynı Postgres'i okuyan bir Next.js arayüzü. Başta localhost'ta, istersen ileride Railway'e de deploy edilebilir.

## 2. Teknoloji yığını

Senin DestecPlanner/Ramdevu'da kullandığın yığınla aynı kalıyoruz ki Antigravity/Claude Code arasında geçiş yaparken tutarlılık bozulmasın:

| Katman | Seçim |
|---|---|
| Backend/API | Next.js 14 (App Router) + TypeScript |
| ORM/DB | Prisma + PostgreSQL (Railway) |
| Telegram | `telegraf` (TS destekli) |
| AI | `@anthropic-ai/sdk` (Claude Sonnet 5) |
| Auth (dashboard) | NextAuth (tek kullanıcı olduğu için basit tutulabilir, hatta ilk aşamada atlanabilir) |
| Health verisi girişi | Health Auto Export (iOS uygulaması) → webhook |
| Bildirim/e-posta | Resend (isteğe bağlı, örn. haftalık özet maili) |

## 3. Veri modeli (Prisma taslağı)

```prisma
model InboxEvent {
  id          String   @id @default(cuid())
  source      String   // "telegram" | "health_auto_export"
  rawPayload  Json
  processed   Boolean  @default(false)
  createdAt   DateTime @default(now())
}

model ConversationLog {
  id          String   @id @default(cuid())
  role        String   // "user" | "assistant"
  content     String
  intent      String?  // "workout_request" | "calorie_log" | "chat" | ...
  createdAt   DateTime @default(now())
}

model WorkoutProgram {
  id          String   @id @default(cuid())
  date        DateTime
  exercises   Json     // [{name, sets, reps, notes}]
  feedback    String?  // "sevdim", "çok ağırdı" vb.
  createdAt   DateTime @default(now())
}

model CalorieEntry {
  id          String   @id @default(cuid())
  date        DateTime
  description String
  calories    Int
  macros      Json?    // {protein, carbs, fat}
  createdAt   DateTime @default(now())
}

model HealthMetric {
  id          String   @id @default(cuid())
  date        DateTime
  steps       Int?
  restingHR   Int?
  avgHR       Int?
  activeEnergy Float?
  raw         Json
}

model StyleProfile {
  id          String   @id @default(cuid())
  summary     Json     // konuşma tarzı, tercihler, kaçınılan hareketler
  updatedAt   DateTime @updatedAt
}
```

## 4. Bileşen akışları

### 4.1 Telegram akışı
1. `setWebhook` ile Telegram, Railway'deki `/api/telegram-webhook` adresine POST atar (secret token ile korunur).
2. Endpoint mesajı doğrudan `InboxEvent` tablosuna `processed=false` olarak yazar. Ağır iş yapmaz, sadece kaydeder — bu yüzden Railway tarafı çok hafif kalır.
3. Yerel ajan online olduğunda `processed=false` kayıtları çeker, sırayla işler, `processed=true` yapar.
4. Cevabı Telegram Bot API'ye (`sendMessage`) doğrudan yerel ajan gönderir — ekstra bir "outbox" katmanına gerek yok.

### 4.2 Apple Watch / Health Auto Export
1. iPhone'da Health Auto Export uygulaması kurulur, günlük adım/nabız/aktif enerji verisini otomatik olarak `/api/health-webhook` adresine POST edecek şekilde ayarlanır (kendi API key'i ile korunur).
2. Endpoint veriyi doğrudan `HealthMetric` tablosuna yazar (kuyruğa gerek yok, işlenmesi gereken bir "aksiyon" değil, düz veri).
3. Yerel ajan, antrenman/kalori önerisi üretirken son `HealthMetric` kayıtlarını context olarak Claude API'ye ekler (örn. "son 3 gün ortalama 4000 adım, bugün daha aktif bir program öner").

### 4.3 Agent çekirdeği
- Basit bir polling döngüsü (örn. her 15-30 saniyede bir `InboxEvent` kontrolü) ya da Postgres `LISTEN/NOTIFY` ile anlık tetikleme.
- Her mesaj için: `StyleProfile` + son `ConversationLog` + ilgili `HealthMetric`/`CalorieEntry` kayıtları → Claude API sistem promptuna enjekte edilir → yanıt üretilir → `ConversationLog`'a yazılır.
- İlk aşamada basit bir intent ayrımı yeterli: "bugün ne yapayım", "şunu yedim, kaç kalori", "programımı değiştir" gibi kalıpları prompt içinde Claude'a sınıflandırt.

### 4.4 Kişiselleştirme ("eğitim seti") sistemi
Gerçek fine-tuning yerine önerdiğim yol — çok daha ucuz, hızlı iterasyon:
1. Her konuşma ve geri bildirim (`feedback` alanları) ham veri olarak birikir.
2. Haftalık bir arka plan işi (basit bir script/cron) bu logları özetleyip `StyleProfile.summary` alanına yazar: konuşma tonu, tercih edilen egzersiz türleri, kaçınılan hareketler, hedefler.
3. Her Claude API çağrısında bu profil sistem promptuna eklenir. Zamanla ajan gerçekten "seni tanıyan" biri gibi davranır.
4. İleride hacim büyürse gerçek fine-tuning (OpenAI/açık kaynak model) bir sonraki aşama olarak değerlendirilebilir — ama tek kullanıcı için muhtemelen hiç gerekmez.

### 4.5 Dashboard
- Günlük özet: bugünkü program, kalori girişleri, adım/nabız.
- Program geçmişi ve geri bildirim ekleme.
- Basit grafikler (haftalık kalori, adım trendi) — `recharts` uygun.

## 5. Ortam değişkenleri / servisler

- `DATABASE_URL` (Railway Postgres)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- `HEALTH_EXPORT_API_KEY` (kendi belirleyeceğin, Health Auto Export ayarına gireceğin key)
- `ANTHROPIC_API_KEY`
- (opsiyonel) `RESEND_API_KEY`

## 6. Önerilen geliştirme sırası

1. **Sprint 0 — kurulum:** Telegram bot oluştur (@BotFather), Railway projesi + Postgres, Prisma init, Claude API key.
2. **Sprint 1 — kuyruk:** `InboxEvent` modeli, `/api/telegram-webhook` ve `/api/health-webhook` endpoint'leri, webhook kaydı.
3. **Sprint 2 — agent çekirdeği:** yerel polling döngüsü, Claude API ile basit sohbet, Telegram'a cevap gönderme.
4. **Sprint 3 — antrenman & kalori:** `WorkoutProgram`, `CalorieEntry` modelleri, agent'ın bunları okuma/yazma mantığı.
5. **Sprint 4 — kişiselleştirme:** `StyleProfile`, haftalık özetleme job'u.
6. **Sprint 5 — Apple Watch:** `HealthMetric`, Health Auto Export kurulumu, agent'ın sağlık verisini context'e katması.
7. **Sprint 6 — dashboard:** Next.js sayfaları, grafikler.

## 7. Sonraki adım

Bu plandaki herhangi bir sprint'i seçip doğrudan kodlamaya geçebiliriz — örneğin Sprint 0-1'i birlikte kurabiliriz (Telegram bot + Railway + Prisma şeması).
