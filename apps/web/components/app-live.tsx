"use client";

import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { LogLine } from "@/components/log-line";

type StatusMsg = {
  phase: string;
  ready?: number;
  desired?: number;
  pods?: { name?: string; phase?: string; restarts?: number }[];
};

export function AppLive({
  spaceSlug,
  appSlug,
  initialStatus,
}: {
  spaceSlug: string;
  appSlug: string;
  initialStatus: string;
}) {
  const base = `/api/spaces/${spaceSlug}/apps/${appSlug}`;
  const [status, setStatus] = useState<StatusMsg>({ phase: initialStatus });
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const onScroll = () => {
    const el = logRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const es = new EventSource(`${base}/status`);
    es.onmessage = (e) => {
      try {
        setStatus(JSON.parse(e.data));
      } catch {}
    };
    return () => es.close();
  }, [base]);

  useEffect(() => {
    const es = new EventSource(`${base}/logs`);
    const onLog = (e: MessageEvent) =>
      setLogs((prev) => [...prev.slice(-2000), e.data]);
    const onStatus = (e: MessageEvent) =>
      setLogs((prev) => [...prev.slice(-2000), `── ${e.data} ──`]);
    es.addEventListener("log", onLog as EventListener);
    es.addEventListener("status", onStatus as EventListener);
    return () => es.close();
  }, [base]);

  useEffect(() => {
    // Only auto-tail when the user is pinned to the bottom — don't yank them
    // back down while they're scrolled up reading earlier output.
    if (pinnedRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }
  }, [logs]);

  return (
    <div className="space-y-5">
      <div className="card flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Status</span>
          <StatusBadge status={status.phase} />
        </div>
        <div className="text-sm text-muted">
          Replicas:{" "}
          <span className="text-foreground">
            {status.ready ?? 0}/{status.desired ?? 0}
          </span>
        </div>
        {status.pods && status.pods.length > 0 && (
          <div className="text-sm text-muted">
            Pods:{" "}
            <span className="font-mono text-xs text-foreground">
              {status.pods
                .map((p) => `${p.phase}${p.restarts ? ` (${p.restarts}↻)` : ""}`)
                .join(", ")}
            </span>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted">
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
          Live logs
        </div>
        <div
          ref={logRef}
          onScroll={onScroll}
          className="h-96 overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-muted-2"
        >
          {logs.length === 0 ? (
            <span className="text-muted">Waiting for log output…</span>
          ) : (
            logs.map((line, i) => <LogLine key={i} line={line} />)
          )}
        </div>
      </div>
    </div>
  );
}
