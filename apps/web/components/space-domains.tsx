"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addAppDomainAction, removeAppDomainAction } from "@/app/actions";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

type DomainRow = {
  id: string;
  host: string;
  status: string;
  useStaging: boolean;
  appSlug: string;
  appName: string;
};

// Space-level domains: add a custom domain to any app in the space (a domain
// always points at one app), see them grouped by app, and remove them. Detailed
// per-domain provisioning still lives on the app's Settings tab.
export function SpaceDomains({
  spaceSlug,
  apps,
  serverIp,
  domains,
}: {
  spaceSlug: string;
  apps: { slug: string; name: string }[];
  serverIp: string | null;
  domains: DomainRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [appSlug, setAppSlug] = useState(apps[0]?.slug ?? "");
  const [host, setHost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byApp = new Map<string, { appName: string; rows: DomainRow[] }>();
  for (const d of domains) {
    const g = byApp.get(d.appSlug);
    if (g) g.rows.push(d);
    else byApp.set(d.appSlug, { appName: d.appName, rows: [d] });
  }

  function add() {
    setError(null);
    const added = host.trim();
    if (!appSlug) {
      setError("Pick an app for this domain.");
      return;
    }
    startTransition(async () => {
      const res = await addAppDomainAction(spaceSlug, appSlug, added);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setHost("");
      setOpen(false);
      toast.success(`${added} added — point its DNS here`);
      router.refresh();
    });
  }

  async function remove(slug: string, h: string) {
    const ok = await confirmDialog({
      title: `Remove ${h}?`,
      body: "Its HTTPS certificate and routing for this app will be torn down.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await removeAppDomainAction(spaceSlug, slug, h);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${h} removed`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {domains.length === 0
            ? "No custom domains yet."
            : `${domains.length} custom ${domains.length === 1 ? "domain" : "domains"}.`}
        </p>
        {apps.length > 0 && (
          <button className="btn-primary" onClick={() => setOpen((o) => !o)}>
            Add domain
          </button>
        )}
      </div>

      {apps.length === 0 ? (
        <EmptyState
          title="Deploy an app first"
          description="A custom domain points at an app. Once you have one, you can add a domain here."
        />
      ) : open ? (
        <div className="card space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
            <div>
              <label className="label">App</label>
              <select
                className="input"
                value={appSlug}
                onChange={(e) => setAppSlug(e.target.value)}
              >
                {apps.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Domain</label>
              <input
                autoFocus
                className="input font-mono text-sm"
                placeholder="shop.example.com"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              className="btn-ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={pending || !host.trim()}
              onClick={add}
            >
              {pending ? "Adding…" : "Add domain"}
            </button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <p className="text-xs text-muted">
            After adding, point its DNS at this server
            {serverIp ? (
              <>
                {" "}
                (an <span className="font-mono">A</span> record to{" "}
                <span className="font-mono">{serverIp}</span>)
              </>
            ) : null}
            . HTTPS is issued automatically via Let&apos;s Encrypt once DNS
            resolves.
          </p>
        </div>
      ) : null}

      {domains.length > 0 && (
        <ul className="space-y-3">
          {[...byApp.entries()].map(([slug, { appName, rows }]) => (
            <li key={slug} className="card">
              <div className="mb-3 font-medium">{appName}</div>
              <ul className="space-y-2">
                {rows.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-lg border border-border px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-mono text-sm">
                        {d.host}
                        {d.useStaging && (
                          <span className="ml-2 text-xs text-muted">
                            (staging)
                          </span>
                        )}
                      </span>
                      <div className="flex shrink-0 items-center gap-3">
                        <StatusBadge status={d.status} />
                        <button
                          className="text-xs text-muted transition-colors hover:text-danger"
                          disabled={pending}
                          onClick={() => remove(d.appSlug, d.host)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {d.status === "pending" && serverIp && (
                      <p className="mt-1.5 font-mono text-xs text-muted">
                        Point DNS here: <span className="text-foreground">A</span>{" "}
                        {d.host} →{" "}
                        <span className="text-foreground">{serverIp}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
