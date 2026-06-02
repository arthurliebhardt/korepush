import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listSpaces, listSpacesForUser, clusterReachable } from "@korepush/k8s";
import { getAppConfig } from "@/lib/github/config";
import { StatusBadge } from "@/components/status-badge";
import { CreateSpace } from "@/components/create-space";
import { Onboarding } from "@/components/onboarding";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireUser();
  // Each user sees only their own spaces; an admin sees the whole platform.
  const isAdmin = (session.user as { role?: string }).role === "admin";
  const [spaces, clusterOk, ghApp] = await Promise.all([
    isAdmin ? listSpaces() : listSpacesForUser(session.user.id),
    clusterReachable(),
    getAppConfig().catch(() => null),
  ]);
  // First run (no spaces yet) → show the guided onboarding instead of the grid.
  const onboarding = spaces.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-bold tracking-tight">
            korepush
          </Link>
          <span
            className={`inline-flex items-center gap-1.5 text-xs ${
              clusterOk ? "text-success" : "text-danger"
            }`}
            title="Cluster connectivity"
          >
            <span className="size-1.5 rounded-full bg-current" />
            {clusterOk ? "cluster connected" : "cluster unreachable"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">{session.user.email}</span>
          <Link href="/settings" className="text-muted hover:text-foreground">
            Settings
          </Link>
          <SignOutButton />
        </div>
      </header>

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
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
