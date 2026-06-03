"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { deleteDatabaseAction } from "@/app/actions";

export function DatabaseCard({
  spaceSlug,
  slug,
  name,
  status,
  connectionUri,
  host,
}: {
  spaceSlug: string;
  slug: string;
  name: string;
  status: string;
  connectionUri: string | null;
  host: string | null;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{name}</span>
          <span className="text-xs text-muted">postgres</span>
          <StatusBadge status={status} />
        </div>
        <button
          className="text-xs text-muted hover:text-danger"
          disabled={pending}
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Delete database "${name}"?`,
              body: "This permanently destroys its data and detaches it from any apps using it.",
              confirmLabel: "Delete",
              danger: true,
            });
            if (!ok) return;
            startTransition(async () => {
              const res = await deleteDatabaseAction(spaceSlug, slug);
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success(`Database "${name}" deleted`);
              router.refresh();
            });
          }}
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
      </div>

      {connectionUri ? (
        <div className="flex items-center gap-3">
          <code className="truncate font-mono text-xs text-muted">
            {host ?? "connection ready"}
          </code>
          <button
            className="btn-ghost shrink-0 px-2 py-1 text-xs"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(connectionUri);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
                toast.success("Connection string copied");
              } catch {
                toast.error("Couldn't copy to clipboard");
              }
            }}
          >
            {copied ? "Copied!" : "Copy connection string"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">Provisioning Postgres…</p>
      )}
    </div>
  );
}
