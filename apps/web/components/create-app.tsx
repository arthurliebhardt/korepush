"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAppAction, createGitAppAction } from "@/app/actions";

type Mode = "image" | "git";

export function CreateApp({ spaceSlug }: { spaceSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("git");
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [gitRef, setGitRef] = useState("main");
  const [port, setPort] = useState("3000");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (mode === "image") {
        const res = await createAppAction({
          spaceSlug,
          name,
          image,
          port: Number(port) || 80,
        });
        if (!res.ok) return setError(res.error);
        setOpen(false);
        router.refresh();
      } else {
        const res = await createGitAppAction({
          spaceSlug,
          name,
          repoUrl,
          gitRef: gitRef || "main",
          port: Number(port) || 3000,
        });
        if (!res.ok) return setError(res.error);
        router.push(
          `/spaces/${spaceSlug}/apps/${res.appSlug}?build=${res.deploymentId}`,
        );
      }
    });
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        Deploy app
      </button>
    );
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`rounded-md px-3 py-1.5 text-sm ${
        mode === m ? "bg-surface-2 text-foreground" : "text-muted"
      }`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="flex gap-1 rounded-lg border border-border p-1 w-fit">
        {tab("git", "From Git repo")}
        {tab("image", "From image")}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Name</label>
          <input
            autoFocus
            className="input"
            placeholder="web"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        {mode === "image" ? (
          <div className="sm:col-span-2">
            <label className="label">Image</label>
            <input
              className="input"
              placeholder="nginx:alpine"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              required
            />
          </div>
        ) : (
          <>
            <div>
              <label className="label">Git repository URL</label>
              <input
                className="input"
                placeholder="https://github.com/acme/app.git"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Branch</label>
              <input
                className="input"
                placeholder="main"
                value={gitRef}
                onChange={(e) => setGitRef(e.target.value)}
              />
            </div>
          </>
        )}
        <div>
          <label className="label">Container port</label>
          <input
            className="input"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
      </div>

      {mode === "git" && (
        <p className="text-xs text-muted">
          Built in-cluster with BuildKit — uses your Dockerfile if present,
          otherwise Railpack auto-detects the stack. Build logs stream live.
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Starting…" : mode === "git" ? "Build & deploy" : "Deploy"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
