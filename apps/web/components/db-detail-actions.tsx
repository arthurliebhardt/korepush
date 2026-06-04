"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import {
  attachDatabaseAction,
  detachDatabaseAction,
  deleteDatabaseAction,
} from "@/app/actions";

export function CopyButton({
  text,
  label = "Copy connection string",
  toastMsg = "Connection string copied",
}: {
  text: string;
  label?: string;
  toastMsg?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-ghost shrink-0 px-2 py-1 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          toast.success(toastMsg);
        } catch {
          toast.error("Couldn't copy to clipboard");
        }
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

export function DetachAppButton({
  spaceSlug,
  appSlug,
  appName,
  dbName,
}: {
  spaceSlug: string;
  appSlug: string;
  appName: string;
  dbName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="text-xs text-muted transition-colors hover:text-danger"
      disabled={pending}
      onClick={async () => {
        const ok = await confirmDialog({
          title: `Detach "${dbName}" from ${appName}?`,
          body: "The app keeps running but loses the injected connection string on its next deploy.",
          confirmLabel: "Detach",
          danger: true,
        });
        if (!ok) return;
        startTransition(async () => {
          const res = await detachDatabaseAction(spaceSlug, appSlug);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(`Detached from ${appName}`);
          router.refresh();
        });
      }}
    >
      {pending ? "Detaching…" : "Detach"}
    </button>
  );
}

export function AttachDbToApp({
  spaceSlug,
  databaseId,
  apps,
}: {
  spaceSlug: string;
  databaseId: string;
  apps: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <select
        className="input w-56"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="" disabled>
          Attach to an app…
        </option>
        {apps.map((a) => (
          <option key={a.slug} value={a.slug}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        className="btn-primary"
        disabled={pending || !selected}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await attachDatabaseAction(spaceSlug, selected, databaseId);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            toast.success("Database attached");
            router.refresh();
          });
        }}
      >
        {pending ? "Attaching…" : "Attach"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function DeleteDatabaseButton({
  spaceSlug,
  slug,
  name,
}: {
  spaceSlug: string;
  slug: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="btn-danger"
      disabled={pending}
      onClick={async () => {
        const ok = await confirmDialog({
          title: `Delete database "${name}"?`,
          body: "This permanently destroys its data and detaches it from any apps using it.",
          confirmLabel: "Delete database",
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
          router.push(`/spaces/${spaceSlug}/databases`);
          router.refresh();
        });
      }}
    >
      {pending ? "Deleting…" : "Delete database"}
    </button>
  );
}
