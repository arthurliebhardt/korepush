"use client";

import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/status-badge";

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
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
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
          className="h-96 overflow-auto rounded-xl border border-border bg-black p-4 font-mono text-xs leading-relaxed text-zinc-300"
        >
          {logs.length === 0 ? (
            <span className="text-muted">Waiting for log output…</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
