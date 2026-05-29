"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";

export function BuildLogs({
  spaceSlug,
  appSlug,
  deploymentId,
}: {
  spaceSlug: string;
  appSlug: string;
  deploymentId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("building");
  const [note, setNote] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(
      `/api/spaces/${spaceSlug}/apps/${appSlug}/builds/${deploymentId}/logs`,
    );
    es.addEventListener("status", (e) => setNote((e as MessageEvent).data));
    es.addEventListener("log", (e) =>
      setLogs((prev) => [...prev.slice(-3000), (e as MessageEvent).data]),
    );
    es.addEventListener("done", (e) => {
      const s = (e as MessageEvent).data;
      setStatus(s);
      es.close();
      // Reflect the deployed app (or failure) once the build settles.
      setTimeout(() => router.refresh(), 1200);
    });
    return () => es.close();
  }, [spaceSlug, appSlug, deploymentId, router]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  return (
    <div className="space-y-3">
      <div className="card flex items-center gap-3">
        <span className="text-sm text-muted">Build</span>
        <StatusBadge status={status} />
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      <div
        ref={logRef}
        className="h-96 overflow-auto rounded-xl border border-border bg-black p-4 font-mono text-xs leading-relaxed text-zinc-300"
      >
        {logs.length === 0 ? (
          <span className="text-muted">Waiting for build output…</span>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
