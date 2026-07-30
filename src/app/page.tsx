import { prisma } from "@/lib/db";
import { addWeightEntry } from "./actions";
import { WeightChart, type WeightPoint } from "./components/WeightChart";
import { CalorieChart, type CaloriePoint } from "./components/CalorieChart";
import styles from "./page.module.css";

// This page reads data written by a separate process (the Telegram polling
// agent), so it must not be statically cached at build time — every request
// needs a fresh DB read.
export const dynamic = "force-dynamic";

const WEIGHT_HISTORY_LIMIT = 90;
const CALORIE_HISTORY_DAYS = 14;
const WORKOUT_HISTORY_LIMIT = 10;
const ACTIVITY_FEED_LIMIT = 20;

interface WorkoutExercise {
  name: string;
  sets?: number;
  reps?: string;
  notes?: string;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function getWeightChartData(): Promise<{ points: WeightPoint[]; latest: number | null }> {
  const rows = await prisma.weightEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: WEIGHT_HISTORY_LIMIT,
  });
  const ascending = rows.slice().reverse();
  return {
    points: ascending.map((row) => ({
      date: formatDayLabel(row.createdAt),
      weightKg: row.weightKg,
    })),
    latest: rows[0]?.weightKg ?? null,
  };
}

async function getCalorieChartData(): Promise<{
  points: CaloriePoint[];
  today: { description: string; calories: number }[];
  todayTotal: number;
}> {
  const since = new Date();
  since.setDate(since.getDate() - CALORIE_HISTORY_DAYS);
  since.setHours(0, 0, 0, 0);

  const rows = await prisma.calorieEntry.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
  });

  const totalsByDay = new Map<string, number>();
  for (const row of rows) {
    const key = dayKey(row.createdAt);
    totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + row.calories);
  }

  const points: CaloriePoint[] = [];
  for (let i = CALORIE_HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    points.push({ date: formatDayLabel(d), calories: totalsByDay.get(key) ?? 0 });
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayEntries = rows.filter((r) => r.createdAt >= startOfToday);
  const todayTotal = todayEntries.reduce((sum, r) => sum + r.calories, 0);

  return {
    points,
    today: todayEntries.map((r) => ({ description: r.description, calories: r.calories })),
    todayTotal,
  };
}

async function getWorkoutHistory() {
  return prisma.workoutProgram.findMany({
    orderBy: { createdAt: "desc" },
    take: WORKOUT_HISTORY_LIMIT,
  });
}

async function getRecentActivity() {
  return prisma.conversationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: ACTIVITY_FEED_LIMIT,
  });
}

export default async function DashboardPage() {
  const [weight, calories, workouts, activity] = await Promise.all([
    getWeightChartData(),
    getCalorieChartData(),
    getWorkoutHistory(),
    getRecentActivity(),
  ]);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Antrenör Ajanı — Dashboard</h1>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Kilo Trendi</h2>
          {weight.latest !== null && (
            <span className={styles.badge}>{weight.latest} kg</span>
          )}
        </div>
        <WeightChart data={weight.points} />
        <form action={addWeightEntry} className={styles.quickForm}>
          <input
            type="number"
            name="weightKg"
            step="0.1"
            placeholder="Bugünkü kilo (kg)"
            required
          />
          <input type="text" name="note" placeholder="Not (opsiyonel)" />
          <button type="submit">Ekle</button>
        </form>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Kalori Trendi (son {CALORIE_HISTORY_DAYS} gün)</h2>
          <span className={styles.badge}>bugün: {calories.todayTotal} kcal</span>
        </div>
        <CalorieChart data={calories.points} />
        {calories.today.length > 0 && (
          <ul className={styles.list}>
            {calories.today.map((entry, i) => (
              <li key={i}>
                {entry.description} — <strong>{entry.calories} kcal</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card}>
        <h2>Antrenman Geçmişi</h2>
        {workouts.length === 0 && <p>Henüz antrenman kaydı yok.</p>}
        <ul className={styles.workoutList}>
          {workouts.map((w) => {
            const exercises = (w.exercises as unknown as WorkoutExercise[]) ?? [];
            return (
              <li key={w.id} className={styles.workoutItem}>
                <div className={styles.workoutDate}>
                  {w.createdAt.toLocaleDateString("tr-TR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </div>
                <ul>
                  {exercises.map((ex, i) => (
                    <li key={i}>
                      {ex.name}
                      {ex.sets ? ` — ${ex.sets} set` : ""}
                      {ex.reps ? ` x ${ex.reps}` : ""}
                      {ex.notes ? ` (${ex.notes})` : ""}
                    </li>
                  ))}
                </ul>
                {w.feedback && <p className={styles.feedback}>💬 {w.feedback}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.card}>
        <h2>Son Aktivite</h2>
        {activity.length === 0 && <p>Henüz konuşma yok.</p>}
        <ul className={styles.activityList}>
          {activity.map((entry) => (
            <li key={entry.id} className={entry.role === "user" ? styles.userMsg : styles.assistantMsg}>
              <span className={styles.activityRole}>
                {entry.role === "user" ? "Sen" : "Antrenör"}
              </span>
              <span>{entry.content}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
