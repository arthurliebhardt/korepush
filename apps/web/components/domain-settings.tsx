"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDomainAction } from "@/app/actions";

export function DomainSettings({ hosts }: { hosts: string[] }) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await setDomainAction(domain);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(domain);
      setDomain("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-1">
        <p className="text-sm text-muted">Currently reachable at</p>
        {hosts.length === 0 ? (
          <p className="font-mono text-sm">
            this server&apos;s IP{" "}
            <span className="text-muted">(catch-all, HTTP)</span>
          </p>
        ) : (
          <ul className="font-mono text-sm">
            <li>
              this server&apos;s IP <span className="text-muted">(catch-all)</span>
            </li>
            {hosts.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={submit} className="card space-y-3">
        <div>
          <label className="label" htmlFor="domain">
            Add a custom domain
          </label>
          <input
            id="domain"
            className="input"
            placeholder="kube.example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
          <p className="mt-1.5 text-xs text-muted">
            Point this domain&apos;s DNS A record at this server first. The IP
            URL keeps working, so you won&apos;t get locked out.
          </p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {done && (
          <p className="text-sm text-success">
            Added {done}. Control plane is restarting — it&apos;ll answer at
            http://{done} once DNS resolves here.
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Applying…" : "Add domain"}
        </button>
      </form>
    </div>
  );
}
