import { eq } from "drizzle-orm";
import { db, schema } from "@kubepush/db";
import { k8sClients, managedLabels } from "./client";
import { slugify } from "./util";

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
    await provisionNamespace(namespace, slug);
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

async function provisionNamespace(namespace: string, slug: string) {
  const { core } = k8sClients();
  const labels = managedLabels({ "kubepush.io/space": slug });

  await core.createNamespace({
    body: { metadata: { name: namespace, labels } },
  });

  // Sensible starter quota; tunable per-space later.
  await core.createNamespacedResourceQuota({
    namespace,
    body: {
      metadata: { name: "kubepush-quota", labels },
      spec: {
        hard: {
          "requests.cpu": "2",
          "requests.memory": "4Gi",
          "limits.cpu": "4",
          "limits.memory": "8Gi",
          pods: "20",
        },
      },
    },
  });
}

export async function deleteSpace(slug: string) {
  const space = await getSpaceBySlug(slug);
  if (!space) return;
  try {
    await k8sClients().core.deleteNamespace({ name: space.namespace });
  } catch {
    // Namespace may already be gone; proceed to remove the record.
  }
  await db.delete(schema.spaces).where(eq(schema.spaces.id, space.id));
}
