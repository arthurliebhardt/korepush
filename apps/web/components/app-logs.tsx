"use client";

import { useEffect, useRef, useState } from "react";
import { LogLine } from "@/components/log-line";

// Live runtime logs viewer (the /logs SSE). Auto-tails only when pinned to the
// bottom, so scrolling up to read earlier output isn't interrupted.
export function AppLogs({
  spaceSlug,
  appSlug,
}: {
  spaceSlug: string;
  appSlug: string;
}) {
  const base = `/api/spaces/${spaceSlug}/apps/${appSlug}`;
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const onScroll = () => {
    const el = logRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

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
    if (pinnedRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }
  }, [logs]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm text-muted">
        <span className="size-1.5 animate-pulse rounded-full bg-success" />
        Live logs
      </div>
      <div
        ref={logRef}
        onScroll={onScroll}
        className="h-[28rem] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-muted-2"
      >
        {logs.length === 0 ? (
          <span className="text-muted">Waiting for log output…</span>
        ) : (
          logs.map((line, i) => <LogLine key={i} line={line} />)
        )}
      </div>
    </div>
  );
}
