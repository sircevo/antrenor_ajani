import Link from "next/link";
import { prisma } from "@/lib/db";
import { addWeightEntry } from "./actions";
import {
  computeStreak,
  dayKey,
  daysAgo,
  formatNumber,
  startOfToday,
} from "@/lib/stats";
import {
  AppBar,
  Card,
  PageTitle,
  Pill,
  Screen,
  SectionTitle,
  ui,
} from "@/app/components/ui";
import styles from "./today.module.css";

export const dynamic = "force-dynamic";

interface Exercise {
  name: string;
  sets?: number;
  reps?: string;
  notes?: string;
}

export default async function TodayPage() {
  const todayStart = startOfToday();
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [planned, todayCalories, latestWeight, profile, recent] = await Promise.all([
    prisma.plannedWorkout.findFirst({
      where: { date: { gte: todayStart, lt: tomorrow } },
    }),
    prisma.calorieEntry.findMany({
      where: { createdAt: { gte: todayStart } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.weightEntry.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.styleProfile.findUnique({ where: { id: "singleton" } }),
    // 30 days is enough to render any plausible streak.
    prisma.calorieEntry.findMany({
      where: { createdAt: { gte: daysAgo(30) } },
      select: { createdAt: true },
    }),
  ]);

  const consumed = todayCalories.reduce((sum, e) => sum + e.calories, 0);
  const target = profile?.dailyCalorieTarget ?? null;
  const remaining = target !== null ? target - consumed : null;
  const pct = target ? Math.min(100, Math.round((consumed / target) * 100)) : 0;

  const activeDays = new Set(recent.map((r) => dayKey(r.createdAt)));
  const streak = computeStreak(activeDays);

  const exercises = (planned?.exercises as unknown as Exercise[]) ?? [];

  const today = new Date().toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <Screen>
      <AppBar actions={<Pill>🔥 {streak}</Pill>} />

      <PageTitle title="Bugün" subtitle={today} />

      {/* --- Today's session --- */}
      <Card>
        <div className={styles.cardHead}>
          <span className={ui.cardTitle}>Bugünün antrenmanı</span>
          {planned && <span className={styles.tag}>{planned.title}</span>}
        </div>

        {!planned ? (
          <p className={styles.empty}>
            Bugün için planlanmış antrenman yok.{" "}
            <Link href="/chat" className={styles.link}>
              Antrenöre sor
            </Link>
            .
          </p>
        ) : (
          <ul className={styles.exerciseList}>
            {exercises.map((exercise, i) => (
              <li key={i} className={styles.exercise}>
                <span className={styles.exerciseName}>{exercise.name}</span>
                <span className={styles.exerciseMeta}>
                  {exercise.sets ? `${exercise.sets}×` : ""}
                  {exercise.reps ?? ""}
                  {exercise.notes ? ` · ${exercise.notes}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* --- Calories today --- */}
      <Card>
        <div className={styles.cardHead}>
          <span className={ui.cardTitle}>Bugünkü kalori</span>
          <span className={styles.tag}>
            {formatNumber(consumed)}
            {target ? ` / ${formatNumber(target)}` : ""} kcal
          </span>
        </div>

        {target !== null && (
          <>
            <div className={ui.progressTrack}>
              <div className={ui.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <p className={styles.remaining}>
              {remaining !== null && remaining >= 0
                ? `${formatNumber(remaining)} kcal kaldı`
                : `Hedefi ${formatNumber(Math.abs(remaining ?? 0))} kcal aştın`}
            </p>
          </>
        )}

        {todayCalories.length > 0 ? (
          <ul className={styles.mealList}>
            {todayCalories.map((entry) => (
              <li key={entry.id} className={styles.meal}>
                <span>{entry.description}</span>
                <span className={styles.mealKcal}>{entry.calories} kcal</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            Bugün henüz öğün girilmedi. Sohbete ne yediğini yaz, otomatik hesaplansın.
          </p>
        )}
      </Card>

      {/* --- Quick weight entry --- */}
      <SectionTitle>Hızlı kayıt</SectionTitle>
      <Card>
        <div className={styles.cardHead}>
          <span className={ui.cardTitle}>Kilo</span>
          {latestWeight && (
            <span className={styles.tag}>son: {latestWeight.weightKg} kg</span>
          )}
        </div>
        <form action={addWeightEntry} className={styles.weightForm}>
          <input
            type="number"
            name="weightKg"
            step="0.1"
            inputMode="decimal"
            placeholder="Bugünkü kilon"
            required
          />
          <button type="submit">Ekle</button>
        </form>
      </Card>
    </Screen>
  );
}
