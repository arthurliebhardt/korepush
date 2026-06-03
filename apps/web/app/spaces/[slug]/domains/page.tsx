import Link from "next/link";
import { requireSpacePage } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getSpaceDomains } from "@/lib/space-data";

export const dynamic = "force-dynamic";

export default async function SpaceDomainsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const domains = await getSpaceDomains(space);

  // Group by app — domains are owned per-app; editing happens in app Settings.
  const byApp = new Map<
    string,
    { appName: string; rows: typeof domains }
  >();
  for (const d of domains) {
    const g = byApp.get(d.appSlug);
    if (g) g.rows.push(d);
    else byApp.set(d.appSlug, { appName: d.appName, rows: [d] });
  }

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[
        { label: "Spaces", href: "/" },
        { label: space.name, href: `/spaces/${space.slug}` },
        { label: "Domains" },
      ]}
    >
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Domains</h1>
          <p className="text-sm text-muted">
            Custom domains across this space. Add or remove them from an app&apos;s
            Settings.
          </p>
        </div>

        {domains.length === 0 ? (
          <EmptyState
            title="No custom domains"
            description="Every app is already reachable at its default address. Add a custom domain from an app's Settings tab."
          />
        ) : (
          <ul className="space-y-3">
            {[...byApp.entries()].map(([appSlug, { appName, rows }]) => (
              <li key={appSlug} className="card">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-medium">{appName}</span>
                  <Link
                    href={`/spaces/${space.slug}/apps/${appSlug}?tab=settings`}
                    className="text-xs text-muted transition-colors hover:text-foreground"
                  >
                    Manage →
                  </Link>
                </div>
                <ul className="space-y-2">
                  {rows.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <span className="truncate font-mono text-sm">{d.host}</span>
                      <StatusBadge status={d.status} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
