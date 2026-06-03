import { getSession } from "@/lib/session";
import {
  listSpaces,
  listSpacesForUser,
  listApps,
  listDatabases,
} from "@korepush/k8s";

export const dynamic = "force-dynamic";

// Navigation + action targets for the ⌘K command palette: the caller's spaces,
// their apps and databases, plus contextual creation VERBS (deploy app /
// create database / new space). Owner-scoped unless admin. Fetched lazily on
// first palette open. Cross-space discovery here is what lets the global
// /deployments, /databases, /domains pages stay retired.
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const isAdmin = (session.user as { role?: string }).role === "admin";
  const spaces = isAdmin
    ? await listSpaces()
    : await listSpacesForUser(session.user.id);
  const [appLists, dbLists] = await Promise.all([
    Promise.all(spaces.map((s) => listApps(s.id))),
    Promise.all(spaces.map((s) => listDatabases(s.id).catch(() => []))),
  ]);

  const entries: { kind: string; label: string; sub?: string; href: string }[] =
    [{ kind: "action", label: "New space", href: "/" }];

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
    for (const d of dbLists[i]) {
      entries.push({
        kind: "db",
        label: d.name,
        sub: s.name,
        href: `/spaces/${s.slug}/databases/${d.slug}`,
      });
    }
    entries.push({
      kind: "action",
      label: `Deploy app to ${s.name}`,
      sub: s.name,
      href: `/spaces/${s.slug}/new`,
    });
    entries.push({
      kind: "action",
      label: `Create database in ${s.name}`,
      sub: s.name,
      href: `/spaces/${s.slug}/databases`,
    });
  });

  return Response.json({ entries });
}
