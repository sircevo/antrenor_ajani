/**
 * Live state the coach needs to make decisions: what's left to eat today, what
 * is already on the calendar, and where weight is trending.
 *
 * This is deliberately NOT part of the cached system prompt — it changes on
 * every message, so it rides along with the user's turn instead. Keep it short;
 * it is paid for on every request at full (uncached) rate.
 */

import type { PrismaClient } from "@prisma/client";
import { dayKey, daysAgo, formatTrDate, round1, startOfToday } from "@/lib/stats";

interface Exercise {
  name: string;
  sets?: number;
  reps?: string;
  notes?: string;
}

function formatExercises(exercises: Exercise[]): string {
  return exercises
    .map((e) => {
      const detail = [e.sets ? `${e.sets}x` : "", e.reps ?? ""].join("").trim();
      return detail ? `${e.name} ${detail}` : e.name;
    })
    .join(", ");
}

function formatDay(date: Date): string {
  return formatTrDate(date, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Builds a compact Turkish status block, or null when there is nothing worth
 * sending (fresh install with no data).
 */
export async function buildLiveContext(prisma: PrismaClient): Promise<string | null> {
  const todayStart = startOfToday();
  const in10Days = new Date(todayStart);
  in10Days.setUTCDate(in10Days.getUTCDate() + 10);

  const [profile, todayEntries, plans, weights] = await Promise.all([
    prisma.styleProfile.findUnique({ where: { id: "singleton" } }),
    prisma.calorieEntry.findMany({
      where: { createdAt: { gte: todayStart } },
      select: { description: true, calories: true },
    }),
    prisma.plannedWorkout.findMany({
      where: { date: { gte: todayStart, lt: in10Days } },
      orderBy: { date: "asc" },
    }),
    prisma.weightEntry.findMany({
      where: { createdAt: { gte: daysAgo(14) } },
      orderBy: { createdAt: "desc" },
      take: 14,
    }),
  ]);

  const lines: string[] = [];

  // --- Today's date, so relative dates ("yarın") resolve correctly ---
  lines.push(`Bugün: ${formatDay(new Date())} (${dayKey(new Date())})`);

  // --- Calories ---
  const consumed = todayEntries.reduce((sum, e) => sum + e.calories, 0);
  const target = profile?.dailyCalorieTarget ?? null;
  if (target !== null) {
    lines.push(
      `Bugünkü kalori: ${consumed} / ${target} kcal (kalan ${target - consumed} kcal)` +
        (profile?.proteinTargetG ? `, protein hedefi ${profile.proteinTargetG} g` : "")
    );
  } else if (consumed > 0) {
    lines.push(`Bugünkü kalori: ${consumed} kcal (hedef belirlenmedi)`);
  }
  if (todayEntries.length > 0) {
    lines.push(
      `Bugün yenenler: ${todayEntries.map((e) => `${e.description} (${e.calories})`).join("; ")}`
    );
  }

  // --- Calendar: the agent must see this to edit it coherently ---
  if (plans.length > 0) {
    lines.push("Takvimdeki planlı antrenmanlar:");
    for (const plan of plans) {
      const exercises = (plan.exercises as unknown as Exercise[]) ?? [];
      lines.push(
        `- ${dayKey(plan.date)} ${formatDay(plan.date)}: ${plan.title} — ${formatExercises(exercises)}`
      );
    }
  } else {
    lines.push("Takvimde planlı antrenman yok.");
  }

  // --- Weight trend ---
  if (weights.length > 0) {
    const latest = weights[0];
    lines.push(`Son kilo: ${latest.weightKg} kg (${dayKey(latest.createdAt)})`);

    if (weights.length > 1) {
      const oldest = weights[weights.length - 1];
      const delta = round1(latest.weightKg - oldest.weightKg);
      const sign = delta > 0 ? "+" : "";
      lines.push(`Son ${weights.length} ölçümde değişim: ${sign}${delta} kg`);
    }
  }

  // Only the date line means there is effectively nothing to report.
  return lines.length > 1 ? lines.join("\n") : null;
}
