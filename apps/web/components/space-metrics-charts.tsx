"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type MetricPoint = { t: number; y: number | null };
type Series = {
  ok: boolean;
  windowSec: number;
  cpu: MetricPoint[];
  memory: MetricPoint[];
  cpuNow: number | null;
  memNow: number | null;
};

function fmtCores(n: number | null): string {
  if (n == null) return "—";
  return n >= 1 ? `${n.toFixed(2)} cores` : `${Math.round(n * 1000)} mCPU`;
}
function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const axisProps = {
  stroke: "var(--muted)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

export function SpaceMetricsCharts({ data }: { data: Series }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Chart
        title="CPU"
        current={fmtCores(data.cpuNow)}
        points={data.cpu}
        fmt={fmtCores}
        color="#34d399"
      />
      <Chart
        title="Memory"
        current={fmtBytes(data.memNow)}
        points={data.memory}
        fmt={fmtBytes}
        color="#60a5fa"
      />
    </div>
  );
}

function Chart({
  title,
  current,
  points,
  fmt,
  color,
}: {
  title: string;
  current: string;
  points: MetricPoint[];
  fmt: (n: number | null) => string;
  color: string;
}) {
  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-medium">{title}</span>
        <span className="font-mono text-xs text-muted">{current}</span>
      </div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
          >
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              tickFormatter={fmtTime}
              {...axisProps}
              minTickGap={48}
            />
            <YAxis
              tickFormatter={(v) => fmt(v as number)}
              width={64}
              {...axisProps}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--muted)" }}
              labelFormatter={(t) => fmtTime(t as number)}
              formatter={(v) => [fmt(v as number), title]}
            />
            <Area
              type="monotone"
              dataKey="y"
              stroke={color}
              fill={color}
              fillOpacity={0.12}
              strokeWidth={1.5}
              isAnimationActive={false}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
