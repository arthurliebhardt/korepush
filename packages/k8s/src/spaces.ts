import { eq } from "drizzle-orm";
import { db, schema } from "@korepush/db";
import { slugify } from "./util";
import { createKoreSpace, deleteKoreSpace } from "./koreapp";

const NS_PREFIX = "ks-";

export async function listSpaces() {
  return db.select().from(schema.spaces).orderBy(schema.spaces.createdAt);
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
