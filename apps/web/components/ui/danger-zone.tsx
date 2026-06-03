"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";

type ActionResult = { ok: true } | { ok: false; error: string };

// Red-bordered destructive section with type-to-confirm (you must type the
// resource's slug before Delete enables). On success: toast + navigate away.
export function DangerZone({
  noun,
  name,
  confirmValue,
  description,
  onConfirm,
  redirectTo,
}: {
  noun: string;
  name: string;
  confirmValue: string;
  description?: string;
  onConfirm: () => Promise<ActionResult>;
  redirectTo: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 p-5">
      <h3 className="text-sm font-medium text-danger-fg">Danger zone</h3>
      <p className="mt-1 text-sm text-muted">
        {description ??
          `Deleting this ${noun} is permanent and cannot be undone.`}
      </p>
      {!open ? (
        <button className="btn-danger mt-3" onClick={() => setOpen(true)}>
          Delete {noun}
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="label">
            Type{" "}
            <code className="font-mono text-foreground">{confirmValue}</code> to
            confirm
          </label>
          <input
            className="input font-mono text-sm"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={confirmValue}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              className="btn-danger"
              disabled={val !== confirmValue || pending}
              onClick={() =>
                start(async () => {
                  const res = await onConfirm();
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(`${name} deleted`);
                  router.push(redirectTo);
                  router.refresh();
                })
              }
            >
              {pending ? "Deleting…" : `Delete ${noun}`}
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setOpen(false);
                setVal("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
