"use client";

import { memo, useState } from "react";

// Renders one log line. Structured JSON logs (e.g. Caddy/pino access logs) are
// collapsed to a readable summary — time · level · "METHOD /path → status · dur"
// or time · level · message — with click-to-expand for the full pretty JSON.
// Anything that isn't a JSON object falls back to the raw text.

const LEVEL_COLOR: Record<string, string> = {
  error: "text-danger-fg",
  err: "text-danger-fg",
  fatal: "text-danger-fg",
  critical: "text-danger-fg",
  panic: "text-danger-fg",
  warn: "text-warn-fg",
  warning: "text-warn-fg",
  info: "text-info-fg",
  debug: "text-fg-subtle",
  trace: "text-fg-subtle",
};

type ParsedLog = {
  obj?: Record<string, unknown>;
  level?: string;
  time?: string;
  msg?: string;
  method?: string;
  status?: number;
  path?: string;
  dur?: number;
};

function fmtTime(v: unknown): string | undefined {
  let d: Date | null = null;
  if (typeof v === "number") d = new Date(v > 1e12 ? v : v * 1000); // s or ms epoch
  else if (typeof v === "string") d = new Date(v);
  return d && !isNaN(d.getTime()) ? d.toLocaleTimeString() : undefined;
}

function fmtDur(d: number): string {
  const ms = d < 10 ? d * 1000 : d; // <10 ⇒ seconds (Caddy/Go); else already ms
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${Math.round(ms)}ms`;
  return `${Math.round(ms * 1000)}µs`;
}

function parse(line: string): ParsedLog {
  const t = line.trim();
  if (t[0] !== "{" || t[t.length - 1] !== "}") return {};
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(t);
  } catch {
    return {};
  }
  const req = (o.request as Record<string, unknown>) ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const lvl = str(o.level ?? o.lvl ?? o.severity ?? o.levelname)?.toLowerCase();
  return {
    obj: o,
    level: lvl,
    time: fmtTime(o.ts ?? o.time ?? o.timestamp ?? o["@timestamp"]),
    msg: str(o.msg ?? o.message),
    method: str(o.method ?? req.method),
    status: num(o.status ?? req.status ?? (o.response as Record<string, unknown>)?.status),
    path: str(o.uri ?? o.path ?? o.url ?? req.uri ?? req.path),
    dur: num(o.duration ?? o.latency ?? o.elapsed),
  };
}

export const LogLine = memo(function LogLine({
  line,
  wrap = true,
}: {
  line: string;
  wrap?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const p = parse(line);

  if (!p.obj) {
    return (
      <div className={wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}>
        {line}
      </div>
    );
  }

  const levelColor = (p.level && LEVEL_COLOR[p.level]) || "text-muted";
  const isHttp = !!(p.method || p.path || p.status != null);
  const statusColor =
    p.status == null
      ? ""
      : p.status >= 500
        ? "text-danger-fg"
        : p.status >= 400
          ? "text-warn-fg"
          : "text-success-fg";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-2 rounded px-1 text-left hover:bg-white/5"
        title="Click to expand"
      >
        {p.time && <span className="shrink-0 text-zinc-600">{p.time}</span>}
        {p.level && (
          <span className={`w-10 shrink-0 uppercase ${levelColor}`}>{p.level}</span>
        )}
        {isHttp ? (
          <span className="truncate">
            {p.method && <span className="text-zinc-300">{p.method} </span>}
            <span className="text-zinc-400">{p.path}</span>
            {p.status != null && <span className={statusColor}> {p.status}</span>}
            {p.dur != null && <span className="text-zinc-600"> · {fmtDur(p.dur)}</span>}
          </span>
        ) : (
          <span className="truncate text-zinc-300">{p.msg ?? line}</span>
        )}
      </button>
      {open && (
        <pre className="mt-1 mb-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-white/5 p-2 text-zinc-400">
          {JSON.stringify(p.obj, null, 2)}
        </pre>
      )}
    </div>
  );
});
