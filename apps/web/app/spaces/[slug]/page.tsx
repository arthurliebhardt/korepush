import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getSpaceBySlug, listApps } from "@korepush/k8s";
import { StatusBadge } from "@/components/status-badge";
import { CreateApp } from "@/components/create-app";

export const dynamic = "force-dynamic";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireUser();
  const { slug } = await params;
  const space = await getSpaceBySlug(slug);
  if (!space) notFound();

  const apps = await listApps(space.id);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Spaces
      </Link>

      <div className="mt-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{space.name}</h1>
          <StatusBadge status={space.status} />
          <span className="font-mono text-xs text-muted">
            {space.namespace}
          </span>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">Apps</h2>
        <CreateApp spaceSlug={space.slug} />
      </div>

      {apps.length === 0 ? (
        <div className="card py-12 text-center text-sm text-muted">
          No apps yet. Deploy one from a container image to get started.
        </div>
      ) : (
        <ul className="space-y-3">
          {apps.map((app) => (
            <li key={app.id}>
              <Link
                href={`/spaces/${space.slug}/apps/${app.slug}`}
                className="card flex items-center justify-between transition-colors hover:border-zinc-500"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{app.name}</span>
                    <StatusBadge status={app.status} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted">
                    {app.image}
                  </p>
                </div>
                <span className="text-sm text-muted">:{app.port}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
