import Link from "next/link";
import { requireSpacePage } from "@/lib/session";
import { listAllConnectedRepos } from "@/lib/github/app";
import { listDatabases } from "@korepush/k8s";
import { AppShell } from "@/components/app-shell";
import { CreateApp } from "@/components/create-app";

export const dynamic = "force-dynamic";

export default async function DeployAppPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const [repoRows, dbRows] = await Promise.all([
    listAllConnectedRepos().catch(() => []),
    listDatabases(space.id).catch(() => []),
  ]);
  const repos = repoRows.map((r) => ({
    fullName: r.fullName,
    cloneUrl: r.cloneUrl,
    defaultBranch: r.defaultBranch,
  }));
  const databases = dbRows.map((d) => ({ id: d.id, name: d.name, engine: d.engine }));

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
        { label: "Deploy" },
      ]}
    >
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <Link
          href={`/spaces/${space.slug}/apps`}
          className="text-xs text-muted transition-colors hover:text-foreground"
        >
          ← Back to apps
        </Link>
        <h1 className="mb-1 mt-3 text-xl font-semibold">
          Deploy an app to {space.name}
        </h1>
        <p className="mb-6 text-sm text-muted">
          Connect a GitHub repo or a container image. Build logs stream live on
          the next screen.
        </p>
        <CreateApp
          spaceSlug={space.slug}
          repos={repos}
          databases={databases}
          embedded
        />
      </main>
    </AppShell>
  );
}
