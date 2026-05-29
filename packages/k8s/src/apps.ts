import { and, eq } from "drizzle-orm";
import { db, schema } from "@kubepush/db";
import { k8sClients, managedLabels } from "./client";
import { getSpaceBySlug } from "./spaces";
import { slugify } from "./util";

const BASE_DOMAIN = process.env.KUBEPUSH_BASE_DOMAIN ?? "localhost";

export async function listApps(spaceId: string) {
  return db
    .select()
    .from(schema.apps)
    .where(eq(schema.apps.spaceId, spaceId))
    .orderBy(schema.apps.createdAt);
}

export async function getApp(spaceId: string, slug: string) {
  const [app] = await db
    .select()
    .from(schema.apps)
    .where(and(eq(schema.apps.spaceId, spaceId), eq(schema.apps.slug, slug)))
    .limit(1);
  return app ?? null;
}

export type CreateAppInput = {
  spaceSlug: string;
  name: string;
  image: string;
  port?: number;
  env?: Record<string, string>;
};

export async function createApp(input: CreateAppInput) {
  const space = await getSpaceBySlug(input.spaceSlug);
  if (!space) throw new Error("Space not found");

  const slug = slugify(input.name);
  if (!slug) throw new Error("Invalid app name");

  const [app] = await db
    .insert(schema.apps)
    .values({
      spaceId: space.id,
      name: input.name,
      slug,
      source: "image",
      image: input.image,
      port: input.port ?? 80,
      env: input.env ?? {},
      status: "provisioning",
    })
    .returning();

  const [deployment] = await db
    .insert(schema.deployments)
    .values({ appId: app.id, image: input.image, status: "deploying" })
    .returning();

  try {
    await reconcileApp(space.namespace, space.slug, app);
    await db
      .update(schema.apps)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
    await db
      .update(schema.deployments)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(schema.deployments.id, deployment.id));
  } catch (err) {
    await db
      .update(schema.apps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
    await db
      .update(schema.deployments)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(schema.deployments.id, deployment.id));
    throw err;
  }

  return app;
}

type AppRow = typeof schema.apps.$inferSelect;

async function reconcileApp(
  namespace: string,
  spaceSlug: string,
  app: AppRow,
) {
  const { apps, core, net } = k8sClients();
  const labels = managedLabels({
    "kubepush.io/space": spaceSlug,
    "kubepush.io/app": app.slug,
    app: app.slug,
  });
  const env = Object.entries(app.env ?? {}).map(([name, value]) => ({
    name,
    value,
  }));

  await apply(
    apps.readNamespacedDeployment({ name: app.slug, namespace }),
    () =>
      apps.createNamespacedDeployment({
        namespace,
        body: {
          metadata: { name: app.slug, namespace, labels },
          spec: {
            replicas: app.replicas,
            selector: { matchLabels: { app: app.slug } },
            template: {
              metadata: { labels },
              spec: {
                containers: [
                  {
                    name: app.slug,
                    image: app.image!,
                    ports: [{ containerPort: app.port }],
                    env,
                    // Required: the space ResourceQuota rejects pods without
                    // CPU/memory requests + limits.
                    resources: {
                      requests: { cpu: "50m", memory: "64Mi" },
                      limits: { cpu: "500m", memory: "256Mi" },
                    },
                  },
                ],
              },
            },
          },
        },
      }),
  );

  await apply(
    core.readNamespacedService({ name: app.slug, namespace }),
    () =>
      core.createNamespacedService({
        namespace,
        body: {
          metadata: { name: app.slug, namespace, labels },
          spec: {
            selector: { app: app.slug },
            ports: [{ port: 80, targetPort: app.port }],
          },
        },
      }),
  );

  const host = `${app.slug}.${spaceSlug}.${BASE_DOMAIN}`;
  await apply(
    net.readNamespacedIngress({ name: app.slug, namespace }),
    () =>
      net.createNamespacedIngress({
        namespace,
        body: {
          metadata: { name: app.slug, namespace, labels },
          spec: {
            rules: [
              {
                host,
                http: {
                  paths: [
                    {
                      path: "/",
                      pathType: "Prefix",
                      backend: {
                        service: { name: app.slug, port: { number: 80 } },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      }),
  );
}

/** Create the resource only if the read 404s; ignore "already exists". */
async function apply(readPromise: Promise<unknown>, create: () => Promise<unknown>) {
  try {
    await readPromise;
    return; // already exists
  } catch {
    // fall through to create
  }
  await create();
}

export async function deleteApp(spaceSlug: string, slug: string) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) return;
  const app = await getApp(space.id, slug);
  if (!app) return;

  const { apps, core, net } = k8sClients();
  await Promise.allSettled([
    apps.deleteNamespacedDeployment({ name: slug, namespace: space.namespace }),
    core.deleteNamespacedService({ name: slug, namespace: space.namespace }),
    net.deleteNamespacedIngress({ name: slug, namespace: space.namespace }),
  ]);
  await db.delete(schema.apps).where(eq(schema.apps.id, app.id));
}
