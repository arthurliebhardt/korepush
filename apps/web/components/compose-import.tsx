"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { previewComposeAction, importComposeAction } from "@/app/actions";

type Preview = Awaited<ReturnType<typeof previewComposeAction>>;
type ImportRes = Awaited<ReturnType<typeof importComposeAction>>;

const EXAMPLE = `services:
  web:
    image: nginx:alpine
    ports: ["80"]
    environment:
      API_URL: http://api:8080
  api:
    image: myorg/api:latest
    ports: ["8080"]
    environment:
      DATABASE_URL: postgres://db:5432/app
    depends_on: [db]
  db:
    image: postgres:16`;

export function ComposeImport({ spaceSlug }: { spaceSlug: string }) {
  const [yaml, setYaml] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [results, setResults] = useState<ImportRes | null>(null);
  const [pending, startTransition] = useTransition();

  function doPreview() {
    if (!yaml.trim()) return;
    setResults(null);
    startTransition(async () => {
      setPreview(await previewComposeAction(spaceSlug, yaml));
    });
  }
  function doImport() {
    startTransition(async () => {
      const res = await importComposeAction(spaceSlug, yaml);
      setResults(res);
      setPreview(null);
    });
  }

  const importable =
    preview?.ok &&
    (preview.apps.length > 0 || preview.databases.length > 0) &&
    preview.collisions.length === 0;
  const count =
    (preview?.apps.length ?? 0) + (preview?.databases.length ?? 0);

  if (results) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-medium">Import results</h2>
        <ul className="panel divide-y divide-border">
          {results.results.map((r) => (
            <li
              key={`${r.kind}-${r.service}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="flex items-center gap-2">
                <span
                  className={
                    r.status === "created" ? "text-success-fg" : "text-danger"
                  }
                >
                  {r.status === "created" ? "✓" : "✗"}
                </span>
                <span className="font-medium">{r.service}</span>
                <span className="text-xs text-muted">{r.kind}</span>
              </span>
              {r.status === "created" && r.slug ? (
                <Link
                  href={
                    r.kind === "database"
                      ? `/spaces/${spaceSlug}/databases/${r.slug}`
                      : `/spaces/${spaceSlug}/apps/${r.slug}`
                  }
                  className="text-xs text-muted hover:text-foreground"
                >
                  Open →
                </Link>
              ) : (
                <span className="truncate text-xs text-danger">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Link href={`/spaces/${spaceSlug}/apps`} className="btn-primary">
            View apps
          </Link>
          <button
            className="btn-ghost"
            onClick={() => {
              setResults(null);
              setYaml("");
            }}
          >
            Import another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Paste your docker-compose.yml</label>
        <textarea
          className="input resize-y font-mono text-xs"
          rows={10}
          placeholder={EXAMPLE}
          value={yaml}
          spellCheck={false}
          onChange={(e) => {
            setYaml(e.target.value);
            setPreview(null);
          }}
        />
        <p className="mt-1 text-xs text-muted">
          Each service becomes a korepush app; a Postgres service becomes a
          managed database, and named volumes become persistent disks. Builds
          and host bind-mounts aren&apos;t supported.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          className="btn-primary"
          onClick={doPreview}
          disabled={pending || !yaml.trim()}
        >
          {pending && !preview ? "Parsing…" : "Preview"}
        </button>
        {!yaml.trim() && (
          <button className="btn-ghost" onClick={() => setYaml(EXAMPLE)}>
            Use example
          </button>
        )}
      </div>

      {preview && !preview.ok && (
        <p className="text-sm text-danger">{preview.error}</p>
      )}

      {preview?.ok && (
        <div className="space-y-3">
          <div className="card space-y-3">
            <h3 className="text-sm font-medium text-muted">
              Will create {count} item{count === 1 ? "" : "s"}
            </h3>
            <ul className="space-y-2">
              {preview.databases.map((d) => (
                <li
                  key={`db-${d.service}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="badge bg-info/15 text-info-fg">database</span>
                  <span className="font-medium">{d.slug}</span>
                  <span className="text-xs text-muted">
                    {d.engine === "redis" ? "managed Redis" : "managed Postgres (CNPG)"}
                  </span>
                </li>
              ))}
              {preview.apps.map((a) => (
                <li key={`app-${a.service}`} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge bg-surface-2 text-muted">app</span>
                    <span className="font-medium">{a.slug}</span>
                    <span className="font-mono text-xs text-muted">
                      {a.image} :{a.port}
                    </span>
                    {(a.cpuLimit || a.memoryLimit) && (
                      <span className="text-xs text-muted">
                        {[
                          a.cpuLimit && `cpu ${a.cpuLimit}`,
                          a.memoryLimit && `mem ${a.memoryLimit}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                    {a.attachDatabaseService && (
                      <span className="text-xs text-success-fg">
                        → {a.attachDatabaseService} as $
                        {preview.databases.find(
                          (d) => d.service === a.attachDatabaseService,
                        )?.engine === "redis"
                          ? "REDIS_URL"
                          : "DATABASE_URL"}
                      </span>
                    )}
                    {a.volumes && a.volumes.length > 0 && (
                      <span className="text-xs text-info-fg">
                        vol:{" "}
                        {a.volumes
                          .map((v) => `${v.name}→${v.mountPath} (${v.size})`)
                          .join(" · ")}
                      </span>
                    )}
                  </div>
                  {a.warnings.length > 0 && (
                    <ul className="ml-12 mt-1 list-disc space-y-0.5 text-xs text-warn-fg">
                      {a.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {preview.skipped.length > 0 && (
            <div className="card space-y-1">
              <h3 className="text-sm font-medium text-muted">Skipped</h3>
              {preview.skipped.map((s) => (
                <p key={s.service} className="text-xs text-fg-subtle">
                  <span className="text-muted">{s.service}</span> — {s.reason}
                </p>
              ))}
            </div>
          )}

          {preview.warnings.map((w, i) => (
            <p key={i} className="text-xs text-warn-fg">
              {w}
            </p>
          ))}
          {preview.collisions.length > 0 && (
            <p className="text-sm text-danger">
              Already exists in this space: {preview.collisions.join(", ")} —
              rename those services and preview again.
            </p>
          )}

          <button
            className="btn-primary"
            onClick={doImport}
            disabled={pending || !importable}
          >
            {pending ? "Importing…" : `Import ${count} item${count === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
