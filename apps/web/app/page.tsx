import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listSpaces, listSpacesForUser } from "@korepush/k8s";
import { getAppConfig } from "@/lib/github/config";
import { StatusBadge } from "@/components/status-badge";
import { CreateSpace } from "@/components/create-space";
import { Onboarding } from "@/components/onboarding";
import { AppShellHeader } from "@/components/app-shell-header";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireUser();
  // Each user sees only their own spaces; an admin sees the whole platform.
  const isAdmin = (session.user as { role?: string }).role === "admin";
  const [spaces, ghApp] = await Promise.all([
    isAdmin ? listSpaces() : listSpacesForUser(session.user.id),
    getAppConfig().catch(() => null),
  ]);
  // First run (no spaces yet) → show the guided onboarding instead of the grid.
  const onboarding = spaces.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      <AppShellHeader email={session.user.email} />

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
