"use client";

import { useState } from "react";

type EnvVar = { name: string; value: string; secret: boolean };
type EffectiveEnv = { ok: boolean; pod: string | null; env: EnvVar[] };

export function AppEnv({
  spaceSlug,
  appSlug,
  initial,
}: {
  spaceSlug: string;
  appSlug: string;
  initial: EffectiveEnv;
}) {
  const [data, setData] = useState<EffectiveEnv>(initial);
  const [loading, setLoading] = useState(false);

  function refresh() {
    setLoading(true);
    fetch(`/api/spaces/${spaceSlug}/apps/${appSlug}/env`)
      .then((r) => r.json())
      .then((d: EffectiveEnv) => setData(d))
      .catch(() => setData({ ok: false, pod: null, env: [] }))
      .finally(() => setLoading(false));
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Runtime environment</span>
        <button
          type="button"
          className="text-xs text-muted hover:text-foreground"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {!data.ok || data.env.length === 0 ? (
        <p className="text-xs text-muted">
          {data.pod
            ? "No environment variables on the running pod."
            : "No running pod yet."}
        </p>
      ) : (
        <div className="space-y-1">
          {data.env.map((e) => (
            <div
              key={e.name}
              className="flex items-baseline gap-2 font-mono text-xs"
            >
              <span className="text-muted">{e.name}</span>
              <span className="text-zinc-600">=</span>
              {e.secret ? (
                <span className="italic text-zinc-500">•••• {e.value}</span>
              ) : (
                <span className="break-all text-foreground">{e.value}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">
        What the running pod actually has. Secret-backed values are masked.
      </p>
    </div>
  );
}
