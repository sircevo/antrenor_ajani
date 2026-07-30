"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export interface WeightPoint {
  date: string; // "DD.MM" label
  weightKg: number;
}

export function WeightChart({ data }: { data: WeightPoint[] }) {
  if (data.length === 0) {
    return <p>Henüz kilo kaydı yok.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey="date" fontSize={12} />
        <YAxis domain={["dataMin - 1", "dataMax + 1"]} fontSize={12} />
        <Tooltip
          formatter={(value) => [`${value} kg`, "Kilo"]}
          contentStyle={{ fontSize: 13 }}
        />
        <Line
          type="monotone"
          dataKey="weightKg"
          stroke="#4f46e5"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
