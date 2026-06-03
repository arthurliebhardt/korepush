import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpacePage } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import {
  CopyButton,
  DetachAppButton,
  AttachDbToApp,
  DeleteDatabaseButton,
} from "@/components/db-detail-actions";
import { getSpaceApps, getSpaceDatabases } from "@/lib/space-data";

export const dynamic = "force-dynamic";

export default async function DatabaseDetailPage({
  params,
}: {
  params: Promise<{ slug: string; dbSlug: string }>;
}) {
  const { slug, dbSlug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const [databases, { apps }] = await Promise.all([
    getSpaceDatabases(space),
    getSpaceApps(space),
  ]);
  const db = databases.find((d) => d.slug === dbSlug);
  if (!db) notFound();

  const attached = apps.filter((a) => a.attachedDbId === db.id);
  const attachable = apps.filter((a) => a.attachedDbId !== db.id);

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[
        { label: "Spaces", href: "/" },
        { label: space.name, href: `/spaces/${space.slug}` },
        { label: "Databases", href: `/spaces/${space.slug}/databases` },
        { label: db.name },
      ]}
    >
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-xl font-semibold">{db.name}</h1>
          <span className="text-xs text-muted">postgres</span>
          <StatusBadge status={db.status} />
        </div>

        <section className="card mb-6 space-y-3">
          <h2 className="text-sm font-medium text-muted">Connection</h2>
          {db.info.connectionUri ? (
            <div className="flex items-center gap-3">
              <code className="truncate font-mono text-xs text-muted">
                {db.info.host ?? "connection ready"}
              </code>
              <CopyButton text={db.info.connectionUri} />
            </div>
          ) : (
            <p className="text-xs text-muted">Provisioning Postgres…</p>
          )}
        </section>

        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-muted">Attached to</h2>
          {attached.length === 0 ? (
            <p className="mb-3 text-sm text-fg-subtle">
              Not attached to any app yet.
            </p>
          ) : (
            <ul className="mb-3 space-y-2">
              {attached.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <Link
                    href={`/spaces/${space.slug}/apps/${a.slug}`}
                    className="text-sm transition-colors hover:text-muted"
                  >
                    {a.name}
                    <span className="ml-2 font-mono text-xs text-fg-subtle">
                      {a.dbEnvVar}
                    </span>
                  </Link>
                  <DetachAppButton
                    spaceSlug={space.slug}
                    appSlug={a.slug}
                    appName={a.name}
                    dbName={db.name}
                  />
                </li>
              ))}
            </ul>
          )}
          {attachable.length > 0 && (
            <AttachDbToApp
              spaceSlug={space.slug}
              databaseId={db.id}
              apps={attachable.map((a) => ({ slug: a.slug, name: a.name }))}
            />
          )}
        </section>

        <section className="card border-danger/30">
          <h2 className="text-sm font-medium text-foreground">Danger zone</h2>
          <p className="mb-3 mt-1 text-sm text-muted">
            Permanently delete this database and all of its data.
          </p>
          <DeleteDatabaseButton
            spaceSlug={space.slug}
            slug={db.slug}
            name={db.name}
          />
        </section>
      </main>
    </AppShell>
  );
}
