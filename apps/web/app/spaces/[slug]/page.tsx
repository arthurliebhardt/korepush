import Link from "next/link";
import { requireSpacePage } from "@/lib/session";
import {
  listApps,
  listDatabases,
  getDatabaseInfo,
  getSpaceMetrics,
  listKoreAppPhases,
  lastDeployedAt,
  phaseToStatus,
} from "@korepush/k8s";
import { listAllConnectedRepos } from "@/lib/github/app";
import { StatusBadge } from "@/components/status-badge";
import { BlankEnvBadge } from "@/components/blank-env-badge";
import { CreateApp } from "@/components/create-app";
import { CreateDatabase } from "@/components/create-database";
import { DatabaseCard } from "@/components/database-card";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { DeleteSpace } from "@/components/delete-space";
import { blankEnvKeys } from "@/lib/env-warnings";

export const dynamic = "force-dynamic";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const isAdmin = (session.user as { role?: string }).role === "admin";

  // All independent of one another given `space` — fetch in parallel (Postgres,
  // k8s API, Prometheus, GitHub) instead of serially blocking first paint.
  const [appRows, phases, usage, repoRows, dbRows] = await Promise.all([
    listApps(space.id),
    // Badge from the operator's live CR status.phase (the DB status is only a
    // mutation-time mirror); fall back to it when a CR has no phase yet.
    listKoreAppPhases(space.namespace).catch((): Record<string, string> => ({})),
    getSpaceMetrics(space.namespace).catch(() => null),
    // Connected GitHub repos for the deploy picker (VM can reach GitHub outbound).
    listAllConnectedRepos().catch(() => []),
    listDatabases(space.id),
  ]);
  const apps = appRows.map((a) => ({
    ...a,
    status: phaseToStatus(phases[a.slug]) ?? a.status,
  }));
  const lastDeploy = await lastDeployedAt(appRows.map((a) => a.id));
  // Group environments of one app (shared projectId) into a single card; a
  // single-environment app is one group of size 1 and renders as before.
  const projectMap = new Map<string, typeof apps>();
  for (const a of apps) {
    const g = projectMap.get(a.projectId);
    if (g) g.push(a);
    else projectMap.set(a.projectId, [a]);
  }
  const projects = [...projectMap.values()];
  const baseDomain = process.env.KOREPUSH_BASE_DOMAIN ?? "localhost";
  const repos = repoRows.map((r) => ({
    fullName: r.fullName,
    cloneUrl: r.cloneUrl,
    defaultBranch: r.defaultBranch,
  }));

  const databases = await Promise.all(
    dbRows.map(async (d) => {
      const info = await getDatabaseInfo(space.namespace, d.slug).catch(() => ({
        ready: false,
        phase: "provisioning",
        connectionUri: null,
        host: null,
      }));
      const status = info.ready
        ? "running"
        : info.phase === "failed"
          ? "failed"
          : "provisioning";
      return { ...d, status, info };
    }),
  );

  return (
    <AppShell
      email={session.user.email}
      isAdmin={isAdmin}
      userId={session.user.id}
      activeSpaceSlug={space.slug}
      crumbs={[{ label: "Spaces", href: "/" }, { label: space.name }]}
    >
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{space.name}</h1>
          <StatusBadge status={space.status} />
          <span className="font-mono text-xs text-muted">
            {space.namespace}
          </span>
        </div>
      </div>

      {/* Always rendered (placeholders when metrics aren't ready) so the page
          doesn't shift when Prometheus data arrives. */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <UsageTile label="CPU" value={usage?.ok ? fmtCores(usage.cpuCores) : "—"} />
        <UsageTile
          label="Memory"
          value={usage?.ok ? fmtBytes(usage.memoryBytes) : "—"}
        />
        <UsageTile label="Pods" value={usage?.ok ? String(usage.pods) : "—"} />
        <UsageTile
          label="Restarts"
          value={usage?.ok ? String(usage.restarts) : "—"}
        />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">Apps</h2>
        <CreateApp spaceSlug={space.slug} repos={repos} />
      </div>

      {apps.length === 0 ? (
        <EmptyState
          title="No apps yet"
          description="Deploy your first app from a container image or a GitHub repo."
        />
      ) : (
        <ul className="space-y-3">
          {projects.map((group) => {
            if (group.length === 1) {
              const app = group[0];
              return (
                <li key={app.id}>
                  <Link
                    href={`/spaces/${space.slug}/apps/${app.slug}`}
                    className="card card-interactive flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{app.name}</span>
                        <StatusBadge status={app.status} />
                        <BlankEnvBadge
                          keys={blankEnvKeys(app.env)}
                          dbEnvVar={app.dbEnvVar}
                        />
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-muted">
                        {app.slug}.{space.slug}.{baseDomain}
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
            // Multi-environment app: one card, an environment per row.
            const root = group.find((a) => a.environment === "prod") ?? group[0];
            return (
              <li key={root.projectId} className="card">
                <div className="mb-3 font-medium">{root.name}</div>
                <ul className="space-y-2">
                  {group.map((env) => (
                    <li key={env.id}>
                      <Link
                        href={`/spaces/${space.slug}/apps/${env.slug}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-border-strong"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-xs font-medium uppercase text-muted">
                            {env.environment}
                          </span>
                          <StatusBadge status={env.status} />
                          <BlankEnvBadge
                            keys={blankEnvKeys(env.env)}
                            dbEnvVar={env.dbEnvVar}
                          />
                          <span className="font-mono text-xs text-muted">
                            {env.gitRef}
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="font-mono text-xs text-muted">
                            {env.slug}.{space.slug}.{baseDomain}
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
      )}

      <div className="mt-10 mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">Databases</h2>
        <CreateDatabase spaceSlug={space.slug} />
      </div>

      {databases.length === 0 ? (
        <EmptyState
          title="No databases yet"
          description="Create a Postgres database to attach to your apps."
        />
      ) : (
        <ul className="space-y-3">
          {databases.map((d) => (
            <li key={d.id}>
              <DatabaseCard
                spaceSlug={space.slug}
                slug={d.slug}
                name={d.name}
                status={d.status}
                connectionUri={d.info.connectionUri}
                host={d.info.host}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-12">
        <DeleteSpace slug={space.slug} name={space.name} />
      </div>
      </main>
    </AppShell>
  );
}

function UsageTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg text-foreground">{value}</div>
    </div>
  );
}

function timeAgo(date?: Date): string {
  if (!date) return "";
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtCores(n: number): string {
  return n >= 1 ? `${n.toFixed(2)} cores` : `${Math.round(n * 1000)} m`;
}

function fmtBytes(n: number): string {
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
