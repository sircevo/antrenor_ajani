/**
 * Aggregations shared by the Today and Progress screens. Ranges are small
 * enough (a year of daily rows at most) that grouping in JS is simpler and
 * cheaper than raw SQL.
 */

/**
 * `bucketDays` groups the raw daily series before charting — 365 daily bars is
 * unreadable, so longer ranges roll up to weeks or months.
 */
export const PERIODS = {
  hafta: { label: "Hafta", days: 7, bucketDays: 1 },
  ay: { label: "Ay", days: 30, bucketDays: 1 },
  "3ay": { label: "3 Ay", days: 90, bucketDays: 7 },
  yil: { label: "Yıl", days: 364, bucketDays: 28 },
} as const;

export type PeriodKey = keyof typeof PERIODS;

export function resolvePeriod(value: string | undefined): PeriodKey {
  return value && value in PERIODS ? (value as PeriodKey) : "hafta";
}

/** Local-time day key, so "today" matches the user's calendar day. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysAgo(n: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - n);
  return d;
}

/** Short weekday initial (P S Ç P C C P) for chart axes. */
export function weekdayInitial(date: Date): string {
  return ["P", "P", "S", "Ç", "P", "C", "C"][date.getDay()];
}

export function shortDate(date: Date): string {
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
}

/** Sums values per local day. */
export function sumByDay<T>(
  rows: T[],
  getDate: (row: T) => Date,
  getValue: (row: T) => number
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = dayKey(getDate(row));
    totals.set(key, (totals.get(key) ?? 0) + getValue(row));
  }
  return totals;
}

/**
 * Consecutive days ending today (or yesterday, so a day isn't "lost" before
 * the user logs anything) on which at least one entry exists.
 */
export function computeStreak(activeDays: Set<string>): number {
  let streak = 0;
  const cursor = startOfToday();

  if (!activeDays.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!activeDays.has(dayKey(cursor))) return 0;
  }

  while (activeDays.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface Bucket {
  /** Axis label for the bucket. */
  label: string;
  /** Days covered, oldest first. */
  dates: Date[];
}

/**
 * Splits the window into chart buckets, oldest first. With `bucketDays === 1`
 * this is one bucket per day; larger values roll days up so long ranges stay
 * readable.
 */
export function buildBuckets(days: number, bucketDays: number): Bucket[] {
  const buckets: Bucket[] = [];

  for (let offset = days - 1; offset >= 0; offset -= bucketDays) {
    const dates: Date[] = [];
    for (let i = 0; i < bucketDays && offset - i >= 0; i++) {
      dates.unshift(daysAgo(offset - i));
    }
    if (dates.length === 0) continue;

    const first = dates[0];
    buckets.push({
      label:
        bucketDays === 1
          ? days <= 7
            ? weekdayInitial(first)
            : shortDate(first)
          : bucketDays >= 28
            ? first.toLocaleDateString("tr-TR", { month: "short" })
            : shortDate(first),
      dates,
    });
  }

  return buckets;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("tr-TR");
}
