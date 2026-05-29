import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  getSpaceBySlug,
  getApp,
  latestBuildingDeployment,
  finalizeBuild,
  listDatabases,
} from "@korepush/k8s";
import { AppLive } from "@/components/app-live";
import { AppMetrics } from "@/components/app-metrics";
import { BuildLogs } from "@/components/build-logs";
import { RedeployButton } from "@/components/redeploy-button";
import { AttachDatabase } from "@/components/attach-database";
import { EnvEditor } from "@/components/env-editor";

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

  const databases = (await listDatabases(space.id)).map((d) => ({
    id: d.id,
    name: d.name,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <Link
        href={`/spaces/${space.slug}`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← {space.name}
      </Link>

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
            initialStatus={app.status}
          />
          <AppMetrics
            spaceSlug={space.slug}
            appSlug={app.slug}
            namespace={space.namespace}
          />
        </div>
      )}
    </div>
  );
}
