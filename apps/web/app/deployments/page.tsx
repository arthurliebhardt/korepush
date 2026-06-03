import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listAllDeployments } from "@korepush/k8s";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { timeAgo, fmtDuration } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DeploymentsPage() {
  const session = await requireUser();
  const isAdmin = (session.user as { role?: string }).role === "admin";
  const deployments = await listAllDeployments(
    isAdmin ? undefined : session.user.id,
  );

  return (
    <AppShell email={session.user.email} crumbs={[{ label: "Deployments" }]}>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold">Deployments</h1>
        {deployments.length === 0 ? (
          <EmptyState
            title="No deployments yet"
            description="Builds and deploys across all your spaces show up here."
          />
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">App</th>
                  <th className="px-4 py-2.5 font-medium">Commit / tag</th>
                  <th className="px-4 py-2.5 font-medium">Trigger</th>
                  <th className="px-4 py-2.5 font-medium">Duration</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => {
                  const tag = d.image?.split(":").pop() ?? "—";
                  return (
                    <tr
                      key={d.id}
                      className="border-b border-border-subtle last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/spaces/${d.spaceSlug}/apps/${d.appSlug}`}
                          className="text-foreground hover:underline"
                        >
                          {d.appName}
                        </Link>
                        <span className="ml-1.5 text-xs text-muted">
                          {d.spaceSlug}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {d.commitSha ? (
                          <span className="text-foreground">
                            {d.commitSha.slice(0, 7)}
                          </span>
                        ) : (
                          <span className="text-muted">{tag}</span>
                        )}
                        {d.gitRef && (
                          <span className="ml-1.5 text-muted">⎇ {d.gitRef}</span>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AppShell>
  );
}
