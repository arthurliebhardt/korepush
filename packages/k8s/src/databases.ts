import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { db, schema } from "@korepush/db";
import { k8sClients } from "./client";
import { getSpaceBySlug, listSpaces } from "./spaces";
import { slugify, isUniqueViolation } from "./util";
import { createKoreDatabase, deleteKoreDatabase, patchKoreApp } from "./koreapp";

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

export async function createDatabase(input: {
  spaceSlug: string;
  name: string;
  engine?: string;
  stackId?: string;
}) {
  const space = await getSpaceBySlug(input.spaceSlug);
  if (!space) throw new Error("Space not found");
  const slug = slugify(input.name);
  if (!slug) throw new Error("Invalid database name");

  const engine = (input.engine ?? "postgres").toLowerCase();
  if (engine !== "postgres" && engine !== "redis") {
    throw new Error(`Unsupported database engine "${engine}".`);
  }
  const name = clusterName(slug);
  const [row] = await db
    .insert(schema.databases)
    .values({
      spaceId: space.id,
      name: input.name,
      slug,
      engine,
      // version is text; redis bakes redis:7-alpine, postgres pins the CNPG major.
      version: engine === "redis" ? "7" : "16",
      status: "provisioning",
      connectionSecret: `${name}-app`,
      stackId: input.stackId ?? null,
    })
    .returning()
    .catch((err) => {
      if (isUniqueViolation(err)) {
        throw new Error(`A database named "${input.name}" already exists in this space.`);
      }
      throw err;
    });

  try {
    // The operator reconciles the KoreDatabase by engine (CNPG / redis workload).
    // Do NOT thread version into the redis CR (it bakes its image tag).
    await createKoreDatabase(space.namespace, slug, { engine });
  } catch (err) {
    await db
      .update(schema.databases)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.databases.id, row.id));
    throw err;
  }
  return row;
}

export type DatabaseInfo = {
  phase: string;
  ready: boolean;
  connectionUri: string | null;
  host: string | null;
};

/** Live status + connection string for a database. Branches by engine: postgres
 *  probes the CNPG Cluster CR; redis probes its operator-managed Deployment. */
export async function getDatabaseInfo(
  namespace: string,
  slug: string,
  engine = "postgres",
): Promise<DatabaseInfo> {
  const { custom, core, apps } = k8sClients();
  const name = clusterName(slug);

  let ready = false;
  let phase = "provisioning";
  if (engine === "redis") {
    // Redis has no CR of its own beyond the KoreDatabase — probe the Deployment.
    const dep = await apps.readNamespacedDeployment({ name, namespace }).catch(() => null);
    ready = (dep?.status?.readyReplicas ?? 0) >= 1;
    phase = ready ? "running" : "provisioning";
  } else {
    // The CNPG Cluster CR is created asynchronously by the operator, so a 404 just
    // means "not provisioned yet" — report provisioning, NOT failed. A genuine
    // (non-404) error propagates to the caller, which falls back to provisioning.
    const cr = (await custom
      .getNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace,
        plural: "clusters",
        name,
      })
      .catch((e: unknown) => {
        if ((e as { code?: number })?.code === 404) return null;
        throw e;
      })) as { status?: { phase?: string; readyInstances?: number } } | null;
    if (cr) {
      phase = cr.status?.phase ?? "provisioning";
      ready = (cr.status?.readyInstances ?? 0) >= 1;
    }
  }

  let connectionUri: string | null = null;
  let host: string | null = null;
  if (ready) {
    // Uniform across engines: the `db-<slug>-app` Secret carries uri + host.
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

  // Detach any apps using this DB BEFORE removing its CNPG secret. The FK
  // (onDelete: set null) only updates Postgres — it never touches the cluster,
  // so without this the operator keeps injecting a secretKeyRef to the deleted
  // `db-<slug>-app` Secret and every pod crashes with CreateContainerConfigError.
  const attached = await db
    .select()
    .from(schema.apps)
    .where(
      and(eq(schema.apps.spaceId, space.id), eq(schema.apps.attachedDbId, row.id)),
    );
  for (const app of attached) {
    await db
      .update(schema.apps)
      .set({ attachedDbId: null, updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
    await patchKoreApp(space.namespace, app.slug, {
      spec: { database: null },
      restart: true,
    }).catch((err) => console.error("[db-detach]", app.slug, err));
  }

  // Delete the KoreDatabase CR; the operator's ownerReference GC removes the
  // materialised objects (CNPG Cluster, or the redis Deployment/Service/Secret).
  await deleteKoreDatabase(space.namespace, slug);
  // Non-CNPG engines (redis) own a PVC with NO ownerReference (data safety), so
  // CR-delete GC won't reclaim it — delete it explicitly (404-tolerant: it may
  // never have bound if provisioning failed). Postgres PVCs are CNPG-owned.
  if (row.engine !== "postgres") {
    await k8sClients()
      .core.deleteNamespacedPersistentVolumeClaim({ name: `${clusterName(slug)}-data`, namespace: space.namespace })
      .catch(() => {});
  }
  await db.delete(schema.databases).where(eq(schema.databases.id, row.id));
}

// ---------------------------------------------------------------------------
// Tenant DB stats — connect to a USER's CNPG database (never the control plane)
// to read live, read-only introspection (size, connections, tables). The
// connection URI is always resolved server-side from the owned database row;
// this layer just takes the already-resolved URI and reads against it safely.
// ---------------------------------------------------------------------------

// A transient, single-connection client with hard server-side ceilings baked
// into the startup packet (so user SQL can't reset them) — short-lived, torn
// down by the caller's finally.
function tenantConn(uri: string, statementTimeoutMs: number) {
  return postgres(uri, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    max_lifetime: 30,
    prepare: false,
    fetch_types: false,
    onnotice: () => {},
    connection: {
      application_name: "korepush-console",
      statement_timeout: statementTimeoutMs,
      idle_in_transaction_session_timeout: 10000,
      lock_timeout: 3000,
    },
  });
}

export type DbStats = {
  degraded: boolean;
  version: string | null;
  sizePretty: string | null;
  sizeBytes: number | null;
  activeConnections: number | null;
  maxConnections: number | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  tableCount: number | null;
  topTables: { name: string; bytes: number; pretty: string }[];
};

const EMPTY_STATS: DbStats = {
  degraded: true,
  version: null,
  sizePretty: null,
  sizeBytes: null,
  activeConnections: null,
  maxConnections: null,
  startedAt: null,
  uptimeSeconds: null,
  tableCount: null,
  topTables: [],
};

/** Read-only introspection, scoped to current_database(); degrades per-field. */
export async function getDatabaseStats(connectionUri: string): Promise<DbStats> {
  const sql = tenantConn(connectionUri, 4000);
  try {
    const one = async <T>(fn: () => Promise<T>): Promise<T | null> =>
      fn().catch(() => null);

    const [size, conns, maxc, started, tables, top, version] = await Promise.all([
      one(() => sql`SELECT pg_database_size(current_database()) AS bytes, pg_size_pretty(pg_database_size(current_database())) AS pretty`),
      one(() => sql`SELECT count(*)::int AS active FROM pg_stat_activity WHERE datname = current_database()`),
      one(() => sql`SELECT current_setting('max_connections')::int AS max`),
      one(() => sql`SELECT pg_postmaster_start_time() AS started_at, extract(epoch FROM (now() - pg_postmaster_start_time()))::bigint AS uptime`),
      one(() => sql`SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`),
      one(() => sql`SELECT n.nspname || '.' || c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes, pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p','m') AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10`),
      one(() => sql`SELECT current_setting('server_version') AS version`),
    ]);

    return {
      degraded: false,
      version: (version?.[0]?.version as string) ?? null,
      sizePretty: (size?.[0]?.pretty as string) ?? null,
      sizeBytes: size?.[0]?.bytes != null ? Number(size[0].bytes) : null,
      activeConnections: conns?.[0]?.active != null ? Number(conns[0].active) : null,
      maxConnections: maxc?.[0]?.max != null ? Number(maxc[0].max) : null,
      startedAt: started?.[0]?.started_at ? String(started[0].started_at) : null,
      uptimeSeconds: started?.[0]?.uptime != null ? Number(started[0].uptime) : null,
      tableCount: tables?.[0]?.tables != null ? Number(tables[0].tables) : null,
      topTables: (top ?? []).map((r: Record<string, unknown>) => ({
        name: String(r.name),
        bytes: Number(r.bytes),
        pretty: String(r.pretty),
      })),
    };
  } catch {
    return EMPTY_STATS;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * Adopt existing databases into the operator: create a KoreDatabase CR per
 * database (idempotent — the operator then stamps an ownerRef on the existing
 * CNPG Cluster). Run once on control-plane boot.
 */
export async function backfillKoreDatabases() {
  for (const space of await listSpaces()) {
    for (const d of await listDatabases(space.id)) {
      try {
        await createKoreDatabase(space.namespace, d.slug, { engine: d.engine });
      } catch (err) {
        console.error("[backfill-db]", space.slug, d.slug, err);
      }
    }
  }
}
