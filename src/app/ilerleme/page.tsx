import { prisma } from "@/lib/db";
import {
  PERIODS,
  average,
  buildBuckets,
  computeStreak,
  dayKey,
  daysAgo,
  formatNumber,
  formatTrDateKey,
  resolvePeriod,
  round1,
  startOfToday,
  sumByDay,
} from "@/lib/stats";
import { CalorieChart, type CaloriePoint } from "@/app/components/CalorieChart";
import { WeightChart, type WeightPoint } from "@/app/components/WeightChart";
import { SegmentedControl } from "@/app/components/ui/SegmentedControl";
import {
  AppBar,
  Card,
  DeltaBadge,
  InsightCard,
  MetricCard,
  PageTitle,
  Pill,
  Screen,
  SectionTitle,
  ui,
} from "@/app/components/ui";
import { StreakTile, GoalTile, MacroDonut } from "./tiles";

// Reads rows the chat agent writes, so never prerender.
export const dynamic = "force-dynamic";

const SEGMENTS = Object.entries(PERIODS).map(([value, { label }]) => ({
  value,
  label,
}));

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const period = resolvePeriod(searchParams.period);
  const days = PERIODS[period].days;

  // Pull twice the window so the previous period is available for deltas.
  const since = daysAgo(days * 2);

  const [calories, weights, workouts, profile] = await Promise.all([
    prisma.calorieEntry.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.weightEntry.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.workoutProgram.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.styleProfile.findUnique({ where: { id: "singleton" } }),
  ]);

  const windowStart = daysAgo(days - 1);
  const inWindow = <T extends { createdAt: Date }>(rows: T[]) =>
    rows.filter((r) => r.createdAt >= windowStart);
  const inPrevWindow = <T extends { createdAt: Date }>(rows: T[]) =>
    rows.filter((r) => r.createdAt < windowStart);

  // --- Calories: daily totals, rolled into chart buckets ---
  const calorieTotals = sumByDay(calories, (r) => r.createdAt, (r) => r.calories);
  const buckets = buildBuckets(days, PERIODS[period].bucketDays);

  // Longer ranges show the daily average within each bucket, not the sum, so
  // the y-axis stays comparable across periods.
  const caloriePoints: CaloriePoint[] = buckets.map((bucket) => {
    const totals = bucket.dates.map((d) => calorieTotals.get(dayKey(d)) ?? 0);
    const logged = totals.filter((t) => t > 0);
    return {
      date: bucket.label,
      calories: Math.round(average(logged) ?? 0),
    };
  });

  const loggedDayTotals = Array.from(calorieTotals.entries());
  const currentDayTotals = loggedDayTotals
    .filter(([key]) => key >= dayKey(windowStart))
    .map(([, v]) => v);
  const prevDayTotals = loggedDayTotals
    .filter(([key]) => key < dayKey(windowStart))
    .map(([, v]) => v);

  const avgCalories = average(currentDayTotals);
  const prevAvgCalories = average(prevDayTotals);
  const caloriePctDelta =
    avgCalories !== null && prevAvgCalories !== null && prevAvgCalories > 0
      ? ((avgCalories - prevAvgCalories) / prevAvgCalories) * 100
      : null;

  // --- Weight ---
  const weightsNow = inWindow(weights);
  const weightsPrev = inPrevWindow(weights);
  const weightByDay = new Map<string, number[]>();
  for (const w of weightsNow) {
    const key = dayKey(w.createdAt);
    weightByDay.set(key, [...(weightByDay.get(key) ?? []), w.weightKg]);
  }

  // Same bucketing as calories; buckets with no reading are dropped so the line
  // connects actual measurements instead of dipping to zero.
  const weightPoints: WeightPoint[] = buckets
    .map((bucket) => {
      const values = bucket.dates.flatMap((d) => weightByDay.get(dayKey(d)) ?? []);
      const avg = average(values);
      return avg === null ? null : { date: bucket.label, weightKg: round1(avg) };
    })
    .filter((p): p is WeightPoint => p !== null);
  const avgWeight = average(weightsNow.map((w) => w.weightKg));
  const prevAvgWeight = average(weightsPrev.map((w) => w.weightKg));
  const weightDelta =
    avgWeight !== null && prevAvgWeight !== null ? avgWeight - prevAvgWeight : null;

  // --- Streak: any log of any kind counts for the day ---
  const activeDays = new Set<string>();
  for (const row of [...calories, ...weights, ...workouts]) {
    activeDays.add(dayKey(row.createdAt));
  }
  const streak = computeStreak(activeDays);

  // --- Daily goal: today vs the coach's target (falls back to window average) ---
  const todayTotal = calorieTotals.get(dayKey(startOfToday())) ?? 0;
  const goalBasis = profile?.dailyCalorieTarget ?? (avgCalories ? Math.round(avgCalories) : null);
  const goalPct = goalBasis ? Math.min(999, Math.round((todayTotal / goalBasis) * 100)) : null;

  // --- Insights ---
  const macros = { protein: 0, carbs: 0, fat: 0 };
  for (const entry of inWindow(calories)) {
    const m = (entry.macros as Record<string, number> | null) ?? {};
    macros.protein += m.protein ?? 0;
    macros.carbs += m.carbs ?? 0;
    macros.fat += m.fat ?? 0;
  }

  let bestDay: { label: string; calories: number } | null = null;
  for (const [key, total] of loggedDayTotals) {
    if (key < dayKey(windowStart)) continue;
    if (!bestDay || total > bestDay.calories) {
      bestDay = {
        label: formatTrDateKey(key, { weekday: "long" }),
        calories: total,
      };
    }
  }

  return (
    <Screen>
      <AppBar actions={<Pill>🔥 {streak}</Pill>} />

      <PageTitle title="İlerlemen" subtitle="Küçük adımlar, büyük değişim." />

      <SegmentedControl segments={SEGMENTS} defaultValue="hafta" />

      <MetricCard
        title="Kalori alımı"
        value={avgCalories !== null ? formatNumber(avgCalories) : "—"}
        unit="kcal ort."
        delta={
          caloriePctDelta !== null ? (
            <DeltaBadge
              value={`${Math.abs(Math.round(caloriePctDelta))}%`}
              direction={caloriePctDelta < 0 ? "down" : "up"}
              caption="önceki döneme göre"
            />
          ) : undefined
        }
      >
        <CalorieChart data={caloriePoints} target={profile?.dailyCalorieTarget} />
      </MetricCard>

      <MetricCard
        title="Kilo trendi"
        value={avgWeight !== null ? String(round1(avgWeight)) : "—"}
        unit="kg ort."
        delta={
          weightDelta !== null ? (
            <DeltaBadge
              value={`${Math.abs(round1(weightDelta))} kg`}
              direction={weightDelta < 0 ? "down" : "up"}
              caption="önceki döneme göre"
            />
          ) : undefined
        }
      >
        <WeightChart data={weightPoints} />
      </MetricCard>

      <div className={ui.tileRow}>
        <StreakTile days={streak} />
        <GoalTile
          percent={goalPct}
          target={goalBasis}
          hasExplicitTarget={Boolean(profile?.dailyCalorieTarget)}
        />
      </div>

      <SectionTitle>Öne çıkanlar</SectionTitle>
      <div className={ui.insightRow}>
        <InsightCard
          label="Ort. kalori"
          value={avgCalories !== null ? `${formatNumber(avgCalories)}` : "—"}
          note={
            avgCalories !== null && prevAvgCalories !== null
              ? `${avgCalories - prevAvgCalories < 0 ? "↓" : "↑"} ${formatNumber(
                  Math.abs(avgCalories - prevAvgCalories)
                )} kcal`
              : "kcal"
          }
        />
        <InsightCard label="Makro dengesi" value={<MacroDonut macros={macros} />} />
        <InsightCard
          label="En yüksek gün"
          value={bestDay ? bestDay.label : "—"}
          note={bestDay ? `${formatNumber(bestDay.calories)} kcal` : undefined}
        />
      </div>

      {calories.length === 0 && weights.length === 0 && (
        <Card>
          <p className={ui.emptyText}>
            Henüz veri yok. Sohbetten yediklerini veya kilonu yaz — buraya otomatik düşer.
          </p>
        </Card>
      )}
    </Screen>
  );
}
