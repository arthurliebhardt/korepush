"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rollbackAction } from "@/app/actions";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";

export function RollbackButton({
  spaceSlug,
  appSlug,
  deploymentId,
  tag,
}: {
  spaceSlug: string;
  appSlug: string;
  deploymentId: string;
  tag: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <button
        className="text-xs text-muted hover:text-foreground"
        disabled={pending}
        onClick={async () => {
          const ok = await confirmDialog({
            title: `Roll back to ${tag}?`,
            body: "Re-points the app to that image without rebuilding — code only; current env vars are kept.",
            confirmLabel: "Roll back",
          });
          if (!ok) return;
          setError(null);
          startTransition(async () => {
            const res = await rollbackAction(spaceSlug, appSlug, deploymentId);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            toast.success(`Rolling back to ${tag}`);
            router.refresh();
          });
        }}
      >
        {pending ? "Rolling back…" : "Rollback"}
      </button>
    </div>
  );
}
