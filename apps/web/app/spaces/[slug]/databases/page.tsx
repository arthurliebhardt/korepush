import { requireSpacePage } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { CreateDatabase } from "@/components/create-database";
import { DatabaseCard } from "@/components/database-card";
import { EmptyState } from "@/components/ui/empty-state";
import { getSpaceApps, getSpaceDatabases } from "@/lib/space-data";

export const dynamic = "force-dynamic";

export default async function SpaceDatabasesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const [databases, { apps }] = await Promise.all([
    getSpaceDatabases(space),
    getSpaceApps(space),
  ]);
  const usedByOf = (dbId: string) =>
    apps.filter((a) => a.attachedDbId === dbId).map((a) => a.name);

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[
        { label: "Spaces", href: "/" },
        { label: space.name, href: `/spaces/${space.slug}` },
        { label: "Databases" },
      ]}
    >
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Databases</h1>
            <p className="text-sm text-muted">
              Managed Postgres &amp; Redis instances inside this space.
            </p>
          </div>
          <CreateDatabase spaceSlug={space.slug} />
        </div>

        {databases.length === 0 ? (
          <EmptyState
            title="No databases yet"
            description="Create a Postgres or Redis database, then attach it to an app to inject its connection string."
          />
        ) : (
          <ul className="space-y-3">
            {databases.map((d) => (
              <li key={d.id}>
                <DatabaseCard
                  spaceSlug={space.slug}
                  slug={d.slug}
                  name={d.name}
                  engine={d.engine}
                  status={d.status}
                  host={d.info.host}
                  usedBy={usedByOf(d.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
