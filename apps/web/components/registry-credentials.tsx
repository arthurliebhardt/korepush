"use client";

import { useState, useTransition } from "react";
import {
  addRegistryCredentialAction,
  removeRegistryCredentialAction,
} from "@/app/actions";
import type { RegistryCredential } from "@korepush/k8s";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";

export function RegistryCredentials({
  spaceSlug,
  initial,
}: {
  spaceSlug: string;
  initial: RegistryCredential[];
}) {
  const [creds, setCreds] = useState<RegistryCredential[]>(initial);
  const [registry, setRegistry] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setError(null);
    const host = registry.trim() || "docker.io";
    startTransition(async () => {
      const res = await addRegistryCredentialAction(
        spaceSlug,
        registry,
        username,
        password,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCreds((prev) => [
        ...prev.filter((c) => c.registry !== host),
        { registry: host, username: username.trim() },
      ]);
      setRegistry("");
      setUsername("");
      setPassword("");
      toast.success(`${host} credential saved`);
    });
  }

  async function remove(host: string) {
    const ok = await confirmDialog({
      title: `Remove ${host} credential?`,
      body: "New deployments in this space can no longer pull private images from this registry.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await removeRegistryCredentialAction(spaceSlug, host);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setCreds((prev) => prev.filter((c) => c.registry !== host));
      toast.success(`${host} credential removed`);
    });
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-sm font-medium">Registry credentials</h2>
        <p className="mt-1 text-xs text-muted">
          Add a login for a private container registry so apps in this space can
          pull private images. Public images need no credential.
        </p>
      </div>

      {creds.length > 0 && (
        <ul className="space-y-2">
          {creds.map((c) => (
            <li
              key={c.registry}
              className="flex items-center justify-between rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <span className="font-mono text-sm text-foreground">
                  {c.registry}
                </span>
                <span className="ml-2 text-xs text-muted">as {c.username}</span>
              </div>
              <button
                className="text-xs text-muted hover:text-danger"
                disabled={pending}
                onClick={() => remove(c.registry)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <input
          className="input font-mono text-xs"
          placeholder="registry (docker.io)"
          value={registry}
          onChange={(e) => setRegistry(e.target.value)}
        />
        <input
          className="input font-mono text-xs"
          placeholder="username"
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="input font-mono text-xs"
          placeholder="password / token"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          For ghcr.io / GitLab / Docker Hub, use a personal access token as the
          password.
        </p>
        <button
          className="btn-primary"
          disabled={pending || !username.trim() || !password}
          onClick={add}
        >
          {pending ? "…" : "Add"}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}
