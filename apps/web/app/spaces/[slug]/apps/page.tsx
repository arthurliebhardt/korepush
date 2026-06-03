import Link from "next/link";
import { requireSpacePage } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { NewMenu } from "@/components/new-menu";
import { SpaceApps } from "@/components/space-apps";
import { EmptyState } from "@/components/ui/empty-state";
import { getSpaceApps, getSpaceDatabases, baseDomain } from "@/lib/space-data";

export const dynamic = "force-dynamic";

export default async function SpaceAppsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const [{ projects, lastDeploy }, databases] = await Promise.all([
    getSpaceApps(space),
    getSpaceDatabases(space),
  ]);
  const dbById = new Map(databases.map((d) => [d.id, { slug: d.slug, name: d.name }]));

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[
        { label: "Spaces", href: "/" },
        { label: space.name, href: `/spaces/${space.slug}` },
        { label: "Apps" },
      ]}
    >
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Apps</h1>
          {projects.length > 0 && <NewMenu spaceSlug={space.slug} />}
        </div>

        {projects.length === 0 ? (
          <EmptyState
            title="No apps yet"
            description="Deploy your first app from a GitHub repo or a container image."
            action={
              <Link href={`/spaces/${space.slug}/new`} className="btn-primary">
                Deploy app
              </Link>
            }
          />
        ) : (
          <SpaceApps
            spaceSlug={space.slug}
            projects={projects}
            lastDeploy={lastDeploy}
            dbById={dbById}
            baseDomain={baseDomain()}
          />
        )}
      </main>
    </AppShell>
  );
}
