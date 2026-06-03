"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { LogViewer } from "@/components/ui/log-viewer";

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
  const [settled, setSettled] = useState(false);
  const [note, setNote] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);

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
      setSettled(true);
      es.close();
      // Reflect the deployed app (or failure) once the build settles.
      setTimeout(() => router.refresh(), 1200);
    });
    return () => es.close();
  }, [spaceSlug, appSlug, deploymentId, router]);

  // Safety net for the build→running transition: if the `done` event is missed
  // (dropped stream, build finished while unwatched, Job-status lag), poll-refresh
  // so the server re-finalizes the build and swaps in the live view. `buildId`
  // stays constant while building, so this re-render keeps BuildLogs mounted (the
  // log SSE + scroll are untouched); it unmounts only once the deployment leaves
  // "building". Tied to this deployment, so it's redeploy-safe.
  useEffect(() => {
    if (settled) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [settled, router]);

  return (
    <div className="space-y-3">
      <div className="card flex items-center gap-3">
        <span className="text-sm text-muted">Build</span>
        <StatusBadge status={status} />
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      <LogViewer lines={logs} filename={`build-${appSlug}.txt`} />
    </div>
  );
}
