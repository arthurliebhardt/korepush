import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listAllDomains } from "@korepush/k8s";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const session = await requireUser();
  const isAdmin = (session.user as { role?: string }).role === "admin";
  const domains = await listAllDomains(isAdmin ? undefined : session.user.id);

  return (
    <AppShell email={session.user.email} crumbs={[{ label: "Domains" }]}>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold">Domains</h1>
        {domains.length === 0 ? (
          <EmptyState
            title="No custom domains yet"
            description="Add a custom domain from an app's Settings tab; they show up here."
          />
        ) : (
          <ul className="space-y-2">
            {domains.map((d) => (
              <li
                key={d.id}
                className="card flex items-center justify-between py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="truncate font-mono text-sm">{d.host}</span>
                  <StatusBadge status={d.status} />
                  {d.useStaging && (
                    <span className="text-xs text-muted">staging</span>
                  )}
                </div>
                <Link
                  href={`/spaces/${d.spaceSlug}/apps/${d.appSlug}`}
                  className="shrink-0 text-xs text-muted transition-colors hover:text-foreground"
                >
                  {d.appName} ↗
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
