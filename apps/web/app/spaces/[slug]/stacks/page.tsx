import Link from "next/link";
import { requireSpacePage } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getSpaceStacks } from "@/lib/space-data";
import { timeAgo } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SpaceStacksPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, space } = await requireSpacePage(slug);
  const u = session.user as { id: string; email: string; role?: string };

  const stacks = await getSpaceStacks(space);

  return (
    <AppShell
      email={u.email}
      userId={u.id}
      isAdmin={u.role === "admin"}
      space={{ slug: space.slug, name: space.name }}
      crumbs={[
        { label: "Spaces", href: "/" },
        { label: space.name, href: `/spaces/${space.slug}` },
        { label: "Stacks" },
      ]}
    >
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Stacks</h1>
          <p className="text-sm text-muted">
            A stack groups the apps &amp; databases imported from one
            docker-compose file — manage them as a unit.
          </p>
        </div>

        {stacks.length === 0 ? (
          <EmptyState
            title="No stacks yet"
            description="Import a docker-compose file to create your first stack."
          />
        ) : (
          <ul className="panel divide-y divide-border">
            {stacks.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/spaces/${space.slug}/stacks/${s.slug}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.appCount} app{s.appCount === 1 ? "" : "s"} ·{" "}
                      {s.dbCount} database{s.dbCount === 1 ? "" : "s"} · created{" "}
                      {timeAgo(s.createdAt)}
                    </p>
                  </div>
                  <span className="text-muted" aria-hidden>
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
