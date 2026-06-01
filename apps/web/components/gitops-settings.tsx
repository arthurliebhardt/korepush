"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  connectGitOpsRepoAction,
  disconnectGitOpsRepoAction,
} from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";

type Source = {
  name: string;
  repoUrl: string | null;
  branch: string | null;
  revision: string | null;
  ready: boolean | null;
  message: string | null;
};

/** Connect a git repo of korepush manifests — korepush sets up Flux behind the
 *  scenes, so no kubectl. Lists connected sources with their sync status. */
export function GitOpsSettings({ sources }: { sources: Source[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="card space-y-4">
      {sources.length > 0 && (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li
              key={s.name}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-xs">
                    {s.repoUrl ?? s.name}
                  </span>
                  <StatusBadge
                    status={
                      s.ready === false
                        ? "failed"
                        : s.ready
                          ? "running"
                          : "provisioning"
                    }
                  />
                </div>
                <p className="truncate font-mono text-[11px] text-muted">
                  {s.branch}
                  {s.revision ? ` @ ${s.revision}` : ""}
                  {s.ready === false && s.message ? ` — ${s.message}` : ""}
                </p>
              </div>
              <button
                className="btn-ghost text-xs"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await disconnectGitOpsRepoAction(s.name);
                    router.refresh();
                  })
                }
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input
          className="input min-w-[16rem] flex-1"
          placeholder="https://github.com/org/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="input w-28"
          placeholder="branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        />
        <button
          className="btn-primary"
          disabled={pending || !url.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await connectGitOpsRepoAction({
                url: url.trim(),
                branch: branch.trim() || "main",
              });
              if (res.ok) {
                setUrl("");
                router.refresh();
              } else {
                setError(res.error);
              }
            })
          }
        >
          {pending ? "Connecting…" : "Connect"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-xs text-muted">
        Point korepush at a repo of KoreApp / KoreSpace / KoreDatabase manifests.
        Flux syncs them; synced apps appear in the dashboard tagged GitOps
        (read-only — change them in the repo).
      </p>
    </div>
  );
}
