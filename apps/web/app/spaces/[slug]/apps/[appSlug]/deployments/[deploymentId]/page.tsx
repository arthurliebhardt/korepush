import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpacePage } from "@/lib/session";
import {
  getApp,
  getDeployment,
  listDeployments,
  latestBuildingDeployment,
  finalizeBuild,
  buildJobName,
} from "@korepush/k8s";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { BuildLogs } from "@/components/build-logs";
import { LogViewer } from "@/components/ui/log-viewer";
import { RollbackButton } from "@/components/rollback-button";
import { RedeployButton } from "@/components/redeploy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { timeAgo, fmtDuration } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DeploymentDetailPage({
  params,
}: {
  params: Promise<{ slug: string; appSlug: string; deploymentId: string }>;
}) {
  const { slug, appSlug, deploymentId } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const app = await getApp(space.id, appSlug);
  if (!app) notFound();

  const isGit = app.source === "git";
  // Advance a build whose live stream dropped (idempotent), so the row we render
  // reflects the real status — same pattern as the app page.
  if (isGit) await finalizeBuild(deploymentId).catch(() => {});

  const [dep, deployments, building] = await Promise.all([
    getDeployment(app.id, deploymentId),
    listDeployments(app.id),
    isGit ? latestBuildingDeployment(app.id) : Promise.resolve(null),
  ]);
  if (!dep) notFound();

  const basePath = `/spaces/${space.slug}/apps/${app.slug}`;
  const baseDomain = process.env.KOREPUSH_BASE_DOMAIN ?? "localhost";
  const autoHost = `${app.slug}.${space.slug}.${baseDomain}`;
  const tag = dep.image?.split(":").pop() ?? "—";
  const liveDeployId =
    deployments.find((d) => d.status === "succeeded" && d.image === app.image)
      ?.id ?? null;
  const isLive = dep.id === liveDeployId;
  const isBuildingNow = building?.id === dep.id;
  const canRollback = dep.status === "succeeded" && !!dep.image && !isLive;
  const isRollback = dep.trigger === "rollback";

  const ghCommitUrl = (() => {
    if (!dep.commitSha || !app.repoUrl) return null;
    const m = app.repoUrl.match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?$/i);
    return m ? `https://github.com/${m[1]}/commit/${dep.commitSha}` : null;
  })();

  const title = dep.commitSha ? dep.commitSha.slice(0, 7) : tag;

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[
        { label: "Spaces", href: "/" },
        { label: space.name, href: `/spaces/${space.slug}` },
        { label: "Apps", href: `/spaces/${space.slug}/apps` },
        { label: app.name, href: `${basePath}?tab=deployments` },
        { label: title },
      ]}
    >
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <Link
          href={`${basePath}?tab=deployments`}
          className="text-xs text-muted transition-colors hover:text-foreground"
        >
          ← All deployments
        </Link>

        <div className="mb-6 mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-xl font-semibold">{title}</h1>
              <StatusBadge status={dep.status} />
              {isLive && (
                <span className="badge bg-success/15 text-success-fg">Live</span>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-muted">
              {dep.trigger} · {timeAgo(dep.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isLive && app.image && (
              <a
                href={`//${autoHost}`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost"
              >
                Open ↗
              </a>
            )}
            {canRollback && (
              <RollbackButton
                spaceSlug={space.slug}
                appSlug={app.slug}
                deploymentId={dep.id}
                tag={tag}
              />
            )}
            {isGit && <RedeployButton spaceSlug={space.slug} appSlug={app.slug} />}
          </div>
        </div>

        <section className="card mb-6">
          <h2 className="mb-3 text-sm font-medium text-muted">Details</h2>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <Row label="Status">
              <StatusBadge status={dep.status} />
            </Row>
            <Row label="Trigger">
              <span className="text-foreground">{dep.trigger}</span>
            </Row>
            {isGit && (
              <Row label="Commit">
                {dep.commitSha ? (
                  ghCommitUrl ? (
                    <a
                      href={ghCommitUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-foreground underline-offset-2 hover:underline"
                    >
                      {dep.commitSha.slice(0, 12)} ↗
                    </a>
                  ) : (
                    <span className="font-mono text-foreground">
                      {dep.commitSha.slice(0, 12)}
                    </span>
                  )
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Row>
            )}
            <Row label="Image">
              <span className="break-all font-mono text-xs text-foreground">
                {dep.image ?? "—"}
              </span>
            </Row>
            <Row label="Live">{isLive ? "Yes" : "No"}</Row>
            <Row label="Created">
              <span className="text-foreground">
                {new Date(dep.createdAt).toLocaleString()}
              </span>
            </Row>
            <Row label="Finished">
              <span className="text-foreground">
                {dep.finishedAt
                  ? new Date(dep.finishedAt).toLocaleString()
                  : "—"}
              </span>
            </Row>
            <Row label="Duration">
              <span className="tabular-nums text-foreground">
                {fmtDuration(dep.createdAt, dep.finishedAt)}
              </span>
            </Row>
            {isGit && !isRollback && (
              <Row label="Build job">
                <span className="break-all font-mono text-xs text-muted">
                  {buildJobName(app.slug, dep.id.slice(0, 8))}
                </span>
              </Row>
            )}
          </dl>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-muted">Build logs</h2>
          {isBuildingNow ? (
            <BuildLogs
              spaceSlug={space.slug}
              appSlug={app.slug}
              deploymentId={dep.id}
            />
          ) : dep.buildLog ? (
            <LogViewer
              lines={dep.buildLog.split("\n")}
              filename={`build-${app.slug}-${dep.id.slice(0, 8)}.txt`}
            />
          ) : isRollback ? (
            <EmptyState
              title="No build for this deployment"
              description="A rollback re-points the app to a previously built image — there's no build to show here."
            />
          ) : !isGit ? (
            <EmptyState
              title="No build"
              description="This app runs a prebuilt container image, so there are no build logs."
            />
          ) : (
            <EmptyState
              title="No stored build logs"
              description="This build finished before log capture was added, or its build pod was already cleaned up. New builds store their logs automatically."
            />
          )}
        </section>
      </main>
    </AppShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="col-span-2 min-w-0">{children}</dd>
    </>
  );
}
