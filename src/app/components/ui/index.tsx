import type { ReactNode } from "react";
import styles from "./ui.module.css";

export { styles as ui };

/** Page shell: centred column with room for the fixed bottom nav. */
export function Screen({ children }: { children: ReactNode }) {
  return <main className={styles.screen}>{children}</main>;
}

/** Wordmark on the left, actions on the right. */
export function AppBar({ actions }: { actions?: ReactNode }) {
  return (
    <header className={styles.appBar}>
      <span className={styles.brandName}>Antrenör</span>
      {actions && <div className={styles.appBarActions}>{actions}</div>}
    </header>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className={styles.pageTitle}>{title}</h1>
      {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className={styles.sectionTitle}>{children}</h2>;
}

export function Card({ children }: { children: ReactNode }) {
  return <section className={styles.card}>{children}</section>;
}

/** Pill badge, e.g. the streak counter in the app bar. */
export function Pill({ children }: { children: ReactNode }) {
  return <span className={styles.pill}>{children}</span>;
}

interface DeltaProps {
  /** Signed change; sign only picks the arrow, not the colour. */
  value: string;
  direction: "up" | "down";
  /** Amber instead of lime when the change is moving the wrong way. */
  warn?: boolean;
  caption?: string;
}

export function DeltaBadge({ value, direction, warn, caption }: DeltaProps) {
  return (
    <div className={styles.deltaWrap}>
      <span className={`${styles.delta} ${warn ? styles.deltaWarn : ""}`}>
        {direction === "down" ? "↓" : "↑"} {value}
      </span>
      {caption && <span className={styles.deltaCaption}>{caption}</span>}
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  unit?: string;
  delta?: ReactNode;
  children?: ReactNode;
}

/** Title + big number + optional delta badge, with a chart slot underneath. */
export function MetricCard({ title, value, unit, delta, children }: MetricCardProps) {
  return (
    <section className={styles.card}>
      <div className={styles.metricHead}>
        <div>
          <div className={styles.cardTitle}>{title}</div>
          <div className={styles.metricValueRow}>
            <span className={styles.metricValue}>{value}</span>
            {unit && <span className={styles.metricUnit}>{unit}</span>}
          </div>
        </div>
        {delta}
      </div>
      {children && <div className={styles.metricChart}>{children}</div>}
    </section>
  );
}

export function InsightCard({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className={styles.insightCard}>
      <span className={styles.insightLabel}>{label}</span>
      <span className={styles.insightValue}>{value}</span>
      {note && <span className={styles.insightNote}>{note}</span>}
    </div>
  );
}
