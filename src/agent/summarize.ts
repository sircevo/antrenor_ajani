/**
 * Weekly personalization job — Sprint 4
 *
 * Reads the last 7 days of ConversationLog/WorkoutProgram/CalorieEntry, asks
 * Gemini for a compact JSON summary of tone preferences, liked/disliked
 * exercises, adherence notes, and the user's currently-stated goal, then
 * upserts it into the StyleProfile singleton row. src/agent/gemini.ts injects
 * this summary into every future coach reply.
 *
 * This is a one-shot script, meant to be run on a schedule (e.g. a Railway
 * Cron Job, weekly) — not a long-running process like poll.ts.
 *
 * Usage:
 *   npx tsx src/agent/summarize.ts        (or: npm run agent:summarize)
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEFAULT_MODEL = "gemini-flash-latest";
const LOOKBACK_DAYS = 7;

const SUMMARY_PROMPT = `
Aşağıda bir hipertrofi antrenör ajanının son ${LOOKBACK_DAYS} günlük konuşma geçmişi,
kaydedilen antrenmanlar ve beslenme girişleri var. Bunlardan kullanıcı hakkında
gelecekteki konuşmalarda antrenörün hatırlaması gereken kısa, özlü bir profil çıkar:
- ton/iletişim tercihi (ör. daha kısa cevap seviyor, esprili dil vs.)
- sevdiği/sevmediği hareketler
- uyum/adherans notları (ör. genelde sabah antrenmanlarını atlıyor)
- kullanıcının şu anki hedefi hakkında son bahsettiği şey

Sadece verilen veriden çıkarım yap, veri yoksa ilgili alanı boş bırak. Uydurma bilgi ekleme.
`.trim();

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }
  return key;
}

async function gatherRecentData(sinceDate: Date) {
  const [conversations, workouts, calories] = await Promise.all([
    prisma.conversationLog.findMany({
      where: { createdAt: { gte: sinceDate } },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true, createdAt: true },
    }),
    prisma.workoutProgram.findMany({
      where: { createdAt: { gte: sinceDate } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.calorieEntry.findMany({
      where: { createdAt: { gte: sinceDate } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { conversations, workouts, calories };
}

async function main(): Promise<void> {
  console.log("🧠 StyleProfile haftalık özetleme başlıyor...");

  const sinceDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const data = await gatherRecentData(sinceDate);

  if (data.conversations.length === 0 && data.workouts.length === 0 && data.calories.length === 0) {
    console.log("Son 7 günde veri yok, özetleme atlanıyor.");
    await prisma.$disconnect();
    return;
  }

  const genAI = new GoogleGenerativeAI(getApiKey());
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          tone: { type: SchemaType.STRING },
          likedExercises: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          dislikedExercises: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          adherenceNotes: { type: SchemaType.STRING },
          currentGoalNotes: { type: SchemaType.STRING },
        },
        required: [],
      },
    },
  });

  const result = await model.generateContent(
    `${SUMMARY_PROMPT}\n\nVERİ:\n${JSON.stringify(data)}`
  );
  const summaryText = result.response.text().trim();

  let summary: unknown;
  try {
    summary = JSON.parse(summaryText);
  } catch {
    console.error("[summarize] Gemini geçerli JSON döndürmedi:", summaryText.slice(0, 200));
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.styleProfile.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", summary: summary as never },
    update: { summary: summary as never },
  });

  console.log("✅ StyleProfile güncellendi:", JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await prisma.$disconnect();
  process.exit(1);
});
