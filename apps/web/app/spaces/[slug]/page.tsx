import Link from "next/link";
import { requireSpacePage } from "@/lib/session";
import {
  getSpaceMetricsSeries,
  getSpaceWorkloadBreakdown,
  listAllDeployments,
} from "@korepush/k8s";
import { StatusBadge } from "@/components/status-badge";
import { AppShell } from "@/components/app-shell";
import { NewMenu } from "@/components/new-menu";
import { SpaceMetricsCharts } from "@/components/space-metrics-charts";
import { timeAgo, fmtDuration } from "@/lib/time";
import { getSpaceApps, getSpaceDatabases, getSpaceDomains } from "@/lib/space-data";

export const dynamic = "force-dynamic";

export default async function SpaceOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const [{ apps }, databases, domains, series, breakdown, allDeploys] =
    await Promise.all([
      getSpaceApps(space),
      getSpaceDatabases(space),
      getSpaceDomains(space),
      getSpaceMetricsSeries(space.namespace).catch(() => null),
      getSpaceWorkloadBreakdown(space.namespace).catch(() => []),
      listAllDeployments(space.ownerId).catch(() => []),
    ]);

  const unhealthy = apps.filter(
    (a) => a.status === "failed" || a.status === "degraded",
  ).length;
  const recentDeploys = allDeploys
    .filter((d) => d.spaceSlug === space.slug)
    .slice(0, 6);

  // Map pods → apps (longest slug first so "node" doesn't swallow "node-api").
  const sortedApps = [...apps].sort((a, b) => b.slug.length - a.slug.length);
  const usageByApp = new Map<
    string,
    { cpu: number; mem: number; restarts: number }
  >();
  for (const pod of breakdown) {
    const app = sortedApps.find((a) => pod.pod.startsWith(`${a.slug}-`));
    if (!app) continue;
    const cur = usageByApp.get(app.slug) ?? { cpu: 0, mem: 0, restarts: 0 };
    cur.cpu += pod.cpu ?? 0;
    cur.mem += pod.mem ?? 0;
    cur.restarts += pod.restarts ?? 0;
    usageByApp.set(app.slug, cur);
  }
  const hasUsage = breakdown.length > 0 && apps.length > 0;
  const grafanaHref = `/grafana/d/korepush-app/korepush-app?var-namespace=${encodeURIComponent(
    space.namespace,
  )}&var-pod=.*&from=now-1h&to=now`;

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[{ label: "Spaces", href: "/" }, { label: space.name }]}
    >
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-xl font-semibold">{space.name}</h1>
            <StatusBadge status={space.status} />
            <span className="hidden font-mono text-xs text-muted sm:inline">
              {space.namespace}
            </span>
          </div>
          <NewMenu spaceSlug={space.slug} />
        </div>

        {/* Resources */}
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted">Resources</h2>
            <a
              href={grafanaHref}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted transition-colors hover:text-foreground"
            >
              Open in Grafana ↗
            </a>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <UsageTile label="CPU" value={series?.ok ? fmtCores(series.cpuNow) : "—"} />
            <UsageTile
              label="Memory"
              value={series?.ok ? fmtBytes(series.memNow) : "—"}
            />
            <UsageTile label="Pods" value={series ? String(series.pods) : "—"} />
            <UsageTile
              label="Restarts"
              value={series ? String(series.restarts) : "—"}
              danger={(series?.restarts ?? 0) > 0}
            />
          </div>

          {series?.ok ? (
            <SpaceMetricsCharts data={series} />
          ) : (
            <div className="card py-10 text-center text-sm text-muted">
              Metrics warming up — Prometheus has no samples for this space yet.
            </div>
          )}
        </section>

        {/* Inventory roll-ups */}
        <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <RollupCard
            href={`/spaces/${space.slug}/apps`}
            label="Apps"
            count={apps.length}
            detail={
              apps.length === 0
                ? "None yet"
                : unhealthy > 0
                  ? `${unhealthy} need attention`
                  : "All healthy"
            }
            bad={unhealthy > 0}
            showDot
          />
          <RollupCard
            href={`/spaces/${space.slug}/databases`}
            label="Databases"
            count={databases.length}
            detail={databases.length === 0 ? "None yet" : "Postgres"}
          />
          <RollupCard
            href={`/spaces/${space.slug}/domains`}
            label="Domains"
            count={domains.length}
            detail={domains.length === 0 ? "Default only" : "Custom"}
          />
        </section>

        {/* Per-app resource usage */}
        {hasUsage && (
          <section className="mb-10">
            <h2 className="mb-4 text-sm font-medium text-muted">
              App resource usage
            </h2>
            <div className="panel overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="px-4 py-2.5 font-medium">App</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">CPU</th>
                    <th className="px-4 py-2.5 text-right font-medium">Memory</th>
                    <th className="px-4 py-2.5 text-right font-medium">Restarts</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => {
                    const usage = usageByApp.get(a.slug);
                    return (
                      <tr
                        key={a.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/spaces/${space.slug}/apps/${a.slug}?tab=metrics`}
                            className="transition-colors hover:text-muted"
                          >
                            {a.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={a.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">
                          {usage ? fmtCores(usage.cpu) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">
                          {usage ? fmtBytes(usage.mem) : "—"}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono text-xs ${
                            (usage?.restarts ?? 0) > 0 ? "text-danger" : ""
                          }`}
                        >
                          {usage ? usage.restarts : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Recent deployments */}
        {recentDeploys.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-medium text-muted">
              Recent deployments
            </h2>
            <ul className="panel divide-y divide-border">
              {recentDeploys.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/spaces/${space.slug}/apps/${d.appSlug}?tab=deployments`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <StatusBadge status={d.status} />
                      <span className="truncate font-medium">{d.appName}</span>
                      <span className="truncate font-mono text-xs text-muted">
                        {d.commitSha ? d.commitSha.slice(0, 7) : d.trigger}
                      </span>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted">
                      <span>{fmtDuration(d.createdAt, d.finishedAt)}</span>
                      <span className="ml-3">{timeAgo(d.createdAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </AppShell>
  );
}

function RollupCard({
  href,
  label,
  count,
  detail,
  bad = false,
  showDot = false,
}: {
  href: string;
  label: string;
  count: number;
  detail: string;
  bad?: boolean;
  showDot?: boolean;
}) {
  return (
    <Link href={href} className="card card-interactive block">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-xs text-fg-subtle">View →</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{count}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
        {showDot && count > 0 && (
          <span
            className={`size-1.5 rounded-full ${bad ? "bg-danger-fg" : "bg-success-fg"}`}
            aria-hidden
          />
        )}
        {detail}
      </div>
    </Link>
  );
}

function UsageTile({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={`mt-1 font-mono text-lg ${danger ? "text-danger" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

function fmtCores(n: number | null): string {
  if (n == null) return "—";
  return n >= 1 ? `${n.toFixed(2)} cores` : `${Math.round(n * 1000)} mCPU`;
}

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
