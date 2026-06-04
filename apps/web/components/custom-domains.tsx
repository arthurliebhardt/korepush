"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  addAppDomainAction,
  removeAppDomainAction,
  refreshAppDomainsAction,
  type AppDomainView,
} from "@/app/actions";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "active", cls: "text-success" },
  issuing: { label: "issuing cert…", cls: "text-warn" },
  pending: { label: "waiting for DNS", cls: "text-muted" },
  error: { label: "error", cls: "text-danger" },
};

export function CustomDomains({
  spaceSlug,
  appSlug,
  initial,
  serverIp,
  autoHost,
}: {
  spaceSlug: string;
  appSlug: string;
  initial: AppDomainView[];
  serverIp: string | null;
  autoHost: string;
}) {
  const [domains, setDomains] = useState<AppDomainView[]>(initial);
  const [host, setHost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const domainsRef = useRef(domains);
  useEffect(() => {
    domainsRef.current = domains;
  }, [domains]);

  // Poll while any domain is still provisioning (DNS/cert in flight).
  useEffect(() => {
    const id = setInterval(() => {
      const inFlight = domainsRef.current.some(
        (d) => d.status === "pending" || d.status === "issuing",
      );
      if (!inFlight) return;
      refreshAppDomainsAction(spaceSlug, appSlug)
        .then(setDomains)
        .catch(() => {});
    }, 6000);
    return () => clearInterval(id);
  }, [spaceSlug, appSlug]);

  function add() {
    setError(null);
    const added = host;
    startTransition(async () => {
      const res = await addAppDomainAction(spaceSlug, appSlug, host);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setHost("");
      setDomains(await refreshAppDomainsAction(spaceSlug, appSlug));
      toast.success(`${added} added — point its DNS here`);
    });
  }

  async function remove(h: string) {
    const ok = await confirmDialog({
      title: `Remove ${h}?`,
      body: "Its HTTPS certificate and routing for this app will be torn down.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await removeAppDomainAction(spaceSlug, appSlug, h);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${h} removed`);
      setDomains(await refreshAppDomainsAction(spaceSlug, appSlug));
    });
  }

  return (
    <div className="card space-y-3">
      <span className="text-sm font-medium">Custom domains</span>

      <p className="text-xs text-muted">
        Default URL:{" "}
        <code className="font-mono text-foreground">{autoHost}</code>
      </p>

      {domains.length > 0 && (
        <ul className="space-y-2">
          {domains.map((d) => {
            const s = STATUS[d.status] ?? STATUS.pending;
            return (
              <li key={d.host} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm">{d.host}</span>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${s.cls}`}>
                      {s.label}
                      {d.useStaging ? " (staging)" : ""}
                    </span>
                    <button
                      className="text-xs text-muted hover:text-danger"
                      disabled={pending}
                      onClick={() => remove(d.host)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {d.status === "pending" && (
                  <p className="mt-1.5 font-mono text-xs text-muted">
                    Point DNS here: <span className="text-foreground">A</span>{" "}
                    {d.host} →{" "}
                    <span className="text-foreground">
                      {serverIp ?? "your server's IP"}
                    </span>
                  </p>
                )}
                {d.status === "error" && d.statusMessage && (
                  <p className="mt-1.5 text-xs text-danger">{d.statusMessage}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          className="input flex-1 font-mono text-xs"
          placeholder="shop.example.com"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <button className="btn-primary" disabled={pending || !host} onClick={add}>
          {pending ? "…" : "Add"}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-muted">
        Add a domain, then point its DNS at this server
        {serverIp ? (
          <>
            {" "}
            (an <span className="font-mono">A</span> record to{" "}
            <span className="font-mono">{serverIp}</span>)
          </>
        ) : null}
        . HTTPS is issued automatically via Let&apos;s Encrypt once DNS resolves.
      </p>
    </div>
  );
}
