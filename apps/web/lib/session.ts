import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth, isSetupComplete } from "@/lib/auth";
import { getSpaceBySlug } from "@korepush/k8s";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Gate a page: ensure setup is done and a user is signed in. */
export async function requireUser() {
  if (!(await isSetupComplete())) redirect("/setup");
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
type Space = NonNullable<Awaited<ReturnType<typeof getSpaceBySlug>>>;

function isAdmin(session: Session): boolean {
  return (session.user as { role?: string }).role === "admin";
}

/** A signed-in user may act on a space iff they own it (or are an admin). */
function ownsSpace(session: Session, space: Space | null): space is Space {
  return !!space && (space.ownerId === session.user.id || isAdmin(session));
}

/**
 * Page guard: signed-in AND owns the space, else 404 (not 403 — a foreign slug
 * is indistinguishable from a missing one, so ownership can't be enumerated).
 */
export async function requireSpacePage(slug: string) {
  const session = await requireUser();
  const space = await getSpaceBySlug(slug);
  if (!ownsSpace(session, space)) notFound();
  return { session, space };
}

/**
 * Server-action guard: throws "Not found" (caught by the action's try/catch →
 * { ok:false }) when the caller doesn't own the space. Returns the space so the
 * caller doesn't re-resolve it.
 */
export async function assertOwnsSpace(slug: string) {
  const session = await requireUser();
  const space = await getSpaceBySlug(slug);
  if (!ownsSpace(session, space)) throw new Error("Not found");
  return { session, space };
}

/**
 * Route-handler guard: resolves the space the caller is allowed to read, or a
 * Response (401/404) to early-return. Mirrors assertOwnsSpace for the API.
 */
export async function authorizeSpaceRequest(
  slug: string,
): Promise<{ space: Space } | Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const space = await getSpaceBySlug(slug);
  if (!ownsSpace(session, space)) {
    return new Response("Not found", { status: 404 });
  }
  return { space };
}
