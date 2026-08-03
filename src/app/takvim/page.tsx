import Link from "next/link";
import { prisma } from "@/lib/db";
import { dayKey, formatTrDate, startOfToday } from "@/lib/stats";
import { AppBar, Card, PageTitle, Screen, ui } from "@/app/components/ui";
import styles from "./takvim.module.css";

export const dynamic = "force-dynamic";

const DAYS_SHOWN = 14;

interface Exercise {
  name: string;
  sets?: number;
  reps?: string;
  notes?: string;
}

export default async function CalendarPage() {
  const start = startOfToday();
  const end = new Date(start);
  // start is a real UTC instant (Turkey midnight); UTC-date arithmetic on it
  // stays correct no matter what timezone the server process itself runs in.
  end.setUTCDate(end.getUTCDate() + DAYS_SHOWN);

  const planned = await prisma.plannedWorkout.findMany({
    where: { date: { gte: start, lt: end } },
    orderBy: { date: "asc" },
  });

  const byDay = new Map<string, (typeof planned)[number]>();
  for (const row of planned) {
    byDay.set(dayKey(row.date), row);
  }

  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + i);
    return { date, workout: byDay.get(dayKey(date)) };
  });

  return (
    <Screen>
      <AppBar />
      <PageTitle title="Takvim" subtitle="Önümüzdeki iki hafta" />

      {planned.length === 0 && (
        <Card>
          <p className={ui.emptyText}>
            Henüz planlanmış antrenman yok.{" "}
            <Link href="/chat" className={styles.link}>
              Antrenörden program iste
            </Link>{" "}
            — buraya otomatik düşer.
          </p>
        </Card>
      )}

      <ul className={styles.dayList}>
        {days.map(({ date, workout }, i) => {
          const exercises = (workout?.exercises as unknown as Exercise[]) ?? [];
          const isToday = i === 0;

          return (
            <li
              key={dayKey(date)}
              className={`${styles.day} ${isToday ? styles.today : ""} ${
                workout ? "" : styles.restDay
              }`}
            >
              <div className={styles.dayHead}>
                <div className={styles.dateBlock}>
                  <span className={styles.dayNum}>{date.getUTCDate()}</span>
                  <span className={styles.dayName}>
                    {formatTrDate(date, { weekday: "short" })}
                  </span>
                </div>

                <div className={styles.dayMain}>
                  <span className={styles.dayTitle}>
                    {workout ? workout.title : "Dinlenme"}
                  </span>
                  {workout && (
                    <span className={styles.dayMeta}>
                      {exercises.length} hareket
                      {workout.status === "done" ? " · tamamlandı" : ""}
                    </span>
                  )}
                </div>

                {isToday && <span className={styles.todayTag}>bugün</span>}
              </div>

              {exercises.length > 0 && (
                <ul className={styles.exerciseList}>
                  {exercises.map((exercise, j) => (
                    <li key={j} className={styles.exercise}>
                      <div className={styles.exerciseMain}>
                        <span>{exercise.name}</span>
                        {exercise.notes && (
                          <span className={styles.exerciseNote}>{exercise.notes}</span>
                        )}
                      </div>
                      <span className={styles.exerciseMeta}>
                        {exercise.sets ? `${exercise.sets}×` : ""}
                        {exercise.reps ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}
