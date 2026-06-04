import { requireSpacePage } from "@/lib/session";
import { getNodeIp } from "@korepush/k8s";
import { AppShell } from "@/components/app-shell";
import { SpaceDomains } from "@/components/space-domains";
import { getSpaceApps, getSpaceDomains } from "@/lib/space-data";

export const dynamic = "force-dynamic";

export default async function SpaceDomainsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const [{ apps }, domains, serverIp] = await Promise.all([
    getSpaceApps(space),
    getSpaceDomains(space),
    getNodeIp().catch(() => null),
  ]);

  const appOptions = apps.map((a) => ({
    slug: a.slug,
    name:
      a.environment && a.environment !== "prod"
        ? `${a.name} (${a.environment})`
        : a.name,
  }));

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
            Custom domains for the apps in this space. Point DNS at this server;
            HTTPS is issued automatically.
          </p>
        </div>

        <SpaceDomains
          spaceSlug={space.slug}
          apps={appOptions}
          serverIp={serverIp}
          domains={domains}
        />
      </main>
    </AppShell>
  );
}
