import { getSession } from "@/lib/session";
import { listSpaces, listSpacesForUser, listApps } from "@korepush/k8s";

export const dynamic = "force-dynamic";

// Navigation targets for the ⌘K command palette: the caller's spaces + their
// apps (owner-scoped unless admin). Fetched lazily on first palette open.
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const isAdmin = (session.user as { role?: string }).role === "admin";
  const spaces = isAdmin
    ? await listSpaces()
    : await listSpacesForUser(session.user.id);
  const appLists = await Promise.all(spaces.map((s) => listApps(s.id)));

  const entries: { kind: string; label: string; sub?: string; href: string }[] =
    [];
  spaces.forEach((s, i) => {
    entries.push({
      kind: "space",
      label: s.name,
      sub: s.namespace,
      href: `/spaces/${s.slug}`,
    });
    for (const a of appLists[i]) {
      entries.push({
        kind: "app",
        label: a.name,
        sub: s.name,
        href: `/spaces/${s.slug}/apps/${a.slug}`,
      });
    }
  });

  return Response.json({ entries });
}
