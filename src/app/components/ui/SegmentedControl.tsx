"use client";

import { useRouter, useSearchParams } from "next/navigation";
import styles from "./segmented.module.css";

export interface Segment {
  value: string;
  label: string;
}

/**
 * Pill switcher that drives a search param, so the server component owning the
 * page re-queries with the new range instead of shipping all data to the client.
 */
export function SegmentedControl({
  segments,
  param = "period",
  defaultValue,
}: {
  segments: Segment[];
  param?: string;
  defaultValue: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? defaultValue;

  function select(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, value);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  return (
    <div className={styles.group} role="tablist">
      {segments.map((segment) => (
        <button
          key={segment.value}
          role="tab"
          aria-selected={segment.value === current}
          className={`${styles.segment} ${
            segment.value === current ? styles.selected : ""
          }`}
          onClick={() => select(segment.value)}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
