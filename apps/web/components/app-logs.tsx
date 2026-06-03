"use client";

import { useEffect, useState } from "react";
import { LogViewer } from "@/components/ui/log-viewer";

// Live runtime logs (the /logs SSE) rendered through the shared LogViewer.
export function AppLogs({
  spaceSlug,
  appSlug,
}: {
  spaceSlug: string;
  appSlug: string;
}) {
  const base = `/api/spaces/${spaceSlug}/apps/${appSlug}`;
  const [logs, setLogs] = useState<string[]>([]);

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

  return (
    <LogViewer
      lines={logs}
      title="Live logs"
      live
      filename={`${appSlug}-logs.txt`}
    />
  );
}
