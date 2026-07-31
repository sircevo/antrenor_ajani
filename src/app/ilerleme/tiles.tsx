import { ui } from "@/app/components/ui";

/** Streak counter with the ring + flame from the reference design. */
export function StreakTile({ days }: { days: number }) {
  // Ring fills over a 30-day horizon so it reads as progress, not a binary.
  const progress = Math.min(1, days / 30);
  const radius = 24;
  const circumference = 2 * Math.PI * radius;

  return (
    <section className={ui.card}>
      <div className={ui.tileHeadRow}>
        <div>
          <div className={ui.cardTitle}>Seri</div>
          <div className={ui.tileValueRow}>
            <span className={ui.tileValue}>{days}</span>
            <span className={ui.tileUnit}>gün</span>
          </div>
        </div>

        <svg className={ui.ring} viewBox="0 0 56 56" aria-hidden>
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="4"
          />
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="#f5a623"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            transform="rotate(-90 28 28)"
          />
          <text x="28" y="34" textAnchor="middle" fontSize="18">
            🔥
          </text>
        </svg>
      </div>

      <p className={ui.tileCaption}>
        {days > 0 ? "Böyle devam!" : "Bugün bir kayıt gir, seri başlasın."}
      </p>
    </section>
  );
}

export function GoalTile({
  percent,
  target,
  hasExplicitTarget,
}: {
  percent: number | null;
  target: number | null;
  hasExplicitTarget: boolean;
}) {
  return (
    <section className={ui.card}>
      <div className={ui.cardTitle}>Günlük hedef</div>
      <div className={ui.tileValueRow}>
        <span className={ui.tileValue}>{percent ?? "—"}</span>
        <span className={ui.tileUnit}>{percent !== null ? "%" : ""}</span>
      </div>

      <div className={ui.progressTrack}>
        <div
          className={ui.progressFill}
          style={{ width: `${Math.min(100, percent ?? 0)}%` }}
        />
      </div>

      <p className={`${ui.tileCaption} ${percent !== null ? ui.tileAccent : ""}`}>
        {percent === null
          ? "Hedef henüz belirlenmedi"
          : hasExplicitTarget
            ? `${target} kcal hedefinin`
            : `${target} kcal ortalamanın`}
      </p>
    </section>
  );
}

/** Macro split donut; grams in, percentages out. */
export function MacroDonut({
  macros,
}: {
  macros: { protein: number; carbs: number; fat: number };
}) {
  const total = macros.protein + macros.carbs + macros.fat;
  if (total === 0) {
    return <span style={{ fontSize: 13, color: "var(--muted)" }}>Veri yok</span>;
  }

  const segments = [
    { value: macros.protein, color: "#c3e84f" },
    { value: macros.carbs, color: "#9bbf3a" },
    { value: macros.fat, color: "#f5a623" },
  ];

  const radius = 15.9155; // circumference ≈ 100, so values map to percentages
  let offset = 25; // start at 12 o'clock

  return (
    <svg viewBox="0 0 42 42" width="52" height="52" aria-hidden>
      {segments.map((segment, i) => {
        const pct = (segment.value / total) * 100;
        const circle = (
          <circle
            key={i}
            cx="21"
            cy="21"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="6"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset={offset}
          />
        );
        offset -= pct;
        return circle;
      })}
    </svg>
  );
}
