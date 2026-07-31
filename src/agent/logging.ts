/**
 * Structured tracking (weight/calories/workouts) and onboarding capture,
 * extracted from ordinary chat via function calling. The model decides
 * whether/what to record; this module only executes the resulting Prisma
 * writes and returns a small enriched payload so the final reply can
 * reference what was saved.
 *
 * Declarations are plain JSON Schema, so they work with any function-calling
 * provider.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

export const LOG_WEIGHT = "log_weight";
export const LOG_CALORIE_ENTRY = "log_calorie_entry";
export const LOG_WORKOUT = "log_workout";
export const SAVE_ONBOARDING_PROFILE = "save_onboarding_profile";
export const CREATE_WORKOUT_PLAN = "create_workout_plan";
export const SET_DAILY_TARGETS = "set_daily_targets";

/** Provider-agnostic tool declaration (JSON Schema parameters). */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** One tool invocation, already parsed out of the provider's response. */
export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Tool declarations passed to the model. Descriptions double as behavior
 * instructions (function-calling is steered by these strings): only log
 * things the user reports having already done, never a suggested/future
 * plan, and estimate calories when the user gives no exact number.
 */
export const loggingToolDeclarations: ToolDeclaration[] = [
  {
    name: LOG_WEIGHT,
    description:
      "Kullanıcı güncel vücut ağırlığını bildirdiğinde (ör. 'bugün 82 kilo geldim') çağır. " +
      "Sadece kullanıcı somut bir kilo değeri verdiğinde kullan; tahmini bir hedef kilodan bahsediyorsa çağırma.",
    parameters: {
      type: "object",
      properties: {
        weightKg: {
          type: "number",
          description: "Kullanıcının bildirdiği kilo, kilogram cinsinden (ör. 82.4).",
        },
        note: {
          type: "string",
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
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Yenilen/içilenin kısa açıklaması (ör. '3 yumurta + yulaf ezmesi').",
        },
        calories: {
          type: "integer",
          description: "Toplam kalori (kcal). Kullanıcı vermediyse tahmini değer.",
        },
        protein: { type: "number", description: "Gram protein (biliniyorsa/tahmin edilebiliyorsa)." },
        carbs: { type: "number", description: "Gram karbonhidrat (biliniyorsa/tahmin edilebiliyorsa)." },
        fat: { type: "number", description: "Gram yağ (biliniyorsa/tahmin edilebiliyorsa)." },
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
      type: "object",
      properties: {
        exercises: {
          type: "array",
          description: "Yapılan hareketlerin listesi.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Hareket adı." },
              sets: { type: "integer", description: "Set sayısı." },
              reps: { type: "string", description: "Tekrar (ör. '8-10' veya '12,10,8')." },
              notes: { type: "string", description: "Kısa not (ağırlık, RIR, vb.)." },
            },
            required: ["name"],
          },
        },
        feedback: {
          type: "string",
          description: "Kullanıcının antrenmana dair genel geri bildirimi (ör. 'çok ağırdı', 'dizim ağrıdı').",
        },
      },
      required: ["exercises"],
    },
  },
  {
    name: SAVE_ONBOARDING_PROFILE,
    description:
      "Kullanıcı profilini kalıcı olarak kaydeder. İki durumda çağır: " +
      "(1) İlk tanışma görüşmesinin sonunda, bilgileri topladıktan sonra — bu tanışma modunu kapatır. " +
      "(2) DAHA SONRA kullanıcı profili ilgilendiren yeni bir bilgi verdiğinde: sakatlık/ağrı, " +
      "hedef değişikliği, beslenme düzeni değişikliği, yeni takviye/ilaç, antrenman günlerinin değişmesi. " +
      "Böyle bir bilgi geldiğinde SADECE takvimi/programı güncellemekle yetinme — bu aracı da çağır, " +
      "yoksa bilgi konuşma geçmişinden düştüğünde kalıcı olarak kaybolur. " +
      "Güncellerken yalnızca değişen alanları gönderebilirsin; gönderilmeyen alanlar korunur. " +
      "İlk çağrı için en azından ton tercihi ve hedef bilinmeli.",
    parameters: {
      type: "object",
      properties: {
        tone: {
          type: "string",
          enum: ["samimi", "ciddi", "kurumsal", "kanka"],
          description:
            "Kullanıcının seçtiği konuşma tarzı. Bundan sonraki tüm cevaplarda bu ton kullanılır.",
        },
        goal: {
          type: "string",
          description: "Birincil hedef (kas alımı / yağ yakımı / recomp) ve varsa kullanıcının kendi ifadesi.",
        },
        trainingDays: {
          type: "string",
          description: "Haftada kaç gün ve hangi saatlerde antrenman yapabiliyor (ör. 'haftada 5 gün, sabah 11-12').",
        },
        dietPattern: {
          type: "string",
          description: "Beslenme düzeni: öğün sayısı, aç karına antrenman yapıp yapmadığı, kısıtlar/alerjiler, sevmedikleri.",
        },
        medications: {
          type: "string",
          description:
            "Kullandığı takviye ve ilaçlar — kullanıcının BEYAN ETTİĞİ şekilde, olduğu gibi kaydet. " +
            "Bu yalnızca programlama bağlamıdır; doz/protokol yorumu YAPMA.",
        },
        injuries: {
          type: "string",
          description: "Sakatlıklar, ağrılar, yapamadığı hareketler (ör. 'sol diz sakat, squat yapamıyor').",
        },
        experience: {
          type: "string",
          description: "Antrenman geçmişi/deneyim seviyesi ve mevcut fiziksel durumu (boy/kilo dahil, biliniyorsa).",
        },
        notes: {
          type: "string",
          description: "Programlamayı etkileyecek diğer her şey (uyku düzeni, iş temposu, stres, ekipman erişimi).",
        },
      },
      // Nothing is hard-required: later calls are partial updates that only
      // carry the changed fields. The handler enforces tone on first save.
      required: [],
    },
  },
  {
    name: CREATE_WORKOUT_PLAN,
    description:
      "Kullanıcı için antrenman programı hazırladığında çağır ki program TAKVİME düşsün. " +
      "Tanışma görüşmesinin hemen ardından mutlaka çağır; ayrıca kullanıcı programı beğenmeyip " +
      "değişiklik istediğinde güncel haliyle tekrar çağır. " +
      "Aynı tarihe ait eski plan otomatik olarak yenisiyle değiştirilir. " +
      "Dinlenme günleri için kayıt oluşturma — sadece antrenman yapılacak günleri gönder.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "array",
          description: "Planlanan antrenman günleri (genelde önümüzdeki 7-14 gün).",
          items: {
            type: "object",
            properties: {
              date: {
                type: "string",
                description: "Antrenman tarihi, YYYY-MM-DD biçiminde (ör. '2026-08-03').",
              },
              title: {
                type: "string",
                description: "Seansın kısa adı (ör. 'Push A', 'Bacak', 'Sırt + Biceps').",
              },
              exercises: {
                type: "array",
                description: "O gün yapılacak hareketler.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Hareket adı." },
                    sets: { type: "integer", description: "Set sayısı." },
                    reps: { type: "string", description: "Tekrar aralığı (ör. '8-10')." },
                    notes: {
                      type: "string",
                      description: "Kısa not (RIR, dinlenme süresi, teknik uyarısı).",
                    },
                  },
                  required: ["name"],
                },
              },
            },
            required: ["date", "title", "exercises"],
          },
        },
        restDays: {
          type: "array",
          description:
            "Takvimden TEMİZLENECEK günler, YYYY-MM-DD biçiminde. Bir günü dinlenmeye " +
            "çevirirken ya da o günün antrenmanını başka güne taşırken ESKİ günü buraya yaz. " +
            "Yazmazsan eski antrenman takvimde kalmaya devam eder.",
          items: { type: "string" },
        },
      },
      // Neither is hard-required: a call may only add days, only clear days, or
      // both (e.g. moving a session). The handler rejects a call that does neither.
      required: [],
    },
  },
  {
    name: SET_DAILY_TARGETS,
    description:
      "Kullanıcının günlük kalori ve protein hedefini belirlediğinde/güncellediğinde çağır. " +
      "Tanışma sonrası beslenme planını kurarken mutlaka çağır; hedef değişirse tekrar çağır. " +
      "Bu değerler panelde 'günlük hedef' olarak gösterilir.",
    parameters: {
      type: "object",
      properties: {
        dailyCalorieTarget: {
          type: "integer",
          description: "Günlük toplam kalori hedefi (kcal).",
        },
        proteinTargetG: {
          type: "integer",
          description: "Günlük protein hedefi (gram).",
        },
      },
      required: ["dailyCalorieTarget"],
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

/** Fields of the onboarding interview stored inside StyleProfile.summary. */
const ONBOARDING_FIELDS = [
  "goal",
  "trainingDays",
  "dietPattern",
  "medications",
  "injuries",
  "experience",
  "notes",
] as const;

async function handleSaveOnboardingProfile(
  prisma: PrismaClient,
  args: Record<string, unknown>
) {
  const tone = typeof args.tone === "string" ? args.tone.trim() : undefined;
  const existing = await prisma.styleProfile.findUnique({ where: { id: "singleton" } });

  // Tone is only mandatory on the first save; later calls are partial updates
  // (e.g. recording an injury) and keep whatever is already stored.
  if (!existing && !tone) {
    return { saved: false, error: "tone is required on first save" };
  }

  const profile: Record<string, string> = {};
  for (const field of ONBOARDING_FIELDS) {
    const value = args[field];
    if (typeof value === "string" && value.trim()) {
      profile[field] = value.trim();
    }
  }

  const mergedSummary = {
    ...((existing?.summary as Record<string, unknown>) ?? {}),
    ...profile,
  };

  const resolvedTone = tone ?? existing?.tone ?? null;

  await prisma.styleProfile.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      tone: resolvedTone,
      onboarded: true,
      summary: mergedSummary as Prisma.InputJsonValue,
    },
    update: {
      tone: resolvedTone,
      onboarded: true,
      summary: mergedSummary as Prisma.InputJsonValue,
    },
  });

  return { saved: true, tone: resolvedTone, updatedFields: Object.keys(profile) };
}

interface PlannedDayInput {
  date?: string;
  title?: string;
  exercises?: WorkoutExerciseInput[];
}

/** Parses a YYYY-MM-DD day into local midnight; null if unusable. */
function parsePlanDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats a plan date back as YYYY-MM-DD in LOCAL time. `toISOString()` would
 * shift to UTC and, for any timezone ahead of it, report the previous day —
 * which would make the coach tell the user the wrong day.
 */
function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function handleCreateWorkoutPlan(
  prisma: PrismaClient,
  args: Record<string, unknown>
) {
  const days = Array.isArray(args.days) ? (args.days as PlannedDayInput[]) : [];
  const restDaysRaw = Array.isArray(args.restDays) ? args.restDays : [];

  const rows: { date: Date; title: string; exercises: WorkoutExerciseInput[] }[] = [];
  const restDates: Date[] = [];
  const invalid: string[] = [];

  for (const day of days) {
    const date = parsePlanDate(day.date);
    if (!date) {
      invalid.push(String(day.date ?? "(tarihsiz)"));
      continue;
    }
    // A day sent with no exercises means "make this a rest day". It used to be
    // dropped silently, which left the previous session sitting on the date
    // while the reply claimed the day had been cleared.
    const exercises = Array.isArray(day.exercises) ? day.exercises : [];
    if (!day.title || exercises.length === 0) {
      restDates.push(date);
      continue;
    }
    rows.push({ date, title: day.title, exercises });
  }

  for (const value of restDaysRaw) {
    const date = parsePlanDate(typeof value === "string" ? value : undefined);
    if (date) {
      restDates.push(date);
    } else {
      invalid.push(String(value));
    }
  }

  if (rows.length === 0 && restDates.length === 0) {
    return {
      saved: false,
      error: "no valid days (need date + title + exercises, or restDays to clear)",
      invalidDates: invalid,
    };
  }

  // Every touched date is cleared first: that keeps re-planning idempotent and
  // makes a moved session actually leave its old day.
  const touched = [...rows.map((r) => r.date), ...restDates];

  await prisma.$transaction([
    ...touched.map((date) => {
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      return prisma.plannedWorkout.deleteMany({
        where: { date: { gte: date, lt: nextDay } },
      });
    }),
    prisma.plannedWorkout.createMany({
      data: rows.map(({ date, title, exercises }) => ({
        date,
        title,
        exercises: exercises as unknown as Prisma.InputJsonValue,
      })),
    }),
  ]);

  return {
    saved: true,
    plannedDays: rows.map((r) => ({ date: toDayKey(r.date), title: r.title })),
    clearedDays: restDates.map(toDayKey),
    ...(invalid.length > 0 ? { invalidDates: invalid } : {}),
  };
}

async function handleSetDailyTargets(
  prisma: PrismaClient,
  args: Record<string, unknown>
) {
  const dailyCalorieTarget = Number(args.dailyCalorieTarget);
  if (!Number.isFinite(dailyCalorieTarget) || dailyCalorieTarget <= 0) {
    return { saved: false, error: "invalid dailyCalorieTarget" };
  }

  const proteinRaw = Number(args.proteinTargetG);
  const proteinTargetG =
    Number.isFinite(proteinRaw) && proteinRaw > 0 ? Math.round(proteinRaw) : undefined;

  await prisma.styleProfile.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      summary: {} as Prisma.InputJsonValue,
      dailyCalorieTarget: Math.round(dailyCalorieTarget),
      proteinTargetG,
    },
    update: {
      dailyCalorieTarget: Math.round(dailyCalorieTarget),
      proteinTargetG,
    },
  });

  return { saved: true, dailyCalorieTarget: Math.round(dailyCalorieTarget), proteinTargetG };
}

/**
 * Executes one tool call against the database and returns the payload to feed
 * back to the model so its final reply can reference what was recorded.
 */
export async function executeLoggingFunctionCall(
  prisma: PrismaClient,
  call: ParsedToolCall
): Promise<{ name: string; response: Record<string, unknown> }> {
  const args = call.args ?? {};

  switch (call.name) {
    case LOG_WEIGHT:
      return { name: call.name, response: await handleLogWeight(prisma, args) };
    case LOG_CALORIE_ENTRY:
      return { name: call.name, response: await handleLogCalorieEntry(prisma, args) };
    case LOG_WORKOUT:
      return { name: call.name, response: await handleLogWorkout(prisma, args) };
    case SAVE_ONBOARDING_PROFILE:
      return { name: call.name, response: await handleSaveOnboardingProfile(prisma, args) };
    case CREATE_WORKOUT_PLAN:
      return { name: call.name, response: await handleCreateWorkoutPlan(prisma, args) };
    case SET_DAILY_TARGETS:
      return { name: call.name, response: await handleSetDailyTargets(prisma, args) };
    default:
      return { name: call.name, response: { logged: false, error: "unknown function" } };
  }
}
