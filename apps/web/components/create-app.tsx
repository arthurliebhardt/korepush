"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createAppAction,
  createGitAppAction,
  detectProjectAction,
} from "@/app/actions";
import { ComposeImport } from "@/components/compose-import";

type Mode = "image" | "git" | "compose";
type Repo = { fullName: string; cloneUrl: string; defaultBranch: string };
type Detection = {
  framework: string;
  builder: "dockerfile" | "railpack";
  detectedPort: number | null;
  scripts: { install?: string; build?: string; start?: string };
  envKeys: string[];
  hasCommittedConfig: boolean;
  packageManager?: string;
};
type EnvRow = { id: number; key: string; value: string; secret: boolean };

export function CreateApp({
  spaceSlug,
  repos = [],
  databases = [],
  embedded = false,
}: {
  spaceSlug: string;
  repos?: Repo[];
  databases?: { id: string; name: string }[];
  embedded?: boolean;
}) {
  const router = useRouter();
  const nextId = useRef(0);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("git");
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [gitRef, setGitRef] = useState("main");
  const [port, setPort] = useState("");
  const [manualUrl, setManualUrl] = useState(repos.length === 0);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [installCmd, setInstallCmd] = useState("");
  const [buildCmd, setBuildCmd] = useState("");
  const [startCmd, setStartCmd] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [attachDbId, setAttachDbId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setStep(1);
    setDetection(null);
    setEnvRows([]);
    setInstallCmd("");
    setBuildCmd("");
    setStartCmd("");
    setShowAdvanced(false);
    setAttachDbId("");
    setError(null);
  }

  // Embedded (full-page /new) mode renders the form directly and returns to the
  // Apps list on cancel; inline mode collapses back to the trigger button.
  function cancel() {
    if (embedded) router.push(`/spaces/${spaceSlug}/apps`);
    else {
      setOpen(false);
      reset();
    }
  }

  function pickRepo(fullName: string) {
    const r = repos.find((x) => x.fullName === fullName);
    if (!r) return;
    setRepoUrl(r.cloneUrl);
    setGitRef(r.defaultBranch || "main");
    if (!name) setName(r.fullName.split("/").pop() ?? "");
  }

  function detectAndContinue() {
    setError(null);
    if (!repoUrl) {
      setError("Pick a repository or enter a URL.");
      return;
    }
    startTransition(async () => {
      const res = await detectProjectAction(repoUrl, gitRef || "main");
      const d = res.detection as Detection | null;
      setDetection(d);
      if (d?.detectedPort) setPort(String(d.detectedPort));
      setEnvRows(
        (d?.envKeys ?? []).map((key) => ({
          id: nextId.current++,
          key,
          value: "",
          secret: false,
        })),
      );
      setStep(2);
    });
  }

  function addEnvRow() {
    setEnvRows((rs) => [
      ...rs,
      { id: nextId.current++, key: "", value: "", secret: false },
    ]);
  }
  function updateEnvRow(id: number, patch: Partial<EnvRow>) {
    setEnvRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeEnvRow(id: number) {
    setEnvRows((rs) => rs.filter((r) => r.id !== id));
  }

  function submitImage(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createAppAction({
        spaceSlug,
        name,
        image,
        port: Number(port) || 80,
        env: envRows
          .filter((r) => r.key.trim())
          .map((r) => ({ key: r.key.trim(), value: r.value, secret: r.secret })),
        attachDatabaseId: attachDbId || undefined,
      });
      if (!res.ok) return setError(res.error);
      router.push(`/spaces/${spaceSlug}/apps/${res.appSlug}`);
    });
  }

  function submitGit() {
    setError(null);
    startTransition(async () => {
      const res = await createGitAppAction({
        spaceSlug,
        name,
        repoUrl,
        gitRef: gitRef || "main",
        port: port ? Number(port) : undefined,
        env: envRows
          .filter((r) => r.key.trim())
          .map((r) => ({ key: r.key.trim(), value: r.value, secret: r.secret })),
        installCmd: showAdvanced && installCmd ? installCmd : undefined,
        buildCmd: showAdvanced && buildCmd ? buildCmd : undefined,
        startCmd: showAdvanced && startCmd ? startCmd : undefined,
        attachDatabaseId: attachDbId || undefined,
      });
      if (!res.ok) return setError(res.error);
      router.push(
        `/spaces/${spaceSlug}/apps/${res.appSlug}?build=${res.deploymentId}`,
      );
    });
  }

  if (!open && !embedded) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        Deploy app
      </button>
    );
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        reset();
      }}
      className={`rounded-md px-3 py-1.5 text-sm ${
        mode === m ? "bg-surface-2 text-foreground" : "text-muted"
      }`}
    >
      {label}
    </button>
  );

  const usePicker = repos.length > 0 && !manualUrl;
  const railpackOverridable =
    detection && detection.builder === "railpack" && !detection.hasCommittedConfig;

  // Shared by the image form and the Git configure step.
  const envSection = (
    <div>
      <div className="mb-1.5 text-sm font-medium">Environment variables</div>
      {envRows.length === 0 ? (
        <p className="text-xs text-muted">None — add any your app needs.</p>
      ) : (
        <div className="space-y-2">
          {envRows.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <input
                className="input w-1/3 font-mono text-xs"
                placeholder="KEY"
                value={r.key}
                onChange={(e) => updateEnvRow(r.id, { key: e.target.value })}
              />
              <input
                className="input flex-1 font-mono text-xs"
                type={r.secret ? "password" : "text"}
                placeholder="value"
                value={r.value}
                onChange={(e) => updateEnvRow(r.id, { value: e.target.value })}
              />
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={r.secret}
                  onChange={(e) =>
                    updateEnvRow(r.id, { secret: e.target.checked })
                  }
                />
                secret
              </label>
              <button
                type="button"
                className="text-muted hover:text-danger"
                onClick={() => removeEnvRow(r.id)}
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="btn-ghost mt-2 text-xs"
        onClick={addEnvRow}
      >
        + Add variable
      </button>
    </div>
  );

  const dbSection = databases.length > 0 && (
    <div>
      <div className="mb-1.5 text-sm font-medium">Database</div>
      <select
        className="input w-full sm:w-72"
        value={attachDbId}
        onChange={(e) => setAttachDbId(e.target.value)}
      >
        <option value="">Don&apos;t attach a database</option>
        {databases.map((d) => (
          <option key={d.id} value={d.id}>
            Attach {d.name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-muted">
        Its connection string is injected as{" "}
        <code className="font-mono text-foreground">$DATABASE_URL</code>.
      </p>
    </div>
  );

  return (
    <div className="card space-y-4">
      <div className="flex gap-1 rounded-lg border border-border p-1 w-fit">
        {tab("git", "From Git repo")}
        {tab("image", "From image")}
        {tab("compose", "From Compose")}
      </div>

      {mode === "compose" ? (
        <ComposeImport spaceSlug={spaceSlug} />
      ) : mode === "image" ? (
        <form onSubmit={submitImage} className="space-y-3">
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
            <div>
              <label className="label">Image</label>
              <input
                className="input"
                placeholder="nginx:alpine"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Container port</label>
              <input
                className="input"
                type="number"
                placeholder="80"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>

          {envSection}
          {dbSection}

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Starting…" : "Deploy"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : step === 1 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {usePicker ? (
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
            ) : (
              <div>
                <label className="label">Git repository URL</label>
                <input
                  className="input"
                  placeholder="https://github.com/acme/app.git"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="label">Branch</label>
              <input
                className="input"
                placeholder="main"
                value={gitRef}
                onChange={(e) => setGitRef(e.target.value)}
              />
            </div>
          </div>
          {repos.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted underline hover:text-foreground"
              onClick={() => {
                setManualUrl(!manualUrl);
                setRepoUrl("");
              }}
            >
              {manualUrl
                ? "Pick from connected GitHub repos"
                : "Enter a URL instead"}
            </button>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={detectAndContinue}
            >
              {pending ? "Detecting…" : "Continue →"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {detection && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md border border-border px-2 py-1">
                Detected:{" "}
                <span className="text-foreground">{detection.framework}</span>
              </span>
              <span className="text-muted">
                built with{" "}
                {detection.builder === "dockerfile" ? "your Dockerfile" : "Railpack"}
                {detection.hasCommittedConfig ? " (committed config)" : ""}
                {detection.packageManager ? ` · ${detection.packageManager}` : ""}
              </span>
            </div>
          )}

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
            <div>
              <label className="label">Branch</label>
              <input
                className="input"
                value={gitRef}
                onChange={(e) => setGitRef(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Container port</label>
              <input
                className="input"
                type="number"
                placeholder="Auto"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>

          {envSection}
          {dbSection}

          {railpackOverridable && (
            <div>
              <button
                type="button"
                className="text-xs text-muted underline hover:text-foreground"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? "Hide" : "Override"} build &amp; run commands
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-2">
                  <input
                    className="input font-mono text-xs"
                    placeholder="Install command (auto)"
                    value={installCmd}
                    onChange={(e) => setInstallCmd(e.target.value)}
                  />
                  <input
                    className="input font-mono text-xs"
                    placeholder={detection?.scripts.build || "Build command (auto)"}
                    value={buildCmd}
                    onChange={(e) => setBuildCmd(e.target.value)}
                  />
                  <input
                    className="input font-mono text-xs"
                    placeholder={detection?.scripts.start || "Start command (auto)"}
                    value={startCmd}
                    onChange={(e) => setStartCmd(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted">
            Built in-cluster with BuildKit
            {detection?.builder === "dockerfile"
              ? " using your Dockerfile"
              : " via Railpack"}
            . Build logs stream live.
          </p>
          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={submitGit}
            >
              {pending ? "Starting…" : "Build & deploy"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => setStep(1)}
            >
              ← Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
