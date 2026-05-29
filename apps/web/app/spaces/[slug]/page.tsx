import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  getSpaceBySlug,
  listApps,
  listDatabases,
  getDatabaseInfo,
  getSpaceMetrics,
} from "@korepush/k8s";
import { listAllConnectedRepos } from "@/lib/github/app";
import { StatusBadge } from "@/components/status-badge";
import { CreateApp } from "@/components/create-app";
import { CreateDatabase } from "@/components/create-database";
import { DatabaseCard } from "@/components/database-card";

export const dynamic = "force-dynamic";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireUser();
  const { slug } = await params;
  const space = await getSpaceBySlug(slug);
  if (!space) notFound();

  const apps = await listApps(space.id);
  const usage = await getSpaceMetrics(space.namespace).catch(() => null);
  // Connected GitHub repos for the deploy picker (VM can reach GitHub outbound).
  const repos = (await listAllConnectedRepos().catch(() => [])).map((r) => ({
    fullName: r.fullName,
    cloneUrl: r.cloneUrl,
    defaultBranch: r.defaultBranch,
  }));

  const dbRows = await listDatabases(space.id);
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
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Spaces
      </Link>

      <div className="mt-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{space.name}</h1>
          <StatusBadge status={space.status} />
          <span className="font-mono text-xs text-muted">
            {space.namespace}
          </span>
        </div>
      </div>

      {usage?.ok && (
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <UsageTile label="CPU" value={fmtCores(usage.cpuCores)} />
          <UsageTile label="Memory" value={fmtBytes(usage.memoryBytes)} />
          <UsageTile label="Pods" value={String(usage.pods)} />
          <UsageTile label="Restarts" value={String(usage.restarts)} />
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">Apps</h2>
        <CreateApp spaceSlug={space.slug} repos={repos} />
      </div>

      {apps.length === 0 ? (
        <div className="card py-12 text-center text-sm text-muted">
          No apps yet. Deploy one from a container image to get started.
        </div>
      ) : (
        <ul className="space-y-3">
          {apps.map((app) => (
            <li key={app.id}>
              <Link
                href={`/spaces/${space.slug}/apps/${app.slug}`}
                className="card flex items-center justify-between transition-colors hover:border-zinc-500"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{app.name}</span>
                    <StatusBadge status={app.status} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted">
                    {app.image}
                  </p>
                </div>
                <span className="text-sm text-muted">:{app.port}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">Databases</h2>
        <CreateDatabase spaceSlug={space.slug} />
      </div>

      {databases.length === 0 ? (
        <div className="card py-12 text-center text-sm text-muted">
          No databases yet. Create a Postgres database for your apps.
        </div>
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
    </div>
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
