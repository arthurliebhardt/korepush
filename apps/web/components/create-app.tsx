"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAppAction, createGitAppAction } from "@/app/actions";

type Mode = "image" | "git";
type Repo = { fullName: string; cloneUrl: string; defaultBranch: string };

export function CreateApp({
  spaceSlug,
  repos = [],
}: {
  spaceSlug: string;
  repos?: Repo[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("git");
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [gitRef, setGitRef] = useState("main");
  const [port, setPort] = useState("3000");
  // Use the repo picker when repos are connected; allow falling back to a URL.
  const [manualUrl, setManualUrl] = useState(repos.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pickRepo(fullName: string) {
    const r = repos.find((x) => x.fullName === fullName);
    if (!r) return;
    setRepoUrl(r.cloneUrl);
    setGitRef(r.defaultBranch || "main");
    if (!name) setName(r.fullName.split("/").pop() ?? "");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "git" && !repoUrl) {
      setError("Pick a repository or enter a URL.");
      return;
    }
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

  const usePicker = mode === "git" && repos.length > 0 && !manualUrl;

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
        ) : usePicker ? (
          <>
            <div>
              <label className="label">Repository</label>
              <select
                autoFocus
                className="input"
                defaultValue=""
                onChange={(e) => pickRepo(e.target.value)}
              >
                <option value="" disabled>
                  Select a repo…
                </option>
                {repos.map((r) => (
                  <option key={r.fullName} value={r.fullName}>
                    {r.fullName}
                  </option>
                ))}
              </select>
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

      {mode === "git" && repos.length > 0 && (
        <button
          type="button"
          className="text-xs text-muted underline hover:text-foreground"
          onClick={() => {
            setManualUrl(!manualUrl);
            setRepoUrl("");
          }}
        >
          {manualUrl ? "Pick from connected GitHub repos" : "Enter a URL instead"}
        </button>
      )}

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
