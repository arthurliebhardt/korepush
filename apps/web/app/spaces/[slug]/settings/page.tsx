import { requireSpacePage } from "@/lib/session";
import { listRegistryCredentials } from "@korepush/k8s";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { DeleteSpace } from "@/components/delete-space";
import { RegistryCredentials } from "@/components/registry-credentials";

export const dynamic = "force-dynamic";

export default async function SpaceSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };
  const registryCreds = await listRegistryCredentials(space.namespace).catch(
    () => [],
  );

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[
        { label: "Spaces", href: "/" },
        { label: space.name, href: `/spaces/${space.slug}` },
        { label: "Settings" },
      ]}
    >
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold">Settings</h1>

        <section className="card mb-6 space-y-3">
          <h2 className="text-sm font-medium text-muted">General</h2>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <dt className="text-muted">Name</dt>
            <dd className="col-span-2 text-foreground">{space.name}</dd>
            <dt className="text-muted">Namespace</dt>
            <dd className="col-span-2 font-mono text-xs text-foreground">
              {space.namespace}
            </dd>
            <dt className="text-muted">Status</dt>
            <dd className="col-span-2">
              <StatusBadge status={space.status} />
            </dd>
          </dl>
        </section>

        <div className="mb-6">
          <RegistryCredentials
            spaceSlug={space.slug}
            initial={registryCreds}
          />
        </div>

        <DeleteSpace slug={space.slug} name={space.name} />
      </main>
    </AppShell>
  );
}
