"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attachDatabaseAction, detachDatabaseAction } from "@/app/actions";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";

type Db = { id: string; name: string };

export function AttachDatabase({
  spaceSlug,
  appSlug,
  databases,
  attachedDbId,
  dbEnvVar,
}: {
  spaceSlug: string;
  appSlug: string;
  databases: Db[];
  attachedDbId: string | null;
  dbEnvVar: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const attached = databases.find((d) => d.id === attachedDbId);

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Database</span>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {attached ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">
            <span className="text-foreground">{attached.name}</span> attached as{" "}
            <code className="font-mono text-xs text-foreground">
              ${dbEnvVar}
            </code>
          </p>
          <button
            className="text-xs text-muted hover:text-danger"
            disabled={pending}
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Detach database?",
                body: "The app redeploys without its injected DATABASE_URL.",
                confirmLabel: "Detach",
                danger: true,
              });
              if (!ok) return;
              setError(null);
              startTransition(async () => {
                const res = await detachDatabaseAction(spaceSlug, appSlug);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                toast.success("Database detached");
                router.refresh();
              });
            }}
          >
            {pending ? "…" : "Detach"}
          </button>
        </div>
      ) : databases.length === 0 ? (
        <p className="text-sm text-muted">
          No databases in this space yet. Create one to attach it.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <select
            className="input w-56"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="" disabled>
              Select a database…
            </option>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            className="btn-primary"
            disabled={pending || !selected}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await attachDatabaseAction(spaceSlug, appSlug, selected);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                toast.success("Database attached");
                router.refresh();
              });
            }}
          >
            {pending ? "Attaching…" : "Attach as DATABASE_URL"}
          </button>
        </div>
      )}
    </div>
  );
}
