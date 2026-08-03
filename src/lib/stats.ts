/**
 * Aggregations shared by the Today and Progress screens. Ranges are small
 * enough (a year of daily rows at most) that grouping in JS is simpler and
 * cheaper than raw SQL.
 *
 * Single-user app, always Turkey — so every "what day is it" calculation is
 * pinned to Europe/Istanbul rather than the server's local time. Railway runs
 * containers in UTC, so without this, "today" rolls over ~3 hours late for a
 * Turkey-based user (their midnight is still 21:00 UTC the day before).
 */

const TIMEZONE = "Europe/Istanbul";

/** Turkey-local offset from UTC, in minutes, at the given instant. */
function tzOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  // "24" from hour12:false midnight is Intl's own quirk — Date.UTC normalizes it fine.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60_000;
}

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

/** Turkey-calendar day key (YYYY-MM-DD), regardless of the server's own timezone. */
export function dayKey(date: Date): string {
  // en-CA formats as YYYY-MM-DD, which we use directly as a sortable string key.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Midnight today, Turkey time, expressed as the equivalent real UTC instant. */
export function startOfToday(): Date {
  const now = new Date();
  const offsetMin = tzOffsetMinutes(now);
  // Shift into Turkey wall-clock time, zero the time-of-day there, shift back.
  const shifted = new Date(now.getTime() + offsetMin * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMin * 60_000);
}

export function daysAgo(n: number): Date {
  const d = startOfToday();
  // Turkey has had no DST since 2016, so calendar-day arithmetic on the UTC
  // instant we already computed can't drift — setUTCDate avoids any
  // dependency on the server's own local timezone.
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** Short weekday initial (P S Ç P C C P) for chart axes, Turkey calendar. */
export function weekdayInitial(date: Date): string {
  const shortNameToIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const shortName = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
  }).format(date);
  return ["P", "P", "S", "Ç", "P", "C", "C"][shortNameToIndex[shortName] ?? 0];
}

export function shortDate(date: Date): string {
  return date.toLocaleDateString("tr-TR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
  });
}

/** Centralised tr-TR formatter — every caller needs the Turkey timezone pinned. */
export function formatTrDate(
  date: Date,
  options: Intl.DateTimeFormatOptions
): string {
  return date.toLocaleDateString("tr-TR", { timeZone: TIMEZONE, ...options });
}

/**
 * Formats a `dayKey()`-style "YYYY-MM-DD" string (already a Turkey calendar
 * day, no time component) — parsed and formatted in UTC so the weekday can't
 * shift across a timezone conversion. Don't use `formatTrDate` here: that
 * would re-interpret the UTC midnight this parses to as Turkey-local 03:00.
 */
export function formatTrDateKey(
  key: string,
  options: Intl.DateTimeFormatOptions
): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("tr-TR", {
    timeZone: "UTC",
    ...options,
  });
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

  // UTC-date arithmetic on an already-Turkey-midnight instant, so this stays
  // correct no matter what timezone the server process itself runs in.
  if (!activeDays.has(dayKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!activeDays.has(dayKey(cursor))) return 0;
  }

  while (activeDays.has(dayKey(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
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
            ? formatTrDate(first, { month: "short" })
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
