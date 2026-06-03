import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpacePage } from "@/lib/session";
import { AppShellHeader } from "@/components/app-shell-header";
import {
  getApp,
  latestBuildingDeployment,
  finalizeBuild,
  listDatabases,
  listDeployments,
  getEffectiveEnv,
  listAppDomains,
  getNodeIp,
  getKoreAppPhase,
  phaseToStatus,
  listProjectEnvs,
  listKoreAppPhases,
} from "@korepush/k8s";
import { AppStatus } from "@/components/app-status";
import { AppLogs } from "@/components/app-logs";
import { AppTabs } from "@/components/app-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { AppMetrics } from "@/components/app-metrics";
import { AppDiagnostics } from "@/components/app-diagnostics";
import { AppEnv } from "@/components/app-env";
import { BuildLogs } from "@/components/build-logs";
import { RedeployButton } from "@/components/redeploy-button";
import { RollbackButton } from "@/components/rollback-button";
import { AttachDatabase } from "@/components/attach-database";
import { EnvEditor } from "@/components/env-editor";
import { CustomDomains } from "@/components/custom-domains";
import { StatusBadge } from "@/components/status-badge";
import { AddEnvironment } from "@/components/add-environment";

export const dynamic = "force-dynamic";

export default async function AppPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; appSlug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug, appSlug } = await params;
  const { tab = "overview" } = await searchParams;
  const { session, space } = await requireSpacePage(slug);
  let app = await getApp(space.id, appSlug);
  if (!app) notFound();

  const isGit = app.source === "git";
  // Finalize any in-flight build whose Job has finished (idempotent): deploys
  // the built image, so loading/refreshing this page advances the deploy even
  // if the live log stream dropped. Sequential — it refreshes `app`.
  if (isGit) {
    const inflight = await latestBuildingDeployment(app.id);
    if (inflight) {
      await finalizeBuild(inflight.id).catch(() => {});
      app = (await getApp(space.id, appSlug)) ?? app;
    }
  }

  const baseDomain = process.env.KOREPUSH_BASE_DOMAIN ?? "localhost";
  const autoHost = `${app.slug}.${space.slug}.${baseDomain}`;
  const basePath = `/spaces/${space.slug}/apps/${app.slug}`;

  // Everything below is independent given `space`+`app`; fetch in parallel
  // (k8s API / DB / Prometheus) instead of serially blocking first paint.
  const [building, initialPhase, databaseRows, deployments, effectiveEnv, domainRows, nodeIp] =
    await Promise.all([
      // Show the build console only while a build is in flight; otherwise runtime.
      isGit ? latestBuildingDeployment(app.id) : Promise.resolve(null),
      // Seed the live badge with the operator's CR phase so first paint matches
      // the SSE stream (which then keeps it live); fall back to the DB mirror.
      getKoreAppPhase(space.namespace, app.slug).catch(() => null),
      listDatabases(space.id),
      listDeployments(app.id),
      getEffectiveEnv(space.namespace, app.slug).catch(() => ({
        ok: false,
        pod: null,
        env: [],
      })),
      listAppDomains(app.id).catch(() => []),
      getNodeIp().catch(() => null),
    ]);

  // Sibling environments of this project (git apps only) for the switcher.
  let envs: Awaited<ReturnType<typeof listProjectEnvs>> = [];
  let envPhases: Record<string, string> = {};
  if (isGit) {
    [envs, envPhases] = await Promise.all([
      listProjectEnvs(space.id, app.projectId),
      listKoreAppPhases(space.namespace).catch((): Record<string, string> => ({})),
    ]);
  }

  const buildId = building?.id ?? null;
  const initialStatus = phaseToStatus(initialPhase) ?? app.status;
  const databases = databaseRows.map((d) => ({ id: d.id, name: d.name }));
  const appDomains = domainRows.map((d) => ({
    host: d.host,
    status: d.status,
    statusMessage: d.statusMessage,
    useStaging: d.useStaging,
  }));
  // The live deployment = most recent succeeded one whose image is deployed
  // (deployments are newest-first). Marks exactly one row, vs flagging every
  // row that happens to share the current image.
  const liveDeployId =
    deployments.find((d) => d.status === "succeeded" && d.image === app.image)
      ?.id ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <AppShellHeader
        email={session.user.email}
        crumbs={[
          { label: "Spaces", href: "/" },
          { label: space.name, href: `/spaces/${space.slug}` },
          { label: app.name },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      {isGit && (
        <div className="flex flex-wrap items-center gap-2">
          {envs.map((e) => {
            const active = e.slug === app.slug;
            return (
              <Link
                key={e.id}
                href={`/spaces/${space.slug}/apps/${e.slug}`}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                  active
                    ? "border-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {e.environment} ({e.gitRef})
                <StatusBadge status={phaseToStatus(envPhases[e.slug]) ?? e.status} />
              </Link>
            );
          })}
          <AddEnvironment spaceSlug={space.slug} appSlug={app.slug} />
        </div>
      )}

      <div className="mt-4 mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{app.name}</h1>
          <p className="mt-1 truncate font-mono text-xs text-muted">
            {isGit ? app.repoUrl : app.image} · :{app.port} · {space.namespace}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {app.image && (
            <a
              href={`//${autoHost}`}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
            >
              Open ↗
            </a>
          )}
          {isGit && <RedeployButton spaceSlug={space.slug} appSlug={app.slug} />}
        </div>
      </div>

      {/* Build console as a banner (not a full-page swap) — the tabs stay usable. */}
      {buildId && (
        <div className="mb-6">
          <BuildLogs
            spaceSlug={space.slug}
            appSlug={app.slug}
            deploymentId={buildId}
          />
        </div>
      )}

      <AppTabs basePath={basePath} active={tab} />

      {tab === "logs" ? (
        <AppLogs spaceSlug={space.slug} appSlug={app.slug} />
      ) : tab === "metrics" ? (
        <AppMetrics
          spaceSlug={space.slug}
          appSlug={app.slug}
          namespace={space.namespace}
        />
      ) : tab === "deployments" ? (
        deployments.length > 0 ? (
          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Commit / tag</th>
                  <th className="px-4 py-2.5 font-medium">Trigger</th>
                  <th className="px-4 py-2.5 font-medium">Duration</th>
                  <th className="px-4 py-2.5 font-medium">Age</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => {
                  const tag = d.image?.split(":").pop() ?? "—";
                  const isLive = d.id === liveDeployId;
                  const canRollback =
                    d.status === "succeeded" && !!d.image && !isLive;
                  return (
                    <tr
                      key={d.id}
                      className="border-b border-border-subtle last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {d.commitSha ? (
                          <span className="text-foreground">
                            {d.commitSha.slice(0, 7)}
                          </span>
                        ) : (
                          <span className="text-muted">{tag}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        {d.trigger}
                      </td>
                      <td className="px-4 py-2.5 text-xs tabular-nums text-muted">
                        {fmtDuration(d.createdAt, d.finishedAt)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        {timeAgo(d.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isLive ? (
                          <span className="badge bg-success/15 text-success-fg">
                            Live
                          </span>
                        ) : canRollback ? (
                          <RollbackButton
                            spaceSlug={space.slug}
                            appSlug={app.slug}
                            deploymentId={d.id}
                            tag={tag}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No deployments yet"
            description="Deployments appear here as you build, redeploy, and roll back."
          />
        )
      ) : tab === "settings" ? (
        <div className="space-y-5">
          <AttachDatabase
            spaceSlug={space.slug}
            appSlug={app.slug}
            databases={databases}
            attachedDbId={app.attachedDbId}
            dbEnvVar={app.dbEnvVar}
          />
          <EnvEditor
            spaceSlug={space.slug}
            appSlug={app.slug}
            env={app.env}
            secretKeys={app.secretKeys}
            dbEnvVar={app.dbEnvVar}
          />
          <CustomDomains
            spaceSlug={space.slug}
            appSlug={app.slug}
            initial={appDomains}
            serverIp={nodeIp}
            autoHost={autoHost}
          />
          <AppEnv
            spaceSlug={space.slug}
            appSlug={app.slug}
            initial={effectiveEnv}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <AppStatus
            spaceSlug={space.slug}
            appSlug={app.slug}
            initialStatus={initialStatus}
          />
          <AppDiagnostics spaceSlug={space.slug} appSlug={app.slug} />
        </div>
      )}
      </main>
    </div>
  );
}

function fmtDuration(start: Date, end: Date | null): string {
  if (!end) return "—";
  const s = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 1000,
  );
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
