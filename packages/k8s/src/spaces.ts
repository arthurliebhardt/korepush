import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@korepush/db";
import { slugify } from "./util";
import { createKoreSpace, deleteKoreSpace } from "./koreapp";

const NS_PREFIX = "ks-";

export async function listSpaces() {
  return db.select().from(schema.spaces).orderBy(schema.spaces.createdAt);
}

/** Spaces owned by one user (the dashboard scopes to this unless admin). */
export async function listSpacesForUser(ownerId: string) {
  return db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.ownerId, ownerId))
    .orderBy(schema.spaces.createdAt);
}

/**
 * Spaces (owner-scoped when ownerId is given) plus app/database counts and a
 * failed-app count for a rolled-up health dot. Counts come from the DB mirror —
 * cheap enough for the dashboard list (no per-space k8s calls).
 */
export async function listSpacesWithStats(ownerId?: string) {
  const spaces = ownerId
    ? await listSpacesForUser(ownerId)
    : await listSpaces();
  if (spaces.length === 0) return [];
  const ids = spaces.map((s) => s.id);
  const [apps, dbs] = await Promise.all([
    db
      .select({ spaceId: schema.apps.spaceId, status: schema.apps.status })
      .from(schema.apps)
      .where(inArray(schema.apps.spaceId, ids)),
    db
      .select({ spaceId: schema.databases.spaceId })
      .from(schema.databases)
      .where(inArray(schema.databases.spaceId, ids)),
  ]);
  return spaces.map((s) => {
    const own = apps.filter((a) => a.spaceId === s.id);
    return {
      ...s,
      appCount: own.length,
      failedApps: own.filter(
        (a) => a.status === "failed" || a.status === "degraded",
      ).length,
      dbCount: dbs.filter((d) => d.spaceId === s.id).length,
    };
  });
}

export async function getSpaceBySlug(slug: string) {
  const [space] = await db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.slug, slug))
    .limit(1);
  return space ?? null;
}

export async function createSpace(name: string, ownerId: string) {
  const slug = slugify(name);
  if (!slug) throw new Error("Invalid space name");
  const namespace = `${NS_PREFIX}${slug}`;

  const [space] = await db
    .insert(schema.spaces)
    .values({ name, slug, namespace, ownerId, status: "provisioning" })
    .returning();

  try {
    // The operator reconciles the KoreSpace into the Namespace + quota + limits.
    await createKoreSpace(slug, { displayName: name });
    await db
      .update(schema.spaces)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(schema.spaces.id, space.id));
  } catch (err) {
    await db
      .update(schema.spaces)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.spaces.id, space.id));
    throw err;
  }

  return { ...space, status: "running" as const };
}

export async function deleteSpace(slug: string) {
  const space = await getSpaceBySlug(slug);
  if (!space) return;
  // Delete the KoreSpace CR; the operator's ownerReference GC removes the
  // Namespace (and everything in it — KoreApp finalizers run as it terminates).
  await deleteKoreSpace(slug);
  await db.delete(schema.spaces).where(eq(schema.spaces.id, space.id));
}

/**
 * Adopt existing spaces into the operator: create a KoreSpace CR per space
 * (idempotent — the operator then stamps an ownerRef on the existing Namespace,
 * a metadata-only change). Run once on control-plane boot.
 */
export async function backfillKoreSpaces() {
  for (const space of await listSpaces()) {
    try {
      await createKoreSpace(space.slug, { displayName: space.name });
    } catch (err) {
      console.error("[backfill-space]", space.slug, err);
    }
  }
}
