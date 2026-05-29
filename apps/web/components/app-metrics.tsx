"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type MetricPoint = { t: number; y: number | null };
type MetricSeries = { pod: string; points: MetricPoint[] };
type Metrics = {
  ok: boolean;
  windowSec?: number;
  cpu?: MetricSeries[];
  memory?: MetricSeries[];
  netRx?: MetricSeries[];
  netTx?: MetricSeries[];
  restarts?: number;
  cpuLimitCores?: number | null;
  memLimitBytes?: number | null;
};

const PALETTE = ["#34d399", "#60a5fa", "#fbbf24", "#f87171", "#a78bfa"];

// ---- formatting ----------------------------------------------------------
function fmtCores(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1) return `${n.toFixed(2)} cores`;
  return `${Math.round(n * 1000)} m`;
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
function fmtBps(n: number | null): string {
  if (n == null) return "—";
  const u = ["B/s", "KB/s", "MB/s", "GB/s"];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function pctOfLimit(used: number | null, limit: number | null | undefined) {
  if (used == null || !limit) return null;
  return Math.round((used / limit) * 100);
}
function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Merge per-pod series into recharts rows keyed by timestamp: { t, <pod>: y }.
function mergeRows(series: MetricSeries[]) {
  const byT = new Map<number, Record<string, number | null>>();
  for (const s of series)
    for (const p of s.points) {
      const row = byT.get(p.t) ?? { t: p.t };
      row[s.pod] = p.y;
      byT.set(p.t, row);
    }
  return [...byT.values()].sort((a, b) => (a.t as number) - (b.t as number));
}

// Sum across pods per timestamp → single series of rows { t, value }.
function sumRows(series: MetricSeries[], key: string) {
  const byT = new Map<number, number>();
  for (const s of series)
    for (const p of s.points)
      if (p.y != null) byT.set(p.t, (byT.get(p.t) ?? 0) + p.y);
  return [...byT.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, [key]: v }));
}

function summedLast(series: MetricSeries[] | undefined): number | null {
  if (!series?.length) return null;
  const rows = sumRows(series, "v");
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i].v;
    if (v != null) return v as number;
  }
  return null;
}

// ---- chart primitives ----------------------------------------------------
const axisProps = {
  stroke: "var(--muted)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};
const tooltipStyle = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "var(--muted)" },
};

function ChartCard({
  title,
  current,
  children,
}: {
  title: string;
  current?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-medium">{title}</span>
        {current && (
          <span className="font-mono text-xs text-muted">{current}</span>
        )}
      </div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PerPodArea({
  series,
  fmt,
}: {
  series: MetricSeries[];
  fmt: (n: number | null) => string;
}) {
  const rows = mergeRows(series);
  const pods = series.map((s) => s.pod);
  return (
    <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="t" tickFormatter={fmtTime} {...axisProps} minTickGap={48} />
      <YAxis tickFormatter={(v) => fmt(v as number)} width={64} {...axisProps} />
      <Tooltip
        {...tooltipStyle}
        labelFormatter={(t) => fmtTime(t as number)}
        formatter={(v) => fmt(v as number)}
      />
      {pods.map((pod, i) => (
        <Area
          key={pod}
          type="monotone"
          dataKey={pod}
          stroke={PALETTE[i % PALETTE.length]}
          fill={PALETTE[i % PALETTE.length]}
          fillOpacity={0.12}
          strokeWidth={1.5}
          isAnimationActive={false}
          connectNulls
        />
      ))}
    </AreaChart>
  );
}

// ---- main ----------------------------------------------------------------
export function AppMetrics({
  spaceSlug,
  appSlug,
  namespace,
}: {
  spaceSlug: string;
  appSlug: string;
  namespace: string;
}) {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    const es = new EventSource(
      `/api/spaces/${spaceSlug}/apps/${appSlug}/metrics`,
    );
    es.onmessage = (e) => {
      try {
        setM(JSON.parse(e.data));
      } catch {}
    };
    return () => es.close();
  }, [spaceSlug, appSlug]);

  const netRows = useMemo(() => {
    if (!m) return [];
    const rx = sumRows(m.netRx ?? [], "rx");
    const tx = sumRows(m.netTx ?? [], "tx");
    const byT = new Map<number, Record<string, number>>();
    for (const r of rx) byT.set(r.t, { t: r.t, rx: r.rx as number });
    for (const r of tx)
      byT.set(r.t, { ...(byT.get(r.t) ?? { t: r.t }), tx: r.tx as number });
    return [...byT.values()].sort((a, b) => a.t - b.t);
  }, [m]);

  const grafanaHref = `/grafana/d/korepush-app/korepush-app?var-namespace=${encodeURIComponent(
    namespace,
  )}&var-pod=${encodeURIComponent(`${appSlug}-.*`)}&from=now-1h&to=now`;

  const header = (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-muted">Metrics</span>
      <a
        href={grafanaHref}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-muted hover:text-foreground"
      >
        Open in Grafana ↗
      </a>
    </div>
  );

  if (!m?.ok) {
    return (
      <div className="space-y-4">
        {header}
        <div className="card py-10 text-center text-sm text-muted">
          {m === null
            ? "Loading metrics…"
            : "Metrics warming up — Prometheus has no samples for this app yet."}
        </div>
      </div>
    );
  }

  const cpuNow = summedLast(m.cpu);
  const memNow = summedLast(m.memory);
  const cpuPct = pctOfLimit(cpuNow, m.cpuLimitCores);
  const memPct = pctOfLimit(memNow, m.memLimitBytes);

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-3 gap-4">
        <Tile
          label="CPU"
          value={fmtCores(cpuNow)}
          sub={cpuPct != null ? `${cpuPct}% of limit` : "no limit set"}
        />
        <Tile
          label="Memory"
          value={fmtBytes(memNow)}
          sub={memPct != null ? `${memPct}% of limit` : "no limit set"}
        />
        <Tile
          label="Restarts"
          value={String(m.restarts ?? 0)}
          danger={(m.restarts ?? 0) > 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="CPU" current={fmtCores(cpuNow)}>
          <PerPodArea series={m.cpu ?? []} fmt={fmtCores} />
        </ChartCard>
        <ChartCard title="Memory" current={fmtBytes(memNow)}>
          <PerPodArea series={m.memory ?? []} fmt={fmtBytes} />
        </ChartCard>
      </div>

      <ChartCard title="Network">
        <LineChart
          data={netRows}
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
          <YAxis tickFormatter={(v) => fmtBps(v as number)} width={72} {...axisProps} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(t) => fmtTime(t as number)}
            formatter={(v, name) => [fmtBps(v as number), name]}
          />
          <Line
            type="monotone"
            dataKey="rx"
            name="in"
            stroke="#34d399"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="tx"
            name="out"
            stroke="#60a5fa"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ChartCard>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={`mt-1 font-mono text-lg ${danger ? "text-danger" : "text-foreground"}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
