import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { BlankEnvBadge } from "@/components/blank-env-badge";
import { DatabaseIcon } from "@/components/ui/icons";
import { blankEnvKeys } from "@/lib/env-warnings";
import { timeAgo } from "@/lib/time";
import type { SpaceApp } from "@/lib/space-data";

type DbRef = { slug: string; name: string };

// The grouped apps list for a space (shared by the Apps section and the
// Overview roll-up). A single-environment project renders as one card; a
// multi-environment project renders one card with a row per environment.
export function SpaceApps({
  spaceSlug,
  projects,
  lastDeploy,
  dbById,
  baseDomain,
}: {
  spaceSlug: string;
  projects: SpaceApp[][];
  lastDeploy: Record<string, Date | undefined>;
  dbById: Map<string, DbRef>;
  baseDomain: string;
}) {
  return (
    <ul className="space-y-3">
      {projects.map((group) => {
        if (group.length === 1) {
          const app = group[0];
          return (
            <li key={app.id}>
              <Link
                href={`/spaces/${spaceSlug}/apps/${app.slug}`}
                className="card card-interactive flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{app.name}</span>
                    <StatusBadge status={app.status} />
                    <BlankEnvBadge
                      keys={blankEnvKeys(app.env)}
                      dbEnvVar={app.dbEnvVar}
                    />
                    <DbChip
                      spaceSlug={spaceSlug}
                      db={app.attachedDbId ? dbById.get(app.attachedDbId) : undefined}
                    />
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted">
                    {app.slug}.{spaceSlug}.{baseDomain}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-muted">
                  <div>:{app.port}</div>
                  {lastDeploy[app.id] && (
                    <div className="mt-1">{timeAgo(lastDeploy[app.id])}</div>
                  )}
                </div>
              </Link>
            </li>
          );
        }
        const root = group.find((a) => a.environment === "prod") ?? group[0];
        return (
          <li key={root.projectId} className="card">
            <div className="mb-3 font-medium">{root.name}</div>
            <ul className="space-y-2">
              {group.map((env) => (
                <li key={env.id}>
                  <Link
                    href={`/spaces/${spaceSlug}/apps/${env.slug}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-border-strong"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-xs font-medium uppercase text-muted">
                        {env.environment}
                      </span>
                      <StatusBadge status={env.status} />
                      <BlankEnvBadge
                        keys={blankEnvKeys(env.env)}
                        dbEnvVar={env.dbEnvVar}
                      />
                      <DbChip
                        spaceSlug={spaceSlug}
                        db={env.attachedDbId ? dbById.get(env.attachedDbId) : undefined}
                      />
                      <span className="font-mono text-xs text-muted">
                        {env.gitRef}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-xs text-muted">
                        {env.slug}.{spaceSlug}.{baseDomain}
                      </span>
                      {lastDeploy[env.id] && (
                        <div className="text-xs text-fg-subtle">
                          {timeAgo(lastDeploy[env.id])}
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function DbChip({
  spaceSlug,
  db,
}: {
  spaceSlug: string;
  db?: DbRef;
}) {
  if (!db) return null;
  return (
    <Link
      href={`/spaces/${spaceSlug}/databases/${db.slug}`}
      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-foreground [&_svg]:size-3"
      title={`Attached database: ${db.name}`}
    >
      <DatabaseIcon />
      {db.name}
    </Link>
  );
}
