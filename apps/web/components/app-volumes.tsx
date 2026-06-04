"use client";

import { useRef, useState, useTransition } from "react";
import { setAppVolumesAction } from "@/app/actions";
import type { VolumeSpec } from "@korepush/k8s";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";

type Row = VolumeSpec & { id: number; existing: boolean };

export function AppVolumes({
  spaceSlug,
  appSlug,
  initial,
}: {
  spaceSlug: string;
  appSlug: string;
  initial: VolumeSpec[];
}) {
  const nextId = useRef(0);
  const [rows, setRows] = useState<Row[]>(
    initial.map((v) => ({ ...v, id: nextId.current++, existing: true })),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const initialNames = new Set(initial.map((v) => v.name));

  function add() {
    setRows((rs) => [
      ...rs,
      { id: nextId.current++, name: "", mountPath: "", size: "1Gi", existing: false },
    ]);
  }
  function update(id: number, patch: Partial<VolumeSpec>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function remove(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  async function save() {
    setError(null);
    const desired = rows
      .filter((r) => r.name.trim() && r.mountPath.trim())
      .map((r) => ({ name: r.name.trim(), mountPath: r.mountPath.trim(), size: r.size.trim() || "1Gi" }));

    // Warn if any existing volume is being dropped — that deletes its data.
    const keptNames = new Set(desired.map((v) => v.name));
    const dropped = [...initialNames].filter((n) => !keptNames.has(n));
    if (dropped.length > 0) {
      const ok = await confirmDialog({
        title: `Delete volume${dropped.length > 1 ? "s" : ""} ${dropped.join(", ")}?`,
        body: "This permanently destroys the stored data — the underlying PersistentVolumeClaim is deleted and cannot be recovered.",
        confirmLabel: "Delete & save",
        danger: true,
      });
      if (!ok) return;
    }

    startTransition(async () => {
      const res = await setAppVolumesAction(spaceSlug, appSlug, desired);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows(desired.map((v) => ({ ...v, id: nextId.current++, existing: true })));
      toast.success("Volumes updated — the app is redeploying");
    });
  }

  return (
    <div className="card space-y-3">
      <span className="text-sm font-medium">Persistent volumes</span>

      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <input
                className="input w-28 font-mono text-xs"
                placeholder="data"
                value={r.name}
                disabled={r.existing}
                onChange={(e) => update(r.id, { name: e.target.value })}
              />
              <input
                className="input flex-1 font-mono text-xs"
                placeholder="/data"
                value={r.mountPath}
                disabled={r.existing}
                onChange={(e) => update(r.id, { mountPath: e.target.value })}
              />
              <input
                className="input w-20 font-mono text-xs"
                placeholder="1Gi"
                value={r.size}
                disabled={r.existing}
                onChange={(e) => update(r.id, { size: e.target.value })}
              />
              <button
                className="text-xs text-muted hover:text-danger"
                disabled={pending}
                onClick={() => remove(r.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">
          No volumes — this app&apos;s storage is ephemeral (lost on restart).
        </p>
      )}

      <div className="flex items-center gap-3">
        <button className="btn-ghost text-xs" disabled={pending} onClick={add}>
          + Add volume
        </button>
        <button className="btn-primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save & redeploy"}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-muted">
        Stored on local-path (single-node, ReadWriteOnce). An app with a volume
        runs 1 replica and redeploys with brief downtime. Existing volumes
        can&apos;t be resized; removing one deletes its data.
      </p>
    </div>
  );
}
