"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addEnvironmentAction } from "@/app/actions";

/**
 * Adds a branch-mapped environment to a git app (e.g. a `dev` env tracking the
 * `dev` branch). On success, routes to the new environment's build page.
 */
export function AddEnvironment({
  spaceSlug,
  appSlug,
}: {
  spaceSlug: string;
  appSlug: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [envName, setEnvName] = useState("dev");
  const [branch, setBranch] = useState("dev");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button className="btn-ghost text-xs" onClick={() => setOpen(true)}>
        + Add environment
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className="input w-28"
        placeholder="name (dev)"
        value={envName}
        onChange={(e) => setEnvName(e.target.value)}
      />
      <span className="text-xs text-muted">←</span>
      <input
        className="input w-32"
        placeholder="branch"
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
      />
      <button
        className="btn-primary"
        disabled={pending || !envName.trim() || !branch.trim()}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await addEnvironmentAction({
              spaceSlug,
              appSlug,
              branch: branch.trim(),
              envName: envName.trim(),
            });
            if (res.ok) {
              router.push(
                `/spaces/${spaceSlug}/apps/${res.appSlug}?build=${res.deploymentId}`,
              );
            } else {
              setError(res.error);
            }
          })
        }
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <button className="btn-ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
