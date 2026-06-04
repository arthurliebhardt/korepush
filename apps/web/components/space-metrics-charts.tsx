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

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Pick ONE unit for the whole chart from its max value, so every tick is in the
// same unit (shown once, in the header) and the axis carries bare numbers.
function cpuUnit(maxCores: number) {
  return maxCores >= 1
    ? { unit: "cores", divisor: 1 }
    : { unit: "mCPU", divisor: 0.001 };
}
function memUnit(maxBytes: number) {
  const units: [string, number][] = [
    ["B", 1],
    ["KiB", 1024],
    ["MiB", 1024 ** 2],
    ["GiB", 1024 ** 3],
    ["TiB", 1024 ** 4],
  ];
  let pick = units[0];
  for (const u of units) if (maxBytes >= u[1]) pick = u;
  return { unit: pick[0], divisor: pick[1] };
}

// Round tick values in display units: 0, 50, 100, 150, 200 — not 42.9, 85.8, …
function niceTicks(maxDisplay: number): number[] {
  if (!(maxDisplay > 0)) return [0, 1];
  const exp = Math.floor(Math.log10(maxDisplay));
  const base = 10 ** exp;
  const f = maxDisplay / base;
  const step = (f <= 1 ? 0.2 : f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * base;
  const out: number[] = [];
  for (let t = 0; t < maxDisplay + step * 0.5; t += step) {
    out.push(Number(t.toFixed(6)));
  }
  if (out[out.length - 1] < maxDisplay) out.push(out[out.length - 1] + step);
  return out;
}

function trim(n: number): string {
  if (n >= 10) return String(Math.round(n));
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

export function SpaceMetricsCharts({ data }: { data: Series }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Chart
        title="CPU"
        kind="cpu"
        points={data.cpu}
        now={data.cpuNow}
        color="#34d399"
      />
      <Chart
        title="Memory"
        kind="memory"
        points={data.memory}
        now={data.memNow}
        color="#60a5fa"
      />
    </div>
  );
}

function Chart({
  title,
  kind,
  points,
  now,
  color,
}: {
  title: string;
  kind: "cpu" | "memory";
  points: MetricPoint[];
  now: number | null;
  color: string;
}) {
  const maxRaw = Math.max(
    now ?? 0,
    ...points.map((p) => p.y ?? 0),
    0,
  );
  const { unit, divisor } =
    kind === "memory" ? memUnit(maxRaw) : cpuUnit(maxRaw);
  const ticksDisplay = niceTicks(maxRaw / divisor);
  const top = ticksDisplay[ticksDisplay.length - 1] || 1;

  const fmtNow = now != null ? `${trim(now / divisor)} ${unit}` : "—";

  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-medium">
          {title}{" "}
          <span className="text-xs font-normal text-fg-subtle">({unit})</span>
        </span>
        <span className="font-mono text-xs text-muted">{fmtNow}</span>
      </div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 4, right: 8, bottom: 0, left: 4 }}
          >
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              tickFormatter={fmtTime}
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
            />
            <YAxis
              domain={[0, top * divisor]}
              ticks={ticksDisplay.map((t) => t * divisor)}
              tickFormatter={(v) => trim((v as number) / divisor)}
              width={36}
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
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
              formatter={(v) => [`${trim((v as number) / divisor)} ${unit}`, title]}
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
