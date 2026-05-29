import type { V1EnvVar } from "@kubernetes/client-node";
import { promises as dns } from "node:dns";
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
const CM_GROUP = "cert-manager.io";
const CM_VERSION = "v1";

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
  const env: V1EnvVar[] = Object.entries(app.env ?? {}).map(
    ([name, value]) => ({ name, value }),
  );
  // Buildpack/Railpack (and most frameworks) bind to $PORT; inject it so a
  // deployed app listens on its declared container port without extra config.
  if (!env.some((e) => e.name === "PORT")) {
    env.push({ name: "PORT", value: String(app.port) });
  }
  // Attached database: inject its connection string from the CNPG secret.
  if (app.attachedDbId) {
    const [database] = await db
      .select()
      .from(schema.databases)
      .where(eq(schema.databases.id, app.attachedDbId))
      .limit(1);
    if (database?.connectionSecret) {
      env.push({
        name: app.dbEnvVar || "DATABASE_URL",
        valueFrom: {
          secretKeyRef: { name: database.connectionSecret, key: "uri" },
        },
      });
    }
  }

  const container = {
    name: app.slug,
    image: app.image!,
    ports: [{ containerPort: app.port }],
    env,
    // Secret env vars: inject the whole per-app Secret via envFrom so values
    // never appear inline in the Deployment spec. Explicit `env` entries (PORT,
    // the attached-db secretKeyRef) take precedence over envFrom keys.
    ...(app.secretKeys?.length
      ? { envFrom: [{ secretRef: { name: `${app.slug}-env` } }] }
      : {}),
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
    // Bump a restart annotation so the pods roll and re-read env — a Secret
    // data change alone does not trigger a rollout.
    const tmpl = existing.spec!.template;
    tmpl.metadata = tmpl.metadata ?? {};
    tmpl.metadata.annotations = {
      ...tmpl.metadata.annotations,
      "korepush.io/restartedAt": new Date().toISOString(),
    };
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
  // On a real owned base domain, provision a per-host Let's Encrypt cert via
  // cert-manager (HTTP-01). Skip for IP / sslip.io bases — there's no public
  // DNS to satisfy the ACME challenge, so those stay HTTP.
  const tlsEnabled = isRealDomain(BASE_DOMAIN);
  const ingressAnnotations = tlsEnabled
    ? { "cert-manager.io/cluster-issuer": "letsencrypt-prod" }
    : undefined;
  const ingressSpec = {
    rules: [
      {
        host,
        http: {
          paths: [
            {
              path: "/",
              pathType: "Prefix",
              backend: { service: { name: app.slug, port: { number: 80 } } },
            },
          ],
        },
      },
    ],
    ...(tlsEnabled
      ? { tls: [{ hosts: [host], secretName: `${app.slug}-tls` }] }
      : {}),
  };
  // Replace-on-exists (not create-only): a redeploy backfills TLS onto an app
  // whose Ingress predates HTTPS being enabled for the space's base domain.
  const existingIng = await net
    .readNamespacedIngress({ name: app.slug, namespace })
    .catch(() => null);
  if (!existingIng) {
    await net.createNamespacedIngress({
      namespace,
      body: {
        metadata: {
          name: app.slug,
          namespace,
          labels,
          ...(ingressAnnotations ? { annotations: ingressAnnotations } : {}),
        },
        spec: ingressSpec,
      },
    });
  } else {
    existingIng.metadata = {
      ...existingIng.metadata,
      labels,
      annotations: {
        ...existingIng.metadata?.annotations,
        ...(ingressAnnotations ?? {}),
      },
    };
    existingIng.spec = ingressSpec;
    await net.replaceNamespacedIngress({
      name: app.slug,
      namespace,
      body: existingIng,
    });
  }

  // Custom domains live on a separate Ingress with directly-managed certs.
  // Best-effort: a domains hiccup must not fail a deploy/redeploy.
  await reconcileAppDomains(namespace, spaceSlug, app).catch(() => {});
}

/* ──────────────────────────────────────────────────────────
 * Custom domains: per-app extra hostnames, each with its own Let's Encrypt
 * cert. A separate `<slug>-domains` Ingress + directly-managed cert-manager
 * Certificate CRs (so the staging/prod issuer can be chosen per domain — a
 * single Ingress annotation can't). The auto host stays on its own Ingress.
 * ────────────────────────────────────────────────────────── */

function domainSecretName(appSlug: string, host: string): string {
  const h = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${appSlug}-d-${h}`.slice(0, 253);
}

/** The server's reachable IP, for DNS instructions + the DNS precheck. */
export async function getNodeIp(): Promise<string | null> {
  if (process.env.KOREPUSH_NODE_IP) return process.env.KOREPUSH_NODE_IP;
  try {
    const { core } = k8sClients();
    const nodes = await core.listNode();
    const addrs = nodes.items[0]?.status?.addresses ?? [];
    return (
      addrs.find((a) => a.type === "ExternalIP")?.address ??
      addrs.find((a) => a.type === "InternalIP")?.address ??
      null
    );
  } catch {
    return null;
  }
}

/** True when `host` resolves to the same IP as the app's auto host / node IP. */
async function dnsPointsHere(
  host: string,
  autoHost: string,
  serverIp: string | null,
): Promise<boolean> {
  const targets = new Set<string>();
  if (serverIp) targets.add(serverIp);
  try {
    (await dns.resolve4(autoHost)).forEach((a) => targets.add(a));
  } catch {
    // auto host may be unresolvable (IP-only base) — fall back to serverIp.
  }
  if (targets.size === 0) return false;
  try {
    const addrs = await dns.resolve4(host);
    return addrs.some((a) => targets.has(a));
  } catch {
    return false;
  }
}

type AppDomainRow = typeof schema.appDomains.$inferSelect;

async function ensureCertificate(
  namespace: string,
  appSlug: string,
  d: AppDomainRow,
) {
  const { custom } = k8sClients();
  const existing = await custom
    .getNamespacedCustomObject({
      group: CM_GROUP,
      version: CM_VERSION,
      namespace,
      plural: "certificates",
      name: d.secretName,
    })
    .catch(() => null);
  if (existing) return; // issuer is fixed at add-time (v1)
  await custom.createNamespacedCustomObject({
    group: CM_GROUP,
    version: CM_VERSION,
    namespace,
    plural: "certificates",
    body: {
      apiVersion: `${CM_GROUP}/${CM_VERSION}`,
      kind: "Certificate",
      metadata: {
        name: d.secretName,
        namespace,
        labels: managedLabels({ "korepush.io/app": appSlug }),
      },
      spec: {
        secretName: d.secretName,
        dnsNames: [d.host],
        issuerRef: {
          name: d.useStaging ? "letsencrypt-staging" : "letsencrypt-prod",
          kind: "ClusterIssuer",
          group: CM_GROUP,
        },
      },
    },
  });
}

async function reconcileAppDomains(
  namespace: string,
  spaceSlug: string,
  app: AppRow,
) {
  const { net } = k8sClients();
  const ingName = `${app.slug}-domains`;
  const domains = await db
    .select()
    .from(schema.appDomains)
    .where(eq(schema.appDomains.appId, app.id));

  if (domains.length === 0) {
    await net
      .deleteNamespacedIngress({ name: ingName, namespace })
      .catch(() => {});
    return;
  }

  // Only domains past the DNS precheck (status != pending) request a cert + TLS.
  const active = domains.filter((d) => d.status !== "pending");
  for (const d of active) {
    await ensureCertificate(namespace, app.slug, d).catch(() => {});
  }

  const labels = managedLabels({ "korepush.io/app": app.slug });
  const rules = domains.map((d) => ({
    host: d.host,
    http: {
      paths: [
        {
          path: "/",
          pathType: "Prefix",
          backend: { service: { name: app.slug, port: { number: 80 } } },
        },
      ],
    },
  }));
  const tls = active.map((d) => ({ hosts: [d.host], secretName: d.secretName }));
  const spec = { rules, ...(tls.length ? { tls } : {}) };

  const existing = await net
    .readNamespacedIngress({ name: ingName, namespace })
    .catch(() => null);
  if (!existing) {
    await net.createNamespacedIngress({
      namespace,
      body: { metadata: { name: ingName, namespace, labels }, spec },
    });
  } else {
    existing.metadata = { ...existing.metadata, labels };
    existing.spec = spec;
    await net.replaceNamespacedIngress({ name: ingName, namespace, body: existing });
  }
}

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
    const msg = String(err);
    if (msg.includes("23505") || msg.toLowerCase().includes("unique")) {
      throw new Error("That domain is already in use.");
    }
    throw err;
  }
  if (app.image) await reconcileAppDomains(space.namespace, space.slug, app);
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
  const { custom, core } = k8sClients();
  await custom
    .deleteNamespacedCustomObject({
      group: CM_GROUP,
      version: CM_VERSION,
      namespace: space.namespace,
      plural: "certificates",
      name: d.secretName,
    })
    .catch(() => {});
  await core
    .deleteNamespacedSecret({ name: d.secretName, namespace: space.namespace })
    .catch(() => {});
  await reconcileAppDomains(space.namespace, space.slug, app);
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
        namespace: space.namespace,
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

  if (advanced && app.image) {
    await reconcileAppDomains(space.namespace, space.slug, app);
  }
  return listAppDomains(app.id);
}

/** True for a real owned domain (not localhost, an IP, or a magic-DNS base). */
function isRealDomain(d: string): boolean {
  if (!d || d === "localhost") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d)) return false;
  if (d.endsWith(".sslip.io") || d.endsWith(".nip.io")) return false;
  return d.includes(".");
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
    .returning();
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
    await reconcileApp(space.namespace, space.slug, {
      ...app,
      image: target.image,
    });
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

  if (app.image) {
    await reconcileApp(space.namespace, space.slug, {
      ...app,
      env: opts.plain,
      secretKeys,
    });
  }
}

/** Attach a database: inject its connection string into the app + redeploy. */
export async function attachDatabase(
  spaceSlug: string,
  appSlug: string,
  databaseId: string,
  envVar = "DATABASE_URL",
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

  await db
    .update(schema.apps)
    .set({ attachedDbId: databaseId, dbEnvVar: envVar, updatedAt: new Date() })
    .where(eq(schema.apps.id, app.id));
  if (app.image) {
    await reconcileApp(space.namespace, space.slug, {
      ...app,
      attachedDbId: databaseId,
      dbEnvVar: envVar,
    });
  }
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
  if (app.image) {
    await reconcileApp(space.namespace, space.slug, {
      ...app,
      attachedDbId: null,
    });
  }
}

export async function deleteApp(spaceSlug: string, slug: string) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) return;
  const app = await getApp(space.id, slug);
  if (!app) return;

  // Custom-domain certs/secrets aren't garbage-collected by deleting the
  // Ingress, so remove them explicitly (the rows cascade with the app).
  const domains = await db
    .select()
    .from(schema.appDomains)
    .where(eq(schema.appDomains.appId, app.id));

  const { apps, core, net, custom } = k8sClients();
  await Promise.allSettled([
    apps.deleteNamespacedDeployment({ name: slug, namespace: space.namespace }),
    core.deleteNamespacedService({ name: slug, namespace: space.namespace }),
    net.deleteNamespacedIngress({ name: slug, namespace: space.namespace }),
    net.deleteNamespacedIngress({
      name: `${slug}-domains`,
      namespace: space.namespace,
    }),
    core.deleteNamespacedSecret({
      name: `${slug}-env`,
      namespace: space.namespace,
    }),
    ...domains.flatMap((d) => [
      custom.deleteNamespacedCustomObject({
        group: CM_GROUP,
        version: CM_VERSION,
        namespace: space.namespace,
        plural: "certificates",
        name: d.secretName,
      }),
      core.deleteNamespacedSecret({
        name: d.secretName,
        namespace: space.namespace,
      }),
    ]),
  ]);
  await db.delete(schema.apps).where(eq(schema.apps.id, app.id));
}
