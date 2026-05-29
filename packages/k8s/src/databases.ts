import { and, eq } from "drizzle-orm";
import { db, schema } from "@korepush/db";
import { k8sClients, managedLabels } from "./client";
import { getSpaceBySlug } from "./spaces";
import { slugify } from "./util";

// CloudNativePG provisions a Postgres Cluster per database; it creates a
// `<cluster>-app` Secret (key `uri` = connection string) and a `<cluster>-rw`
// read-write Service.
const CNPG_GROUP = "postgresql.cnpg.io";
const CNPG_VERSION = "v1";

const clusterName = (slug: string) => `db-${slug}`;

export async function listDatabases(spaceId: string) {
  return db
    .select()
    .from(schema.databases)
    .where(eq(schema.databases.spaceId, spaceId))
    .orderBy(schema.databases.createdAt);
}

export async function getDatabase(spaceId: string, slug: string) {
  const [row] = await db
    .select()
    .from(schema.databases)
    .where(
      and(eq(schema.databases.spaceId, spaceId), eq(schema.databases.slug, slug)),
    )
    .limit(1);
  return row ?? null;
}

export async function createDatabase(input: { spaceSlug: string; name: string }) {
  const space = await getSpaceBySlug(input.spaceSlug);
  if (!space) throw new Error("Space not found");
  const slug = slugify(input.name);
  if (!slug) throw new Error("Invalid database name");

  const name = clusterName(slug);
  const [row] = await db
    .insert(schema.databases)
    .values({
      spaceId: space.id,
      name: input.name,
      slug,
      engine: "postgres",
      status: "provisioning",
      connectionSecret: `${name}-app`,
    })
    .returning();

  try {
    await ensureLimitRange(space.namespace);
    await createCnpgCluster(space.namespace, space.slug, name);
  } catch (err) {
    await db
      .update(schema.databases)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.databases.id, row.id));
    throw err;
  }
  return row;
}

async function createCnpgCluster(
  namespace: string,
  spaceSlug: string,
  name: string,
) {
  const { custom } = k8sClients();
  await custom.createNamespacedCustomObject({
    group: CNPG_GROUP,
    version: CNPG_VERSION,
    namespace,
    plural: "clusters",
    body: {
      apiVersion: `${CNPG_GROUP}/${CNPG_VERSION}`,
      kind: "Cluster",
      metadata: {
        name,
        namespace,
        labels: managedLabels({ "korepush.io/space": spaceSlug }),
      },
      // No bootstrap block → CNPG creates db "app" owned by "app" + the
      // `<name>-app` secret. instances:1 suits single-node local-path storage.
      spec: {
        instances: 1,
        storage: { size: "5Gi" },
        resources: {
          requests: { cpu: "100m", memory: "256Mi" },
          limits: { cpu: "1", memory: "1Gi" },
        },
      },
    },
  });
}

export type DatabaseInfo = {
  phase: string;
  ready: boolean;
  connectionUri: string | null;
  host: string | null;
};

/** Live status + connection string for a database (from the CNPG Cluster + secret). */
export async function getDatabaseInfo(
  namespace: string,
  slug: string,
): Promise<DatabaseInfo> {
  const { custom, core } = k8sClients();
  const name = clusterName(slug);

  let ready = false;
  let phase = "provisioning";
  try {
    const cr = (await custom.getNamespacedCustomObject({
      group: CNPG_GROUP,
      version: CNPG_VERSION,
      namespace,
      plural: "clusters",
      name,
    })) as { status?: { phase?: string; readyInstances?: number } };
    phase = cr.status?.phase ?? "provisioning";
    ready = (cr.status?.readyInstances ?? 0) >= 1;
  } catch {
    return { phase: "failed", ready: false, connectionUri: null, host: null };
  }

  let connectionUri: string | null = null;
  let host: string | null = null;
  if (ready) {
    const sec = await core
      .readNamespacedSecret({ name: `${name}-app`, namespace })
      .catch(() => null);
    const dec = (k: string) =>
      sec?.data?.[k] ? Buffer.from(sec.data[k], "base64").toString("utf8") : null;
    connectionUri = dec("uri");
    host = dec("host");
  }
  return { phase, ready, connectionUri, host };
}

export async function deleteDatabase(spaceSlug: string, slug: string) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) return;
  const row = await getDatabase(space.id, slug);
  if (!row) return;
  try {
    await k8sClients().custom.deleteNamespacedCustomObject({
      group: CNPG_GROUP,
      version: CNPG_VERSION,
      namespace: space.namespace,
      plural: "clusters",
      name: clusterName(slug),
    });
  } catch {
    // already gone
  }
  await db.delete(schema.databases).where(eq(schema.databases.id, row.id));
}

/**
 * A LimitRange so pods without explicit requests/limits (e.g. CNPG's) still
 * satisfy the space ResourceQuota.
 */
async function ensureLimitRange(namespace: string) {
  const { core } = k8sClients();
  const existing = await core
    .readNamespacedLimitRange({ name: "korepush-defaults", namespace })
    .catch(() => null);
  if (existing) return;
  await core.createNamespacedLimitRange({
    namespace,
    body: {
      metadata: { name: "korepush-defaults", namespace },
      spec: {
        limits: [
          {
            type: "Container",
            _default: { cpu: "1", memory: "1Gi" },
            defaultRequest: { cpu: "50m", memory: "64Mi" },
          },
        ],
      },
    },
  });
}
