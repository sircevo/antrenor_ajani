"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

export interface WeightPoint {
  date: string;
  weightKg: number;
}

const AXIS = { fontSize: 11, fill: "#8a8a8a" };

export function WeightChart({ data }: { data: WeightPoint[] }) {
  if (data.length === 0) {
    return <p style={{ fontSize: 14, color: "#8a8a8a" }}>Henüz kilo kaydı yok.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 0, left: 4, bottom: 0 }}>
        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={AXIS} />
        {/* Right-hand axis matches the reference design and avoids clipping
            wide labels against the card's left padding. */}
        <YAxis
          orientation="right"
          domain={["dataMin - 1", "dataMax + 1"]}
          tickLine={false}
          axisLine={false}
          tick={AXIS}
          width={46}
          tickFormatter={(v: number) => String(Math.round(v * 10) / 10)}
        />
        <Tooltip
          cursor={{ stroke: "rgba(255,255,255,0.12)" }}
          formatter={(value) => [`${value} kg`, "Kilo"]}
          contentStyle={{
            fontSize: 13,
            background: "#1c1c1c",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
          }}
          labelStyle={{ color: "#8a8a8a" }}
        />
        <Line
          type="monotone"
          dataKey="weightKg"
          stroke="#c3e84f"
          strokeWidth={2.5}
          dot={{ r: 4, fill: "#c3e84f", strokeWidth: 0 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
