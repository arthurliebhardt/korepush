import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  getSpaceBySlug,
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
import { AppLive } from "@/components/app-live";
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
}: {
  params: Promise<{ slug: string; appSlug: string }>;
}) {
  await requireUser();
  const { slug, appSlug } = await params;
  const space = await getSpaceBySlug(slug);
  if (!space) notFound();
  let app = await getApp(space.id, appSlug);
  if (!app) notFound();

  const isGit = app.source === "git";
  // Finalize any in-flight build whose Job has finished (idempotent): deploys
  // the built image, so loading/refreshing this page advances the deploy even
  // if the live log stream dropped.
  if (isGit) {
    const inflight = await latestBuildingDeployment(app.id);
    if (inflight) {
      await finalizeBuild(inflight.id).catch(() => {});
      app = (await getApp(space.id, appSlug)) ?? app;
    }
  }
  // Show the build console only while a build is in flight; otherwise runtime.
  const building = isGit ? await latestBuildingDeployment(app.id) : null;
  const buildId = building?.id ?? null;
  // Seed the live badge with the operator's CR phase so first paint matches the
  // SSE stream (which then keeps it live); fall back to the DB mirror.
  const initialStatus =
    phaseToStatus(await getKoreAppPhase(space.namespace, app.slug).catch(() => null)) ??
    app.status;

  const databases = (await listDatabases(space.id)).map((d) => ({
    id: d.id,
    name: d.name,
  }));

  const deployments = await listDeployments(app.id);
  const effectiveEnv = await getEffectiveEnv(space.namespace, app.slug).catch(
    () => ({ ok: false, pod: null, env: [] }),
  );
  const appDomains = (await listAppDomains(app.id).catch(() => [])).map((d) => ({
    host: d.host,
    status: d.status,
    statusMessage: d.statusMessage,
    useStaging: d.useStaging,
  }));
  const nodeIp = await getNodeIp().catch(() => null);
  const baseDomain = process.env.KOREPUSH_BASE_DOMAIN ?? "localhost";
  const autoHost = `${app.slug}.${space.slug}.${baseDomain}`;

  // Sibling environments of this project (git apps only) for the switcher.
  const envs = isGit ? await listProjectEnvs(space.id, app.projectId) : [];
  const envPhases = isGit
    ? await listKoreAppPhases(space.namespace).catch((): Record<string, string> => ({}))
    : {};

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <Link
        href={`/spaces/${space.slug}`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← {space.name}
      </Link>

      {isGit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
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

      <div className="mt-4 mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{app.name}</h1>
          <p className="mt-1 font-mono text-xs text-muted">
            {isGit ? app.repoUrl : app.image} · :{app.port} · {space.namespace}
          </p>
        </div>
        {isGit && (
          <RedeployButton spaceSlug={space.slug} appSlug={app.slug} />
        )}
      </div>

      <div className="mb-5 space-y-5">
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
        />
        <CustomDomains
          spaceSlug={space.slug}
          appSlug={app.slug}
          initial={appDomains}
          serverIp={nodeIp}
          autoHost={autoHost}
        />
      </div>

      {buildId ? (
        <BuildLogs
          spaceSlug={space.slug}
          appSlug={app.slug}
          deploymentId={buildId}
        />
      ) : (
        <div className="space-y-8">
          <AppLive
            spaceSlug={space.slug}
            appSlug={app.slug}
            initialStatus={initialStatus}
          />
          <AppMetrics
            spaceSlug={space.slug}
            appSlug={app.slug}
            namespace={space.namespace}
          />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <AppDiagnostics spaceSlug={space.slug} appSlug={app.slug} />
            <AppEnv
              spaceSlug={space.slug}
              appSlug={app.slug}
              initial={effectiveEnv}
            />
          </div>
          {deployments.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-medium text-muted">
                Deployments
              </h2>
              <ul className="space-y-2">
                {deployments.map((d) => {
                  const tag = d.image?.split(":").pop() ?? "—";
                  const isCurrent = !!d.image && d.image === app.image;
                  const canRollback =
                    d.status === "succeeded" && !!d.image && !isCurrent;
                  return (
                    <li
                      key={d.id}
                      className="card flex items-center justify-between py-3"
                    >
                      <div className="flex items-center gap-3">
                        <StatusBadge status={d.status} />
                        <span className="font-mono text-xs">{tag}</span>
                        <span className="text-xs text-muted">{d.trigger}</span>
                        <span className="text-xs text-muted">
                          {timeAgo(d.createdAt)}
                        </span>
                      </div>
                      {isCurrent ? (
                        <span className="text-xs text-success">Current</span>
                      ) : canRollback ? (
                        <RollbackButton
                          spaceSlug={space.slug}
                          appSlug={app.slug}
                          deploymentId={d.id}
                          tag={tag}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
