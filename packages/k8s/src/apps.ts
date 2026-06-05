import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@korepush/db";
import { k8sClients, managedLabels } from "./client";
import { getSpaceBySlug, listSpaces } from "./spaces";
import { slugify, isUniqueViolation } from "./util";
import {
  createBuildJob,
  getBuildJobPhase,
  getBuildPodName,
  buildImageRef,
  buildJobName,
  BUILD_NS,
} from "./build";
import { getPodLogs } from "./pods";
// Routing + TLS leaf helpers live in the DB-free ./routing module so the
// operator can share them without importing this (DB-coupled) file.
import {
  BASE_DOMAIN,
  CM_GROUP,
  CM_VERSION,
  GW_NS,
  domainSecretName,
  removeHttpsCert,
  getNodeIp,
  dnsPointsHere,
} from "./routing";
// Runtime reconcile now lives in the operator; the control plane authors CRs.
import {
  buildKoreAppSpec,
  envSpec,
  createKoreApp,
  patchKoreApp,
  deleteKoreApp,
  type VolumeSpec,
  type HealthcheckSpec,
} from "./koreapp";

export { getNodeIp } from "./routing";

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
  cpuLimit?: string;
  memoryLimit?: string;
  command?: string[];
  args?: string[];
  healthcheck?: {
    test: string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    startPeriod?: number;
  };
  volumes?: VolumeSpec[];
  stackId?: string;
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
      cpuLimit: input.cpuLimit ?? null,
      memoryLimit: input.memoryLimit ?? null,
      command: input.command ?? null,
      args: input.args ?? null,
      healthcheck: input.healthcheck ?? null,
      volumes: input.volumes ?? [],
      stackId: input.stackId ?? null,
      status: "provisioning",
    })
    .returning()
    .catch((err) => {
      if (isUniqueViolation(err)) {
        throw new Error(`An app named "${input.name}" already exists in this space.`);
      }
      throw err;
    });

  const [deployment] = await db
    .insert(schema.deployments)
    .values({ appId: app.id, image: input.image, status: "deploying" })
    .returning();

  try {
    // Create the KoreApp CR; the operator reconciles it into the workload.
    await createKoreApp(space.namespace, slug, buildKoreAppSpec(app));
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

type AppDomainRow = typeof schema.appDomains.$inferSelect;

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Attach a custom domain to an app. The cert provisions once DNS points here. */
export async function addAppDomain(
  spaceSlug: string,
  appSlug: string,
  hostRaw: string,
  useStaging = false,
) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const app = await getApp(space.id, appSlug);
  if (!app) throw new Error("App not found");

  const host = hostRaw.trim().toLowerCase();
  if (!DOMAIN_RE.test(host)) {
    throw new Error("Enter a valid domain, e.g. shop.example.com");
  }
  if (host === BASE_DOMAIN || host.endsWith(`.${BASE_DOMAIN}`)) {
    throw new Error("That domain is managed automatically by korepush.");
  }

  try {
    await db.insert(schema.appDomains).values({
      appId: app.id,
      host,
      secretName: domainSecretName(app.slug, host),
      useStaging,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("That domain is already in use.");
    throw err;
  }
  // The domain stays out of the CR spec until it passes the DNS precheck (see
  // refreshAppDomainStatus) — only then does the operator provision its cert.
  return { host };
}

export async function removeAppDomain(
  spaceSlug: string,
  appSlug: string,
  host: string,
) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) return;
  const app = await getApp(space.id, appSlug);
  if (!app) return;
  const [d] = await db
    .select()
    .from(schema.appDomains)
    .where(
      and(
        eq(schema.appDomains.appId, app.id),
        eq(schema.appDomains.host, host.toLowerCase()),
      ),
    )
    .limit(1);
  if (!d) return;

  await db.delete(schema.appDomains).where(eq(schema.appDomains.id, d.id));
  // Remove the host from the CR spec FIRST, so a reconcile racing in this gap
  // can't re-provision its cert; THEN tear down the cert/Gateway ref (the
  // operator only adds certs for hosts still in spec.domains — it can't know
  // one was removed, so the control plane must clean it up).
  const remaining = (await listAppDomains(app.id))
    .filter((r) => r.status !== "pending")
    .map((r) => ({ host: r.host, staging: r.useStaging }));
  await patchKoreApp(space.namespace, app.slug, { spec: { domains: remaining } });
  await removeHttpsCert(d.secretName);
}

export async function listAppDomains(appId: string) {
  return db
    .select()
    .from(schema.appDomains)
    .where(eq(schema.appDomains.appId, appId))
    .orderBy(schema.appDomains.createdAt);
}

/**
 * Re-evaluate every custom domain for an app: a pending domain whose DNS now
 * points here advances to "issuing" (and gets its cert requested via reconcile);
 * an issuing domain's cert-manager Certificate Ready condition maps to
 * active/error. Persists status + returns the fresh list (drives the UI poll).
 */
export async function refreshAppDomainStatus(
  spaceSlug: string,
  appSlug: string,
): Promise<AppDomainRow[]> {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) return [];
  const app = await getApp(space.id, appSlug);
  if (!app) return [];
  const domains = await db
    .select()
    .from(schema.appDomains)
    .where(eq(schema.appDomains.appId, app.id));
  if (domains.length === 0) return [];

  const autoHost = `${app.slug}.${space.slug}.${BASE_DOMAIN}`;
  const serverIp = await getNodeIp();
  const { custom } = k8sClients();
  let advanced = false;

  for (const d of domains) {
    if (d.status === "pending") {
      if (await dnsPointsHere(d.host, autoHost, serverIp)) {
        await db
          .update(schema.appDomains)
          .set({ status: "issuing", statusMessage: null })
          .where(eq(schema.appDomains.id, d.id));
        advanced = true;
      }
      continue;
    }
    const cert = (await custom
      .getNamespacedCustomObject({
        group: CM_GROUP,
        version: CM_VERSION,
        namespace: GW_NS, // certs live with the shared Gateway in kube-system
        plural: "certificates",
        name: d.secretName,
      })
      .catch(() => null)) as {
      status?: { conditions?: { type: string; status: string; reason?: string; message?: string }[] };
    } | null;
    const ready = cert?.status?.conditions?.find((c) => c.type === "Ready");
    let status = d.status;
    let message: string | null = d.statusMessage;
    if (ready?.status === "True") {
      status = "active";
      message = null;
    } else if (ready) {
      status = ready.reason === "Failed" ? "error" : "issuing";
      message = ready.message ?? null;
    }
    if (status !== d.status || message !== d.statusMessage) {
      await db
        .update(schema.appDomains)
        .set({ status, statusMessage: message })
        .where(eq(schema.appDomains.id, d.id));
    }
  }

  const fresh = await listAppDomains(app.id);
  if (advanced) {
    // A domain just passed the precheck — sync the non-pending set onto the CR
    // so the operator provisions its cert + route.
    const domains = fresh
      .filter((d) => d.status !== "pending")
      .map((d) => ({ host: d.host, staging: d.useStaging }));
    await patchKoreApp(space.namespace, app.slug, { spec: { domains } });
  }
  return fresh;
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
  installCmd?: string | null;
  buildCmd?: string | null;
  startCmd?: string | null;
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
      installCmd: input.installCmd || null,
      buildCmd: input.buildCmd || null,
      startCmd: input.startCmd || null,
      status: "pending",
    })
    .returning()
    .catch((err) => {
      if (isUniqueViolation(err)) {
        throw new Error(`An app named "${input.name}" already exists in this space.`);
      }
      throw err;
    });
  // Create the CR now (no image yet → operator reports Pending); the build
  // pipeline PATCHes spec.image when it succeeds (finalizeBuild).
  await createKoreApp(space.namespace, slug, buildKoreAppSpec(app));
  return app;
}

/** All environments of a project (sibling apps sharing a projectId). */
export async function listProjectEnvs(spaceId: string, projectId: string) {
  return db
    .select()
    .from(schema.apps)
    .where(and(eq(schema.apps.spaceId, spaceId), eq(schema.apps.projectId, projectId)))
    .orderBy(schema.apps.createdAt);
}

/**
 * Add a branch-mapped environment to a git app: a sibling app sharing the
 * project's id, tracking `branch`, with its own slug/URL/env/db. The push
 * webhook already builds it on pushes to `branch` (it matches by repo+gitRef).
 * The caller (action) then mints a clone token + triggers the first build.
 */
export async function addEnvironment(
  spaceSlug: string,
  appSlug: string,
  branch: string,
  envName: string,
) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const parent = await getApp(space.id, appSlug);
  if (!parent) throw new Error("App not found");
  if (parent.source !== "git" || !parent.repoUrl) {
    throw new Error("Environments are only supported for git apps");
  }
  const env = slugify(envName);
  if (!env) throw new Error("Invalid environment name");

  // Base the sibling slug on the project's prod root (so adding from any env
  // yields `<root>-<env>`, not a compounding suffix).
  const [root] = await db
    .select()
    .from(schema.apps)
    .where(
      and(
        eq(schema.apps.projectId, parent.projectId),
        eq(schema.apps.environment, "prod"),
      ),
    )
    .limit(1);
  const baseSlug = root?.slug ?? parent.slug;
  if (env === "prod" || env === (root ?? parent).environment) {
    throw new Error(`The "${env}" environment already exists`);
  }
  const slug = `${baseSlug}-${env}`.slice(0, 40);
  if (await getApp(space.id, slug)) {
    throw new Error("An environment with that name already exists");
  }

  const [app] = await db
    .insert(schema.apps)
    .values({
      spaceId: space.id,
      projectId: parent.projectId,
      environment: env,
      name: `${root?.name ?? parent.name} (${env})`,
      slug,
      source: "git",
      repoUrl: parent.repoUrl,
      gitRef: branch || "main",
      installCmd: parent.installCmd,
      buildCmd: parent.buildCmd,
      startCmd: parent.startCmd,
      rootDir: parent.rootDir,
      port: parent.port,
      replicas: parent.replicas,
      githubInstallationId: parent.githubInstallationId,
      status: "pending",
    })
    .returning();
  await createKoreApp(space.namespace, slug, buildKoreAppSpec(app));
  return app;
}

/** Queue a build: records a deployment and creates the build Job. */
export async function triggerGitBuild(
  spaceSlug: string,
  appSlug: string,
  trigger = "manual",
  cloneToken?: string,
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
      cloneToken,
      installCmd: app.installCmd,
      buildCmd: app.buildCmd,
      startCmd: app.startCmd,
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

// A build Job is TTL-GC'd 1h after it finishes (build.ts ttlSecondsAfterFinished).
// Once it's gone, getBuildJobPhase returns "unknown" forever; treat a build older
// than this (Job missing) as failed so it can't sit in "building" indefinitely.
const BUILD_STALE_MS = 2 * 60 * 60 * 1000;

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

  const jobName = buildJobName(app.slug, dep.id.slice(0, 8));
  const phase = await getBuildJobPhase(jobName);

  // Capture the build pod's logs once, at the terminal transition — the Job is
  // still within its TTL here, so this is the last chance to keep them.
  const captureBuildLog = async (): Promise<string | null> => {
    const pod = await getBuildPodName(jobName).catch(() => null);
    if (!pod) return null;
    const raw = await getPodLogs(BUILD_NS, pod, "build").catch(() => null);
    return raw ? capBuildLog(raw) : null;
  };

  if (phase === "succeeded") {
    const buildLog = await captureBuildLog();
    await db
      .update(schema.apps)
      .set({ image: dep.image, status: "running", updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
    await patchKoreApp(space.namespace, app.slug, { spec: { image: dep.image } });
    await db
      .update(schema.deployments)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        ...(buildLog ? { buildLog } : {}),
      })
      .where(eq(schema.deployments.id, dep.id));
    return "succeeded";
  }
  if (
    phase === "failed" ||
    // Job GC'd ("unknown") and the build is too old to ever be observed again.
    (phase === "unknown" &&
      Date.now() - new Date(dep.createdAt).getTime() > BUILD_STALE_MS)
  ) {
    const buildLog = await captureBuildLog();
    await db
      .update(schema.apps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
    await db
      .update(schema.deployments)
      .set({
        status: "failed",
        finishedAt: new Date(),
        ...(buildLog ? { buildLog } : {}),
      })
      .where(eq(schema.deployments.id, dep.id));
    return "failed";
  }
  return dep.status;
}

// Cap a captured build log to the last N bytes (keep the tail — the useful end
// of a build), so a giant BuildKit transcript can't bloat the row.
function capBuildLog(s: string, maxBytes = 256 * 1024): string {
  return s.length > maxBytes ? s.slice(s.length - maxBytes) : s;
}

/**
 * Finalize every build whose Job has completed: deploy the image (PATCH
 * spec.image) or mark it failed. finalizeBuild is otherwise only invoked when
 * someone is looking at the app page / build logs, so a push-to-deploy build
 * that finishes unobserved would never land — this closes that gap. Idempotent.
 */
export async function finalizePendingBuilds() {
  const pending = await db
    .select({ id: schema.deployments.id })
    .from(schema.deployments)
    .where(
      or(
        eq(schema.deployments.status, "building"),
        eq(schema.deployments.status, "deploying"),
      ),
    )
    // Oldest first so stuck rows are reaped (and freed from the window) before
    // newer ones, rather than an arbitrary 50 that could starve real builds.
    .orderBy(schema.deployments.createdAt)
    .limit(50);
  for (const d of pending) {
    await finalizeBuild(d.id).catch((err) =>
      console.error("[build-finalizer]", d.id, err),
    );
  }
}

let buildFinalizerTimer: ReturnType<typeof setInterval> | null = null;
let buildFinalizerBusy = false;

/**
 * Poll for completed builds and finalize them (control-plane boot; single
 * replica → no leader election). Builds stay control-plane (GitHub keys +
 * BuildKit Jobs), so build completion drives spec.image from here — the
 * operator only deploys once the image lands on the CR.
 */
export function startBuildFinalizer(intervalMs = 15_000) {
  if (buildFinalizerTimer || process.env.KOREPUSH_DISABLE_BUILD_FINALIZER) return;
  const tick = async () => {
    if (buildFinalizerBusy) return; // never overlap a slow pass
    buildFinalizerBusy = true;
    try {
      await finalizePendingBuilds();
    } catch (err) {
      console.error("[build-finalizer]", err);
    } finally {
      buildFinalizerBusy = false;
    }
  };
  buildFinalizerTimer = setInterval(tick, intervalMs);
}

/**
 * Roll an app back to a prior SUCCEEDED deployment's image — no rebuild. The
 * target tag is already in the registry, so we just re-point app.image and
 * re-reconcile (k8s rolling update), recording a new deployment row
 * (trigger="rollback"). Env/port/replicas are NOT reverted — they live on the
 * apps row and are reapplied live to the old image.
 */
export async function rollbackDeployment(
  spaceSlug: string,
  appSlug: string,
  targetDeploymentId: string,
) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const app = await getApp(space.id, appSlug);
  if (!app) throw new Error("App not found");

  const [target] = await db
    .select()
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.id, targetDeploymentId),
        eq(schema.deployments.appId, app.id), // scope: no cross-app ids
      ),
    )
    .limit(1);
  if (!target) throw new Error("Deployment not found");
  if (target.status !== "succeeded" || !target.image) {
    throw new Error("Can only roll back to a succeeded deployment");
  }
  if (app.image === target.image) {
    throw new Error("App is already on this image");
  }

  const [dep] = await db
    .insert(schema.deployments)
    .values({
      appId: app.id,
      image: target.image,
      commitSha: target.commitSha,
      status: "deploying",
      trigger: "rollback",
    })
    .returning();

  try {
    await db
      .update(schema.apps)
      .set({ image: target.image, status: "running", updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
    await patchKoreApp(space.namespace, app.slug, { spec: { image: target.image } });
    await db
      .update(schema.deployments)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(schema.deployments.id, dep.id));
  } catch (err) {
    await db
      .update(schema.apps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.apps.id, app.id));
    await db
      .update(schema.deployments)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(schema.deployments.id, dep.id));
    throw err;
  }
  return dep;
}

/** Git apps subscribed to a repo+branch (for push-to-deploy webhooks). */
export async function appsForRepoPush(repoFullName: string, branch: string) {
  const rows = await db
    .select({
      appSlug: schema.apps.slug,
      spaceSlug: schema.spaces.slug,
      repoUrl: schema.apps.repoUrl,
      gitRef: schema.apps.gitRef,
    })
    .from(schema.apps)
    .innerJoin(schema.spaces, eq(schema.apps.spaceId, schema.spaces.id))
    .where(eq(schema.apps.source, "git"));

  const norm = (u: string) =>
    u
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/^git@github\.com:/i, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
  const target = repoFullName.toLowerCase();

  return rows
    .filter(
      (r) =>
        r.repoUrl &&
        norm(r.repoUrl) === target &&
        (r.gitRef || "main") === branch,
    )
    .map((r) => ({ spaceSlug: r.spaceSlug, appSlug: r.appSlug }));
}

/** Latest deployment timestamp per app, for "last deployed" on the space cards. */
export async function lastDeployedAt(
  appIds: string[],
): Promise<Record<string, Date>> {
  if (appIds.length === 0) return {};
  const rows = await db
    .select({
      appId: schema.deployments.appId,
      createdAt: schema.deployments.createdAt,
    })
    .from(schema.deployments)
    .where(inArray(schema.deployments.appId, appIds))
    .orderBy(desc(schema.deployments.createdAt));
  const out: Record<string, Date> = {};
  for (const r of rows) if (!(r.appId in out)) out[r.appId] = r.createdAt;
  return out;
}

export async function listDeployments(appId: string) {
  return db
    .select()
    .from(schema.deployments)
    .where(eq(schema.deployments.appId, appId))
    .orderBy(desc(schema.deployments.createdAt))
    .limit(20);
}

// Fetch one deployment, scoped to its app so a foreign/guessed id can't be
// read (mirrors the rollback path's scoping).
export async function getDeployment(appId: string, deploymentId: string) {
  const [dep] = await db
    .select()
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.id, deploymentId),
        eq(schema.deployments.appId, appId),
      ),
    )
    .limit(1);
  return dep ?? null;
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

/**
 * Set an app's env: plain vars persist on the apps row + inline into the pod
 * spec; secret vars' VALUES live only in the per-app k8s Secret `<slug>-env`
 * (never in Postgres), injected via envFrom. A blank value for an existing
 * secret key keeps the current value (the editor never round-trips secrets).
 * Config-only — re-reconciles and rolls the pods, never rebuilds.
 */
export async function setAppEnv(
  spaceSlug: string,
  appSlug: string,
  opts: { plain: Record<string, string>; secrets: Record<string, string> },
) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const app = await getApp(space.id, appSlug);
  if (!app) throw new Error("App not found");

  // Don't let a var collide with the attached-database injection.
  if (app.attachedDbId && app.dbEnvVar) {
    if (app.dbEnvVar in opts.plain || app.dbEnvVar in opts.secrets) {
      throw new Error(
        `${app.dbEnvVar} is set by the attached database — detach it or rename the variable.`,
      );
    }
  }

  const { core } = k8sClients();
  const secretName = `${app.slug}-env`;
  const secretKeys = Object.keys(opts.secrets);

  if (secretKeys.length > 0) {
    const existing = await core
      .readNamespacedSecret({ name: secretName, namespace: space.namespace })
      .catch(() => null);
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.secrets)) {
      if (v === "" && existing?.data?.[k]) {
        data[k] = existing.data[k]; // already base64 — keep existing
      } else {
        data[k] = Buffer.from(v, "utf8").toString("base64");
      }
    }
    if (existing) {
      existing.data = data;
      await core.replaceNamespacedSecret({
        name: secretName,
        namespace: space.namespace,
        body: existing,
      });
    } else {
      await core.createNamespacedSecret({
        namespace: space.namespace,
        body: {
          metadata: {
            name: secretName,
            namespace: space.namespace,
            labels: managedLabels({ "korepush.io/app": app.slug }),
          },
          type: "Opaque",
          data,
        },
      });
    }
  } else {
    // No secrets left → remove the Secret entirely.
    await core
      .deleteNamespacedSecret({ name: secretName, namespace: space.namespace })
      .catch(() => {});
  }

  await db
    .update(schema.apps)
    .set({ env: opts.plain, secretKeys, updatedAt: new Date() })
    .where(eq(schema.apps.id, app.id));

  // Patch the CR's env/envFrom and bump the restart stamp so the operator rolls
  // pods even when only the referenced Secret's VALUES changed.
  await patchKoreApp(space.namespace, app.slug, {
    spec: {
      env: envSpec(opts.plain),
      envFrom: secretKeys.length ? [{ secretRef: { name: `${app.slug}-env` } }] : [],
    },
    restart: true,
  });
}

/** Attach a database: inject its connection string into the app + redeploy. */
export async function attachDatabase(
  spaceSlug: string,
  appSlug: string,
  databaseId: string,
  envVar?: string,
) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const app = await getApp(space.id, appSlug);
  if (!app) throw new Error("App not found");
  const [database] = await db
    .select()
    .from(schema.databases)
    .where(
      and(
        eq(schema.databases.id, databaseId),
        eq(schema.databases.spaceId, space.id),
      ),
    )
    .limit(1);
  if (!database) throw new Error("Database not found in this space");

  // Default the injected env var by engine (Redis apps expect REDIS_URL). The
  // connection Secret is uniform (db-<slug>-app key 'uri') regardless of engine.
  const finalVar = envVar ?? (database.engine === "redis" ? "REDIS_URL" : "DATABASE_URL");

  await db
    .update(schema.apps)
    .set({ attachedDbId: databaseId, dbEnvVar: finalVar, updatedAt: new Date() })
    .where(eq(schema.apps.id, app.id));
  // The operator resolves spec.database.name -> Secret db-<name>-app key 'uri'.
  await patchKoreApp(space.namespace, app.slug, {
    spec: { database: { name: database.slug, envVar: finalVar } },
  });
}

export async function detachDatabase(spaceSlug: string, appSlug: string) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) return;
  const app = await getApp(space.id, appSlug);
  if (!app) return;
  await db
    .update(schema.apps)
    .set({ attachedDbId: null, updatedAt: new Date() })
    .where(eq(schema.apps.id, app.id));
  await patchKoreApp(space.namespace, app.slug, { spec: { database: null } });
}

/**
 * Adopt existing apps into the operator: create a KoreApp CR per app from its
 * current DB state (idempotent — skips apps that already have a CR). Run once
 * on control-plane boot so an upgrade hands every running app to the operator
 * WITHOUT churn (the operator only stamps ownerReferences — a metadata-only
 * change that does not roll pods). Replaces the old in-server reconciler.
 */
export async function backfillKoreApps() {
  for (const space of await listSpaces()) {
    for (const app of await listApps(space.id)) {
      try {
        let dbSlug: string | null = null;
        if (app.attachedDbId) {
          const [d] = await db
            .select()
            .from(schema.databases)
            .where(eq(schema.databases.id, app.attachedDbId))
            .limit(1);
          dbSlug = d?.slug ?? null;
        }
        const domains = (await listAppDomains(app.id))
          .filter((d) => d.status !== "pending")
          .map((d) => ({ host: d.host, staging: d.useStaging }));
        await createKoreApp(
          space.namespace,
          app.slug,
          buildKoreAppSpec(app, { dbSlug, domains }),
        );
      } catch (err) {
        console.error("[backfill]", space.slug, app.slug, err);
      }
    }
  }
}

/**
 * Delete an app: remove its KoreApp CR — the operator's finalizer cleans the
 * cross-namespace certs + the env Secret, and ownerReferences GC the
 * Deployment/Service/HTTPRoutes. Then drop the DB row. The env Secret is also
 * deleted here best-effort, to cover an app that predates CR adoption.
 */
export async function deleteApp(spaceSlug: string, slug: string) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) return;
  const app = await getApp(space.id, slug);
  if (!app) return;

  await deleteKoreApp(space.namespace, slug);
  await k8sClients()
    .core.deleteNamespacedSecret({ name: `${slug}-env`, namespace: space.namespace })
    .catch(() => {});
  // PVCs carry no ownerReference (they survive CR deletion), so the operator
  // never reaps them — delete them explicitly here. This destroys the app's
  // persistent data; the UI delete flow warns about it.
  for (const v of app.volumes ?? []) {
    await k8sClients()
      .core.deleteNamespacedPersistentVolumeClaim({ name: `${slug}-${v.name}`, namespace: space.namespace })
      .catch(() => {});
  }
  await db.delete(schema.apps).where(eq(schema.apps.id, app.id));
}

/**
 * Replace an app's persistent volumes. Adding a volume creates its PVC (via the
 * operator on the next reconcile); REMOVING one deletes its PVC here (explicit,
 * user-initiated data loss) so storage is never silently orphaned. Size is
 * immutable once a volume exists — a size change on an existing name is ignored
 * (the live PVC can't resize on local-path).
 */
export async function setAppVolumes(
  spaceSlug: string,
  appSlug: string,
  volumes: VolumeSpec[],
) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const app = await getApp(space.id, appSlug);
  if (!app) throw new Error("App not found");

  const oldByName = new Map((app.volumes ?? []).map((v) => [v.name, v]));
  // Preserve the original size for a kept volume (size is immutable post-create).
  const next = volumes.map((v) => {
    const prev = oldByName.get(v.name);
    return prev ? { ...v, size: prev.size } : v;
  });
  const keptNames = new Set(next.map((v) => v.name));

  // Delete PVCs for dropped volumes (control plane holds PVC-delete RBAC).
  for (const v of app.volumes ?? []) {
    if (keptNames.has(v.name)) continue;
    await k8sClients()
      .core.deleteNamespacedPersistentVolumeClaim({ name: `${appSlug}-${v.name}`, namespace: space.namespace })
      .catch(() => {});
  }

  await db
    .update(schema.apps)
    .set({ volumes: next, updatedAt: new Date() })
    .where(eq(schema.apps.id, app.id));
  // Roll the pod so new mounts take effect (Recreate when volumes present).
  await patchKoreApp(space.namespace, appSlug, { spec: { volumes: next }, restart: true });
}

// In-place update of an IMAGE app's flat spec fields (used by compose re-import).
// `undefined` = leave a field as-is; an explicit value (incl. null) sets/clears
// it. NOTE: env/volumes/db-attach are NOT here — callers use setAppEnv /
// setAppVolumes / attachDatabase|detachDatabase (those have their own safe
// paths). PORT is intentionally absent — it's effectively immutable (the
// operator's Service is create-if-missing and the HTTPRoute hardcodes port 80,
// so an in-place port change would leave routing pointing at the old port).
export type UpdateAppInput = {
  image?: string;
  cpuLimit?: string | null;
  memoryLimit?: string | null;
  command?: string[] | null;
  args?: string[] | null;
  healthcheck?: HealthcheckSpec | null;
};

const normArr = (a: string[] | null | undefined) => (a && a.length ? a : null);
const normHc = (h: HealthcheckSpec | null | undefined) =>
  h?.test?.length && h.test[0] !== "NONE" ? h : null;
const jeq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function updateApp(
  spaceSlug: string,
  appSlug: string,
  updates: UpdateAppInput,
) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const app = await getApp(space.id, appSlug);
  if (!app) throw new Error("App not found");
  if (app.source !== "image") {
    throw new Error("Only image apps can be updated from compose.");
  }

  const spec: Record<string, unknown> = {};
  const dbPatch: Record<string, unknown> = {};

  if (updates.image !== undefined && updates.image !== app.image) {
    spec.image = updates.image;
    dbPatch.image = updates.image;
  }

  // Resources: merge-patch replaces spec.resources wholesale, so always send the
  // full {cpu?, memory?} (filling the untouched side from the current row), or
  // null to clear back to operator defaults.
  if (updates.cpuLimit !== undefined || updates.memoryLimit !== undefined) {
    const cpu = updates.cpuLimit !== undefined ? updates.cpuLimit : app.cpuLimit;
    const memory = updates.memoryLimit !== undefined ? updates.memoryLimit : app.memoryLimit;
    if (cpu !== app.cpuLimit || memory !== app.memoryLimit) {
      dbPatch.cpuLimit = cpu;
      dbPatch.memoryLimit = memory;
      spec.resources =
        cpu || memory
          ? { ...(cpu ? { cpu } : {}), ...(memory ? { memory } : {}) }
          : null;
    }
  }

  if (updates.command !== undefined && !jeq(normArr(updates.command), normArr(app.command))) {
    const v = normArr(updates.command);
    spec.command = v;
    dbPatch.command = v;
  }
  if (updates.args !== undefined && !jeq(normArr(updates.args), normArr(app.args))) {
    const v = normArr(updates.args);
    spec.args = v;
    dbPatch.args = v;
  }
  if (updates.healthcheck !== undefined && !jeq(normHc(updates.healthcheck), normHc(app.healthcheck))) {
    const v = normHc(updates.healthcheck);
    spec.healthcheck = v;
    dbPatch.healthcheck = v;
  }

  if (Object.keys(dbPatch).length === 0) return; // nothing actually changed

  await db
    .update(schema.apps)
    .set({ ...dbPatch, updatedAt: new Date() })
    .where(eq(schema.apps.id, app.id));
  // restart:true is MANDATORY: the operator's Deployment drift comparison
  // excludes resources/command/args/healthcheck, so without a restart stamp
  // those CR changes would silently never reach the live pod.
  await patchKoreApp(space.namespace, appSlug, { spec, restart: true });
}
