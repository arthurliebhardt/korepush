import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listSpacesWithStats } from "@korepush/k8s";
import { getAppConfig } from "@/lib/github/config";
import { StatusBadge } from "@/components/status-badge";
import { CreateSpace } from "@/components/create-space";
import { Onboarding } from "@/components/onboarding";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireUser();
  // Each user sees only their own spaces; an admin sees the whole platform.
  const isAdmin = (session.user as { role?: string }).role === "admin";
  const [spaces, ghApp] = await Promise.all([
    listSpacesWithStats(isAdmin ? undefined : session.user.id),
    getAppConfig().catch(() => null),
  ]);
  // First run (no spaces yet) → show the guided onboarding instead of the grid.
  const onboarding = spaces.length === 0;

  return (
    <AppShell
      email={session.user.email}
      userId={session.user.id}
      isAdmin={isAdmin}
      crumbs={[{ label: "Spaces" }]}
    >
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {onboarding ? (
          <Onboarding
            githubConnected={!!ghApp}
            githubSlug={ghApp?.slug ?? null}
          />
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold">Spaces</h1>
                <p className="text-sm text-muted">
                  Isolated environments for your apps and databases.
                </p>
              </div>
              <CreateSpace />
            </div>

            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {spaces.map((space) => (
                <li key={space.id}>
                  <Link
                    href={`/spaces/${space.slug}`}
                    className="card card-interactive block"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{space.name}</span>
                      <StatusBadge status={space.status} />
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted">
                      {space.namespace}
                    </p>
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                      {space.appCount > 0 && (
                        <span
                          className={`size-1.5 rounded-full ${space.failedApps > 0 ? "bg-danger-fg" : "bg-success-fg"}`}
                          title={
                            space.failedApps > 0
                              ? `${space.failedApps} app(s) need attention`
                              : "All apps healthy"
                          }
                          aria-hidden
                        />
                      )}
                      <span>
                        {space.appCount} {space.appCount === 1 ? "app" : "apps"}
                      </span>
                      <span className="text-fg-faint">·</span>
                      <span>
                        {space.dbCount}{" "}
                        {space.dbCount === 1 ? "database" : "databases"}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </AppShell>
  );
}
