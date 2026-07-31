"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";

export interface CaloriePoint {
  date: string;
  calories: number;
}

const AXIS = { fontSize: 11, fill: "#8a8a8a" };

export function CalorieChart({
  data,
  target,
}: {
  data: CaloriePoint[];
  /** Dashed goal line, when the coach has set a daily calorie target. */
  target?: number | null;
}) {
  if (data.length === 0) {
    return <p style={{ fontSize: 14, color: "#8a8a8a" }}>Henüz kalori kaydı yok.</p>;
  }

  const peak = Math.max(...data.map((d) => d.calories));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={AXIS} />
        {/* Right-hand axis matches the reference design and avoids clipping
            wide labels against the card's left padding. */}
        <YAxis
          orientation="right"
          tickLine={false}
          axisLine={false}
          tick={AXIS}
          width={46}
        />
        {target ? (
          <ReferenceLine y={target} stroke="#8a8a8a" strokeDasharray="4 4" />
        ) : null}
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={(value) => [`${value} kcal`, "Kalori"]}
          contentStyle={{
            fontSize: 13,
            background: "#1c1c1c",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
          }}
          labelStyle={{ color: "#8a8a8a" }}
        />
        <Bar dataKey="calories" radius={[999, 999, 0, 0]} maxBarSize={16}>
          {/* The single highest day is amber, matching the reference design. */}
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.calories === peak && peak > 0 ? "#f5a623" : "#c3e84f"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
