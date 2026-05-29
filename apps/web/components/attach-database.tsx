"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attachDatabaseAction, detachDatabaseAction } from "@/app/actions";

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
  const [pending, startTransition] = useTransition();
  const attached = databases.find((d) => d.id === attachedDbId);

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Database</span>
      </div>

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
            onClick={() =>
              startTransition(async () => {
                await detachDatabaseAction(spaceSlug, appSlug);
                router.refresh();
              })
            }
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
            onClick={() =>
              startTransition(async () => {
                await attachDatabaseAction(spaceSlug, appSlug, selected);
                router.refresh();
              })
            }
          >
            {pending ? "Attaching…" : "Attach as DATABASE_URL"}
          </button>
        </div>
      )}
    </div>
  );
}
