import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpacePage } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { DeleteStack } from "@/components/delete-stack";
import { getStackWithMembers } from "@/lib/space-data";
import { timeAgo } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function StackDetailPage({
  params,
}: {
  params: Promise<{ slug: string; stackSlug: string }>;
}) {
  const { slug, stackSlug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const stack = await getStackWithMembers(space, stackSlug);
  if (!stack) notFound();

  const memberCount = stack.appCount + stack.dbCount;

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[
        { label: "Spaces", href: "/" },
        { label: space.name, href: `/spaces/${space.slug}` },
        { label: "Stacks", href: `/spaces/${space.slug}/stacks` },
        { label: stack.name },
      ]}
    >
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{stack.name}</h1>
          <StatusBadge status={stack.status} />
          <span className="text-xs text-muted">
            {stack.appCount} app{stack.appCount === 1 ? "" : "s"} ·{" "}
            {stack.dbCount} database{stack.dbCount === 1 ? "" : "s"} · created{" "}
            {timeAgo(stack.createdAt)}
          </span>
        </div>

        {memberCount === 0 ? (
          <section className="card mb-6 text-sm text-muted">
            This stack has no members — every app and database in it was deleted
            individually. Delete the stack below to clean it up.
          </section>
        ) : (
          <>
            {stack.apps.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-3 text-sm font-medium text-muted">Apps</h2>
                <ul className="panel divide-y divide-border">
                  {stack.apps.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/spaces/${space.slug}/apps/${a.slug}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                      >
                        <div className="min-w-0">
                          <span className="font-medium">{a.name}</span>
                          <span className="ml-2 truncate font-mono text-xs text-muted">
                            {a.image ?? "—"}
                          </span>
                        </div>
                        <StatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {stack.databases.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-3 text-sm font-medium text-muted">
                  Databases
                </h2>
                <ul className="panel divide-y divide-border">
                  {stack.databases.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/spaces/${space.slug}/databases/${d.slug}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                      >
                        <div className="min-w-0">
                          <span className="font-medium">{d.name}</span>
                          <span className="ml-2 text-xs text-muted">
                            {d.engine}
                          </span>
                        </div>
                        <StatusBadge status={d.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <DeleteStack
          spaceSlug={space.slug}
          stackSlug={stack.slug}
          stackName={stack.name}
          memberCount={memberCount}
        />
      </main>
    </AppShell>
  );
}
