"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  previewComposeAction,
  importComposeAction,
  previewReImportStackAction,
  reImportStackAction,
} from "@/app/actions";

type CreatePreview = Awaited<ReturnType<typeof previewComposeAction>>;
type ReimportPreview = Awaited<ReturnType<typeof previewReImportStackAction>>;
type ImportRes = Awaited<ReturnType<typeof importComposeAction>>;
type ReimportRes = Awaited<ReturnType<typeof reImportStackAction>>;

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

export function ComposeImport({
  spaceSlug,
  stackSlug,
  stackName: stackNameProp,
  initialYaml,
}: {
  spaceSlug: string;
  stackSlug?: string;
  stackName?: string;
  initialYaml?: string;
}) {
  const reimport = !!stackSlug;
  const [yaml, setYaml] = useState(initialYaml ?? "");
  const [stackName, setStackName] = useState(stackNameProp ?? "compose");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [createPreview, setCreatePreview] = useState<CreatePreview | null>(null);
  const [reimportPreview, setReimportPreview] = useState<ReimportPreview | null>(null);
  const [results, setResults] = useState<ImportRes | ReimportRes | null>(null);
  const [pending, startTransition] = useTransition();

  function resetPreview() {
    setCreatePreview(null);
    setReimportPreview(null);
    setConfirmRemove(false);
  }

  function doPreview() {
    if (!yaml.trim()) return;
    setResults(null);
    startTransition(async () => {
      if (reimport) {
        setReimportPreview(await previewReImportStackAction(spaceSlug, stackSlug!, yaml));
      } else {
        setCreatePreview(await previewComposeAction(spaceSlug, yaml, stackName));
      }
    });
  }
  function doImport() {
    startTransition(async () => {
      const res = reimport
        ? await reImportStackAction(spaceSlug, stackSlug!, yaml, confirmRemove)
        : await importComposeAction(spaceSlug, yaml, stackName);
      setResults(res);
      resetPreview();
    });
  }

  // ── Results view (shared) ──
  if (results) {
    const tally = results.results.reduce(
      (acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc),
      {} as Record<string, number>,
    );
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          {results.stackName ? `Stack "${results.stackName}"` : "Import results"}
          {results.results.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted">
              {[
                tally.created && `${tally.created} added`,
                tally.updated && `${tally.updated} updated`,
                tally.removed && `${tally.removed} removed`,
                tally.failed && `${tally.failed} failed`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </h2>
        {!results.ok && results.error && (
          <p className="text-sm text-danger">{results.error}</p>
        )}
        {results.results.length > 0 && (
          <ul className="panel divide-y divide-border">
            {results.results.map((r) => (
              <li
                key={`${r.kind}-${r.service}-${r.status}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className={STATUS_CLR[r.status] ?? "text-muted"}>
                    {STATUS_GLYPH[r.status] ?? "•"}
                  </span>
                  <span className="font-medium">{r.service}</span>
                  <span className="text-xs text-muted">
                    {r.kind} {r.status}
                  </span>
                </span>
                {(r.status === "created" || r.status === "updated") && r.slug ? (
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
                ) : r.error ? (
                  <span className="truncate text-xs text-danger">{r.error}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          {results.stackSlug ? (
            <Link
              href={`/spaces/${spaceSlug}/stacks/${results.stackSlug}`}
              className="btn-primary"
            >
              View stack
            </Link>
          ) : (
            <Link href={`/spaces/${spaceSlug}/apps`} className="btn-primary">
              View apps
            </Link>
          )}
          <button
            className="btn-ghost"
            onClick={() => {
              setResults(null);
              if (!reimport) {
                setYaml("");
                setStackName("compose");
              }
            }}
          >
            {reimport ? "Edit again" : "Import another"}
          </button>
        </div>
      </div>
    );
  }

  const createOk = createPreview?.ok ? createPreview : null;
  const createCount =
    (createOk?.apps.length ?? 0) + (createOk?.databases.length ?? 0);
  const createImportable =
    !!createOk &&
    createCount > 0 &&
    createOk.collisions.length === 0 &&
    !createOk.stackCollision &&
    !!stackName.trim();

  const reOk = reimportPreview?.ok ? reimportPreview : null;
  const reApplicable =
    !!reOk &&
    reOk.diff.hasChanges &&
    reOk.diff.newCollisions.length === 0 &&
    (!reOk.diff.hasDestructive || confirmRemove);

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Stack name</label>
        {reimport ? (
          <p className="font-medium">{stackName}</p>
        ) : (
          <input
            className="input w-full sm:w-72"
            placeholder="compose"
            value={stackName}
            onChange={(e) => {
              setStackName(e.target.value);
              resetPreview();
            }}
          />
        )}
        <p className="mt-1 text-xs text-muted">
          {reimport
            ? "Re-importing diffs this compose against the stack's current members and applies the changes."
            : "All imported services are grouped under this stack — manage and delete them together."}
        </p>
      </div>

      <div>
        <label className="label">Paste your docker-compose.yml</label>
        <textarea
          className="input resize-y font-mono text-xs"
          rows={12}
          placeholder={EXAMPLE}
          value={yaml}
          spellCheck={false}
          onChange={(e) => {
            setYaml(e.target.value);
            resetPreview();
          }}
        />
        <p className="mt-1 text-xs text-muted">
          Each service becomes a korepush app; a Postgres or Redis service becomes
          a managed database, and named volumes become persistent disks. Builds
          and host bind-mounts aren&apos;t supported.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          className="btn-primary"
          onClick={doPreview}
          disabled={pending || !yaml.trim()}
        >
          {pending && !createPreview && !reimportPreview
            ? "Parsing…"
            : reimport
              ? "Preview changes"
              : "Preview"}
        </button>
        {!reimport && !yaml.trim() && (
          <button className="btn-ghost" onClick={() => setYaml(EXAMPLE)}>
            Use example
          </button>
        )}
      </div>

      {/* errors */}
      {createPreview && !createPreview.ok && (
        <p className="text-sm text-danger">{createPreview.error}</p>
      )}
      {reimportPreview && !reimportPreview.ok && (
        <p className="text-sm text-danger">{reimportPreview.error}</p>
      )}

      {/* ── CREATE-mode preview ── */}
      {createOk && (
        <div className="space-y-3">
          <div className="card space-y-3">
            <h3 className="text-sm font-medium text-muted">
              Will create {createCount} item{createCount === 1 ? "" : "s"}
            </h3>
            <ul className="space-y-2">
              {createOk.databases.map((d) => (
                <li key={`db-${d.service}`} className="flex items-center gap-2 text-sm">
                  <span className="badge bg-info/15 text-info-fg">database</span>
                  <span className="font-medium">{d.slug}</span>
                  <span className="text-xs text-muted">
                    {d.engine === "redis" ? "managed Redis" : "managed Postgres (CNPG)"}
                  </span>
                </li>
              ))}
              {createOk.apps.map((a) => (
                <li key={`app-${a.service}`} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge bg-surface-2 text-muted">app</span>
                    <span className="font-medium">{a.slug}</span>
                    <span className="font-mono text-xs text-muted">
                      {a.image} :{a.port}
                    </span>
                    {a.attachDatabaseService && (
                      <span className="text-xs text-success-fg">
                        → {a.attachDatabaseService} as $
                        {createOk.databases.find(
                          (d) => d.service === a.attachDatabaseService,
                        )?.engine === "redis"
                          ? "REDIS_URL"
                          : "DATABASE_URL"}
                      </span>
                    )}
                    {a.volumes && a.volumes.length > 0 && (
                      <span className="text-xs text-info-fg">
                        vol: {a.volumes.map((v) => `${v.name}→${v.mountPath}`).join(" · ")}
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
          {createOk.collisions.length > 0 && (
            <p className="text-sm text-danger">
              Already exists in this space: {createOk.collisions.join(", ")} —
              rename those services and preview again.
            </p>
          )}
          {createOk.stackCollision && (
            <p className="text-sm text-danger">
              A stack named &quot;{stackName}&quot; already exists — choose a
              different stack name.
            </p>
          )}
          <button className="btn-primary" onClick={doImport} disabled={pending || !createImportable}>
            {pending ? "Importing…" : `Import ${createCount} item${createCount === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {/* ── RE-IMPORT diff ── */}
      {reOk && (
        <div className="space-y-3">
          {!reOk.diff.hasChanges ? (
            <p className="card text-sm text-muted">
              No changes detected — the stack already matches this compose file.
            </p>
          ) : (
            <>
              {(reOk.diff.apps.add.length > 0 || reOk.diff.databases.add.length > 0) && (
                <div className="card space-y-1.5">
                  <h3 className="text-sm font-medium text-success-fg">To add</h3>
                  {reOk.diff.databases.add.map((d) => (
                    <div key={`add-db-${d.slug}`} className="text-sm">
                      <span className="badge bg-info/15 text-info-fg">database</span>{" "}
                      <span className="font-medium">{d.slug}</span>{" "}
                      <span className="text-xs text-muted">{d.engine}</span>
                    </div>
                  ))}
                  {reOk.diff.apps.add.map((a) => (
                    <div key={`add-app-${a.slug}`} className="text-sm">
                      <span className="badge bg-surface-2 text-muted">app</span>{" "}
                      <span className="font-medium">{a.slug}</span>{" "}
                      <span className="font-mono text-xs text-muted">{a.image}</span>
                    </div>
                  ))}
                </div>
              )}

              {reOk.diff.apps.update.length > 0 && (
                <div className="card space-y-2">
                  <h3 className="text-sm font-medium text-warn-fg">To update</h3>
                  {reOk.diff.apps.update.map((u) => (
                    <div key={`upd-${u.slug}`} className="text-sm">
                      <span className="font-medium">{u.slug}</span>
                      <div className="ml-2 mt-1 flex flex-wrap gap-1.5">
                        {u.changes.map((c, i) => (
                          <span
                            key={i}
                            className={`badge text-xs ${c.field === "port" ? "bg-warn/15 text-warn-fg" : "bg-surface-2 text-muted"}`}
                          >
                            {c.field}: {c.from} → {c.to}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-fg-faint">
                    Note: secret env values can&apos;t be diffed — only key add/remove
                    is detected. Port changes aren&apos;t applied in place (recreate
                    the app to change its port).
                  </p>
                </div>
              )}

              {reOk.diff.databases.warn.length > 0 && (
                <div className="card space-y-1">
                  {reOk.diff.databases.warn.map((w) => (
                    <p key={`warn-${w.slug}`} className="text-xs text-warn-fg">
                      <span className="font-medium">{w.slug}</span>: {w.message}
                    </p>
                  ))}
                </div>
              )}

              {reOk.diff.hasDestructive && (
                <div className="card space-y-2 border-danger/40">
                  <h3 className="text-sm font-medium text-danger-fg">
                    Destructive — permanently deletes data
                  </h3>
                  {reOk.diff.apps.remove.map((r) => (
                    <p key={`rm-app-${r.slug}`} className="text-sm">
                      <span className="text-danger-fg">Delete app</span>{" "}
                      <span className="font-medium">{r.name}</span>
                      {r.hasData && (
                        <span className="text-xs text-muted"> (has persistent volumes)</span>
                      )}
                    </p>
                  ))}
                  {reOk.diff.databases.remove.map((r) => {
                    const blast = reOk.blastRadius.find((b) => b.db === r.slug);
                    return (
                      <p key={`rm-db-${r.slug}`} className="text-sm">
                        <span className="text-danger-fg">Delete database</span>{" "}
                        <span className="font-medium">{r.name}</span>
                        {blast && blast.apps.length > 0 && (
                          <span className="text-xs text-muted">
                            {" "}
                            — also detaches &amp; restarts: {blast.apps.join(", ")}
                          </span>
                        )}
                      </p>
                    );
                  })}
                  {reOk.diff.apps.update
                    .filter((u) => u.removedVolumes.length > 0)
                    .map((u) => (
                      <p key={`rm-vol-${u.slug}`} className="text-sm">
                        <span className="text-danger-fg">Delete volume(s)</span>{" "}
                        {u.removedVolumes.join(", ")} from{" "}
                        <span className="font-medium">{u.slug}</span>
                      </p>
                    ))}
                  <label className="flex items-start gap-2 pt-1 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={confirmRemove}
                      onChange={(e) => setConfirmRemove(e.target.checked)}
                    />
                    <span>
                      I understand this permanently deletes the listed data and
                      cannot be undone.
                    </span>
                  </label>
                </div>
              )}

              {reOk.diff.newCollisions.length > 0 && (
                <p className="text-sm text-danger">
                  These services collide with resources outside this stack:{" "}
                  {reOk.diff.newCollisions.join(", ")} — rename them.
                </p>
              )}

              <button className="btn-primary" onClick={doImport} disabled={pending || !reApplicable}>
                {pending ? "Applying…" : "Apply changes"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_GLYPH: Record<string, string> = {
  created: "✓",
  updated: "~",
  removed: "🗑",
  failed: "✗",
};
const STATUS_CLR: Record<string, string> = {
  created: "text-success-fg",
  updated: "text-warn-fg",
  removed: "text-muted",
  failed: "text-danger",
};
