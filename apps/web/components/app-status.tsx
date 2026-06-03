"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";

type StatusMsg = {
  phase: string;
  ready?: number;
  desired?: number;
  pods?: { name?: string; phase?: string; restarts?: number }[];
};

// Live runtime status card (replicas + pods), driven by the /status SSE.
export function AppStatus({
  spaceSlug,
  appSlug,
  initialStatus,
}: {
  spaceSlug: string;
  appSlug: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState<StatusMsg>({ phase: initialStatus });

  useEffect(() => {
    const es = new EventSource(`/api/spaces/${spaceSlug}/apps/${appSlug}/status`);
    es.onmessage = (e) => {
      try {
        setStatus(JSON.parse(e.data));
      } catch {}
    };
    return () => es.close();
  }, [spaceSlug, appSlug]);

  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Status</span>
        <StatusBadge status={status.phase} />
      </div>
      <div className="text-sm text-muted">
        Replicas:{" "}
        <span className="font-mono text-foreground">
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
  );
}
