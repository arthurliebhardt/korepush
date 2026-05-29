import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getSpaceBySlug, getApp } from "@korepush/k8s";
import { AppLive } from "@/components/app-live";

export const dynamic = "force-dynamic";

export default async function AppPage({
  params,
}: {
  params: Promise<{ slug: string; appSlug: string }>;
}) {
  await requireUser();
  const { slug, appSlug } = await params;
  const space = await getSpaceBySlug(slug);
  if (!space) notFound();
  const app = await getApp(space.id, appSlug);
  if (!app) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <Link
        href={`/spaces/${space.slug}`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← {space.name}
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-xl font-semibold">{app.name}</h1>
        <p className="mt-1 font-mono text-xs text-muted">
          {app.image} · :{app.port} · {space.namespace}
        </p>
      </div>

      <AppLive
        spaceSlug={space.slug}
        appSlug={app.slug}
        initialStatus={app.status}
      />
    </div>
  );
}
