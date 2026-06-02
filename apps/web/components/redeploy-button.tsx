"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { redeployAction } from "@/app/actions";

export function RedeployButton({
  spaceSlug,
  appSlug,
}: {
  spaceSlug: string;
  appSlug: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <button
        className="btn-ghost"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await redeployAction(spaceSlug, appSlug);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.push(
              `/spaces/${spaceSlug}/apps/${appSlug}?build=${res.deploymentId}`,
            );
          });
        }}
      >
        {pending ? "Starting…" : "Redeploy"}
      </button>
    </div>
  );
}
