import { desc, eq } from "drizzle-orm";
import { db, schema } from "@korepush/db";

// Cross-space aggregations for the global nav pages (Deployments / Databases /
// Domains). Owner-scoped unless ownerId is omitted (admin = whole platform).

export async function listAllDeployments(ownerId?: string) {
  const q = db
    .select({
      id: schema.deployments.id,
      status: schema.deployments.status,
      image: schema.deployments.image,
      commitSha: schema.deployments.commitSha,
      trigger: schema.deployments.trigger,
      createdAt: schema.deployments.createdAt,
      finishedAt: schema.deployments.finishedAt,
      appSlug: schema.apps.slug,
      appName: schema.apps.name,
      gitRef: schema.apps.gitRef,
      spaceSlug: schema.spaces.slug,
    })
    .from(schema.deployments)
    .innerJoin(schema.apps, eq(schema.deployments.appId, schema.apps.id))
    .innerJoin(schema.spaces, eq(schema.apps.spaceId, schema.spaces.id))
    .$dynamic();
  if (ownerId) q.where(eq(schema.spaces.ownerId, ownerId));
  return q.orderBy(desc(schema.deployments.createdAt)).limit(100);
}

export async function listAllDatabases(ownerId?: string) {
  const q = db
    .select({
      id: schema.databases.id,
      name: schema.databases.name,
      slug: schema.databases.slug,
      engine: schema.databases.engine,
      version: schema.databases.version,
      status: schema.databases.status,
      spaceSlug: schema.spaces.slug,
      spaceName: schema.spaces.name,
    })
    .from(schema.databases)
    .innerJoin(schema.spaces, eq(schema.databases.spaceId, schema.spaces.id))
    .$dynamic();
  if (ownerId) q.where(eq(schema.spaces.ownerId, ownerId));
  return q.orderBy(desc(schema.databases.createdAt));
}

export async function listAllDomains(ownerId?: string) {
  const q = db
    .select({
      id: schema.appDomains.id,
      host: schema.appDomains.host,
      status: schema.appDomains.status,
      useStaging: schema.appDomains.useStaging,
      appSlug: schema.apps.slug,
      appName: schema.apps.name,
      spaceSlug: schema.spaces.slug,
    })
    .from(schema.appDomains)
    .innerJoin(schema.apps, eq(schema.appDomains.appId, schema.apps.id))
    .innerJoin(schema.spaces, eq(schema.apps.spaceId, schema.spaces.id))
    .$dynamic();
  if (ownerId) q.where(eq(schema.spaces.ownerId, ownerId));
  return q.orderBy(desc(schema.appDomains.createdAt));
}
