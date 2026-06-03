import Link from "next/link";
import { requireSpacePage } from "@/lib/session";
import { getSpaceMetrics } from "@korepush/k8s";
import { StatusBadge } from "@/components/status-badge";
import { AppShell } from "@/components/app-shell";
import { NewMenu } from "@/components/new-menu";
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

  const [{ apps }, databases, domains, usage] = await Promise.all([
    getSpaceApps(space),
    getSpaceDatabases(space),
    getSpaceDomains(space),
    getSpaceMetrics(space.namespace).catch(() => null),
  ]);

  const unhealthy = apps.filter(
    (a) => a.status === "failed" || a.status === "degraded",
  ).length;

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[{ label: "Spaces", href: "/" }, { label: space.name }]}
    >
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-xl font-semibold">{space.name}</h1>
            <StatusBadge status={space.status} />
            <span className="hidden font-mono text-xs text-muted sm:inline">
              {space.namespace}
            </span>
          </div>
          <NewMenu spaceSlug={space.slug} />
        </div>

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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        </div>
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
}: {
  href: string;
  label: string;
  count: number;
  detail: string;
  bad?: boolean;
}) {
  return (
    <Link href={href} className="card card-interactive block">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-xs text-fg-subtle">View →</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{count}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
        {count > 0 && label === "Apps" && (
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

function UsageTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg text-foreground">{value}</div>
    </div>
  );
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
