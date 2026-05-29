import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@korepush/db";
import { k8sClients, managedLabels } from "./client";
import { getSpaceBySlug } from "./spaces";
import { slugify } from "./util";
import {
  createBuildJob,
  getBuildJobPhase,
  buildImageRef,
  buildJobName,
} from "./build";

const BASE_DOMAIN = process.env.KOREPUSH_BASE_DOMAIN ?? "localhost";

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
    "korepush.io/space": spaceSlug,
    "korepush.io/app": app.slug,
    app: app.slug,
  });
  const env = Object.entries(app.env ?? {}).map(([name, value]) => ({
    name,
    value,
  }));

  const container = {
    name: app.slug,
    image: app.image!,
    ports: [{ containerPort: app.port }],
    env,
    // Required: the space ResourceQuota rejects pods without requests + limits.
    resources: {
      requests: { cpu: "50m", memory: "64Mi" },
      limits: { cpu: "500m", memory: "256Mi" },
    },
  };
  // Create the Deployment, or update its image/replicas/env on redeploy.
  const existing = await apps
    .readNamespacedDeployment({ name: app.slug, namespace })
    .catch(() => null);
  if (!existing) {
    await apps.createNamespacedDeployment({
      namespace,
      body: {
        metadata: { name: app.slug, namespace, labels },
        spec: {
          replicas: app.replicas,
          selector: { matchLabels: { app: app.slug } },
          template: { metadata: { labels }, spec: { containers: [container] } },
        },
      },
    });
  } else {
    existing.spec!.replicas = app.replicas;
    existing.spec!.template.spec!.containers = [container];
    await apps.replaceNamespacedDeployment({
      name: app.slug,
      namespace,
      body: existing,
    });
  }

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

/* ──────────────────────────────────────────────────────────
 * Git apps: create -> build (k8s Job) -> deploy the built image
 * ────────────────────────────────────────────────────────── */

export type CreateGitAppInput = {
  spaceSlug: string;
  name: string;
  repoUrl: string;
  gitRef?: string;
  port?: number;
  env?: Record<string, string>;
};

export async function createGitApp(input: CreateGitAppInput) {
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
      source: "git",
      repoUrl: input.repoUrl,
      gitRef: input.gitRef || "main",
      port: input.port ?? 3000,
      env: input.env ?? {},
      status: "pending",
    })
    .returning();
  return app;
}

/** Queue a build: records a deployment and creates the build Job. */
export async function triggerGitBuild(
  spaceSlug: string,
  appSlug: string,
  trigger = "manual",
) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const app = await getApp(space.id, appSlug);
  if (!app) throw new Error("App not found");
  if (app.source !== "git" || !app.repoUrl) {
    throw new Error("App is not a git app");
  }

  const [deployment] = await db
    .insert(schema.deployments)
    .values({ appId: app.id, status: "building", trigger })
    .returning();

  const tag = deployment.id.slice(0, 8);
  const image = buildImageRef(space.slug, app.slug, tag);
  await db
    .update(schema.deployments)
    .set({ image })
    .where(eq(schema.deployments.id, deployment.id));

  const jobName = buildJobName(app.slug, tag);
  try {
    await createBuildJob({
      jobName,
      appSlug: app.slug,
      repoUrl: app.repoUrl,
      gitRef: app.gitRef || "main",
      image,
    });
    await db
      .update(schema.apps)
      .set({ status: "provisioning", updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
  } catch (err) {
    await db
      .update(schema.deployments)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(schema.deployments.id, deployment.id));
    throw err;
  }
  return { deploymentId: deployment.id, jobName, image };
}

/**
 * Idempotently advance a build: if its Job succeeded, deploy the built image;
 * if it failed, mark failed. Safe to call repeatedly (e.g. from the log stream
 * and on page load). Returns the current deployment status.
 */
export async function finalizeBuild(deploymentId: string): Promise<string> {
  const [dep] = await db
    .select()
    .from(schema.deployments)
    .where(eq(schema.deployments.id, deploymentId))
    .limit(1);
  if (!dep) return "unknown";
  if (dep.status !== "building" && dep.status !== "deploying") return dep.status;

  const [app] = await db
    .select()
    .from(schema.apps)
    .where(eq(schema.apps.id, dep.appId))
    .limit(1);
  if (!app) return dep.status;
  const [space] = await db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.id, app.spaceId))
    .limit(1);
  if (!space) return dep.status;

  const phase = await getBuildJobPhase(buildJobName(app.slug, dep.id.slice(0, 8)));

  if (phase === "succeeded") {
    await db
      .update(schema.apps)
      .set({ image: dep.image, status: "running", updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
    await reconcileApp(space.namespace, space.slug, { ...app, image: dep.image });
    await db
      .update(schema.deployments)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(schema.deployments.id, dep.id));
    return "succeeded";
  }
  if (phase === "failed") {
    await db
      .update(schema.apps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
    await db
      .update(schema.deployments)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(schema.deployments.id, dep.id));
    return "failed";
  }
  return dep.status;
}

export async function listDeployments(appId: string) {
  return db
    .select()
    .from(schema.deployments)
    .where(eq(schema.deployments.appId, appId))
    .orderBy(desc(schema.deployments.createdAt))
    .limit(20);
}

export async function latestBuildingDeployment(appId: string) {
  const [dep] = await db
    .select()
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.appId, appId),
        eq(schema.deployments.status, "building"),
      ),
    )
    .orderBy(desc(schema.deployments.createdAt))
    .limit(1);
  return dep ?? null;
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
