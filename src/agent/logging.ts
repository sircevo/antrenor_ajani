/**
 * Structured tracking (weight/calories/workouts) extracted from ordinary chat
 * via Gemini function calling. Gemini decides whether/what to log; this module
 * only executes the resulting Prisma writes and returns a small enriched
 * payload so the model's final reply can reference what was saved.
 */

import { SchemaType, type FunctionCall, type FunctionDeclaration } from "@google/generative-ai";
import type { PrismaClient, Prisma } from "@prisma/client";

export const LOG_WEIGHT = "log_weight";
export const LOG_CALORIE_ENTRY = "log_calorie_entry";
export const LOG_WORKOUT = "log_workout";

/**
 * Tool declarations passed to Gemini. Descriptions double as behavior
 * instructions (Gemini function-calling is steered by these strings):
 * only log things the user reports having already done, never a suggested/
 * future plan, and estimate calories when the user gives no exact number.
 */
export const loggingToolDeclarations: FunctionDeclaration[] = [
  {
    name: LOG_WEIGHT,
    description:
      "Kullanıcı güncel vücut ağırlığını bildirdiğinde (ör. 'bugün 82 kilo geldim') çağır. " +
      "Sadece kullanıcı somut bir kilo değeri verdiğinde kullan; tahmini bir hedef kilodan bahsediyorsa çağırma.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        weightKg: {
          type: SchemaType.NUMBER,
          description: "Kullanıcının bildirdiği kilo, kilogram cinsinden (ör. 82.4).",
        },
        note: {
          type: SchemaType.STRING,
          description: "Varsa kısa bağlam notu (ör. 'sabah aç karına').",
        },
      },
      required: ["weightKg"],
    },
  },
  {
    name: LOG_CALORIE_ENTRY,
    description:
      "Kullanıcı YEDİĞİ/İÇTİĞİ bir şeyi bildirdiğinde çağır (geçmiş zaman: 'yedim', 'içtim'). " +
      "Kullanıcı beslenme önerisi veya ne yemesi gerektiğini SORUYORSA çağırma. " +
      "Kullanıcı tam kalori vermediyse açıklamadan makul bir tahmin yap ve calories alanına o tahmini yaz " +
      "(cevabında bunun bir tahmin olduğunu belirt).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        description: {
          type: SchemaType.STRING,
          description: "Yenilen/içilenin kısa açıklaması (ör. '3 yumurta + yulaf ezmesi').",
        },
        calories: {
          type: SchemaType.INTEGER,
          description: "Toplam kalori (kcal). Kullanıcı vermediyse tahmini değer.",
        },
        protein: { type: SchemaType.NUMBER, description: "Gram protein (biliniyorsa/tahmin edilebiliyorsa)." },
        carbs: { type: SchemaType.NUMBER, description: "Gram karbonhidrat (biliniyorsa/tahmin edilebiliyorsa)." },
        fat: { type: SchemaType.NUMBER, description: "Gram yağ (biliniyorsa/tahmin edilebiliyorsa)." },
      },
      required: ["description", "calories"],
    },
  },
  {
    name: LOG_WORKOUT,
    description:
      "Kullanıcı YAPTIĞI bir antrenmanı bildirdiğinde çağır (geçmiş zaman: 'yaptım', 'bitirdim'). " +
      "Kullanıcı bir program/öneri İSTİYORSA çağırma — bu sadece geçmişte fiilen yapılan antrenmanı kaydetmek içindir.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        exercises: {
          type: SchemaType.ARRAY,
          description: "Yapılan hareketlerin listesi.",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              name: { type: SchemaType.STRING, description: "Hareket adı." },
              sets: { type: SchemaType.INTEGER, description: "Set sayısı." },
              reps: { type: SchemaType.STRING, description: "Tekrar (ör. '8-10' veya '12,10,8')." },
              notes: { type: SchemaType.STRING, description: "Kısa not (ağırlık, RIR, vb.)." },
            },
            required: ["name"],
          },
        },
        feedback: {
          type: SchemaType.STRING,
          description: "Kullanıcının antrenmana dair genel geri bildirimi (ör. 'çok ağırdı', 'dizim ağrıdı').",
        },
      },
      required: ["exercises"],
    },
  },
];

interface WorkoutExerciseInput {
  name: string;
  sets?: number;
  reps?: string;
  notes?: string;
}

/** Rounds to 1 decimal place for human-readable kg deltas. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Single write path for a weight reading — used both by the Gemini tool
 * handler below and directly by the dashboard's quick-add Server Action.
 */
export async function logWeightEntry(
  prisma: PrismaClient,
  weightKg: number,
  note?: string
) {
  return prisma.weightEntry.create({ data: { weightKg, note } });
}

async function handleLogWeight(prisma: PrismaClient, args: Record<string, unknown>) {
  const weightKg = Number(args.weightKg);
  const note = typeof args.note === "string" ? args.note : undefined;

  if (!Number.isFinite(weightKg)) {
    return { logged: false, error: "invalid weightKg" };
  }

  const previous = await prisma.weightEntry.findFirst({
    orderBy: { createdAt: "desc" },
  });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await prisma.weightEntry.findMany({
    where: { createdAt: { gte: sevenDaysAgo } },
    select: { weightKg: true },
  });

  await logWeightEntry(prisma, weightKg, note);

  const sevenDayAvg =
    recent.length > 0
      ? round1(recent.reduce((sum, e) => sum + e.weightKg, 0) / recent.length)
      : null;

  return {
    logged: true,
    weightKg,
    previousWeightKg: previous?.weightKg ?? null,
    deltaKg: previous ? round1(weightKg - previous.weightKg) : null,
    sevenDayAvgKg: sevenDayAvg,
  };
}

async function handleLogCalorieEntry(prisma: PrismaClient, args: Record<string, unknown>) {
  const description = typeof args.description === "string" ? args.description : undefined;
  const calories = Number(args.calories);

  if (!description || !Number.isFinite(calories)) {
    return { logged: false, error: "invalid description/calories" };
  }

  const macros: Record<string, number> = {};
  if (typeof args.protein === "number") macros.protein = args.protein;
  if (typeof args.carbs === "number") macros.carbs = args.carbs;
  if (typeof args.fat === "number") macros.fat = args.fat;

  await prisma.calorieEntry.create({
    data: {
      description,
      calories: Math.round(calories),
      macros: Object.keys(macros).length > 0 ? (macros as Prisma.InputJsonValue) : undefined,
    },
  });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayEntries = await prisma.calorieEntry.findMany({
    where: { createdAt: { gte: startOfDay } },
    select: { calories: true },
  });
  const todayTotal = todayEntries.reduce((sum, e) => sum + e.calories, 0);

  return { logged: true, description, calories: Math.round(calories), todayTotalCalories: todayTotal };
}

async function handleLogWorkout(prisma: PrismaClient, args: Record<string, unknown>) {
  const exercises = Array.isArray(args.exercises) ? (args.exercises as WorkoutExerciseInput[]) : [];
  const feedback = typeof args.feedback === "string" ? args.feedback : undefined;

  if (exercises.length === 0) {
    return { logged: false, error: "no exercises provided" };
  }

  await prisma.workoutProgram.create({
    data: {
      exercises: exercises as unknown as Prisma.InputJsonValue,
      feedback,
    },
  });

  return { logged: true, exerciseCount: exercises.length };
}

/**
 * Executes one Gemini function call against the database and returns the
 * FunctionResponse payload to send back via chat.sendMessage([{functionResponse}]).
 */
export async function executeLoggingFunctionCall(
  prisma: PrismaClient,
  call: FunctionCall
): Promise<{ name: string; response: Record<string, unknown> }> {
  const args = (call.args ?? {}) as Record<string, unknown>;

  switch (call.name) {
    case LOG_WEIGHT:
      return { name: call.name, response: await handleLogWeight(prisma, args) };
    case LOG_CALORIE_ENTRY:
      return { name: call.name, response: await handleLogCalorieEntry(prisma, args) };
    case LOG_WORKOUT:
      return { name: call.name, response: await handleLogWorkout(prisma, args) };
    default:
      return { name: call.name, response: { logged: false, error: "unknown function" } };
  }
}
