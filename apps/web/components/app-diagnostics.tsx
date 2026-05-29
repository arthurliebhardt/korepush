"use client";

import { useEffect, useState } from "react";

type ContainerDiag = {
  pod: string;
  container: string;
  ready: boolean;
  restarts: number;
  state: string;
  waitingReason?: string;
  waitingMessage?: string;
  lastExitCode?: number;
  lastReason?: string;
  lastFinishedAt?: string;
};
type AppEvent = {
  type: string;
  reason: string;
  message: string;
  object: string;
  count: number;
  lastSeen: string | null;
};
type Diag = { ok: boolean; containers?: ContainerDiag[]; events?: AppEvent[] };

const DANGER_WAITING = new Set([
  "ImagePullBackOff",
  "ErrImagePull",
  "CrashLoopBackOff",
  "CreateContainerConfigError",
  "CreateContainerError",
]);

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function issueFor(c: ContainerDiag): { text: string; danger: boolean } | null {
  if (c.waitingReason) {
    return {
      text: `${c.waitingReason}${c.waitingMessage ? ` — ${c.waitingMessage}` : ""}`,
      danger: DANGER_WAITING.has(c.waitingReason),
    };
  }
  if (c.lastReason && c.lastReason !== "Completed") {
    const exit =
      c.lastExitCode != null ? ` (exit ${c.lastExitCode})` : "";
    return {
      text: `Last crash: ${c.lastReason}${exit}${c.restarts ? ` · ${c.restarts} restart${c.restarts > 1 ? "s" : ""}` : ""}`,
      danger: c.lastReason === "OOMKilled" || (c.lastExitCode ?? 0) !== 0,
    };
  }
  if (c.restarts > 0) {
    return { text: `${c.restarts} restart${c.restarts > 1 ? "s" : ""}`, danger: false };
  }
  return null;
}

export function AppDiagnostics({
  spaceSlug,
  appSlug,
}: {
  spaceSlug: string;
  appSlug: string;
}) {
  const [diag, setDiag] = useState<Diag | null>(null);

  useEffect(() => {
    const es = new EventSource(
      `/api/spaces/${spaceSlug}/apps/${appSlug}/diagnostics`,
    );
    es.onmessage = (e) => {
      try {
        setDiag(JSON.parse(e.data));
      } catch {}
    };
    return () => es.close();
  }, [spaceSlug, appSlug]);

  const issues = (diag?.containers ?? [])
    .map((c) => ({ c, issue: issueFor(c) }))
    .filter((x) => x.issue);
  const events = diag?.events ?? [];

  return (
    <div className="card space-y-3">
      <span className="text-sm font-medium">Diagnostics</span>

      {issues.length > 0 ? (
        <div className="space-y-1.5">
          {issues.map(({ c, issue }) => (
            <div
              key={`${c.pod}/${c.container}`}
              className={`rounded-md border px-3 py-2 text-xs ${
                issue!.danger
                  ? "border-danger/40 text-danger"
                  : "border-warn/40 text-warn"
              }`}
            >
              <span className="font-mono text-foreground">{c.pod}</span> —{" "}
              {issue!.text}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No crashes or restarts detected.</p>
      )}

      <div>
        <div className="mb-1 text-xs text-muted">Recent events</div>
        <div className="h-48 overflow-auto rounded-xl border border-border bg-black p-3 font-mono text-xs leading-relaxed text-zinc-300">
          {events.length === 0 ? (
            <span className="text-muted">No recent events.</span>
          ) : (
            events.map((e, i) => (
              <div key={i} className="whitespace-pre-wrap break-words">
                <span
                  className={
                    e.type === "Warning" ? "text-warn" : "text-zinc-500"
                  }
                >
                  [{e.type}]
                </span>{" "}
                {e.reason} · {e.message}
                {e.count > 1 ? ` · ${e.count}×` : ""}{" "}
                <span className="text-zinc-600">{timeAgo(e.lastSeen)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
