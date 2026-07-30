"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export interface CaloriePoint {
  date: string; // "DD.MM" label
  calories: number;
}

export function CalorieChart({ data }: { data: CaloriePoint[] }) {
  if (data.length === 0) {
    return <p>Henüz kalori kaydı yok.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey="date" fontSize={12} />
        <YAxis fontSize={12} />
        <Tooltip
          formatter={(value) => [`${value} kcal`, "Kalori"]}
          contentStyle={{ fontSize: 13 }}
        />
        <Bar dataKey="calories" fill="#059669" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
