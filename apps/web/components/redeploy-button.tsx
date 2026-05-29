"use client";

import { useTransition } from "react";
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

  return (
    <button
      className="btn-ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await redeployAction(spaceSlug, appSlug);
          if (res.ok) {
            router.push(
              `/spaces/${spaceSlug}/apps/${appSlug}?build=${res.deploymentId}`,
            );
          }
        })
      }
    >
      {pending ? "Starting…" : "Redeploy"}
    </button>
  );
}
