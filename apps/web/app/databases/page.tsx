import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listAllDatabases } from "@korepush/k8s";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function DatabasesPage() {
  const session = await requireUser();
  const isAdmin = (session.user as { role?: string }).role === "admin";
  const databases = await listAllDatabases(
    isAdmin ? undefined : session.user.id,
  );

  return (
    <AppShell email={session.user.email} crumbs={[{ label: "Databases" }]}>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold">Databases</h1>
        {databases.length === 0 ? (
          <EmptyState
            title="No databases yet"
            description="Postgres databases across all your spaces show up here."
          />
        ) : (
          <ul className="space-y-3">
            {databases.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/spaces/${d.spaceSlug}`}
                  className="card card-interactive flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{d.name}</span>
                      <span className="text-xs text-muted">
                        postgres {d.version}
                      </span>
                      <StatusBadge status={d.status} />
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted">
                      {d.spaceName}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
