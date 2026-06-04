// Control-plane authoring of KoreApp CRs. The UI mutations write/patch these
// (the operator reconciles them into Deployment/Service/HTTPRoute/certs). Spec
// is the runtime source of truth; Postgres stays authoritative for auth +
// history + the app mirror row. Secret VALUES never go in the spec — only
// references (envFrom.secretRef / database -> CNPG secret).
import { setHeaderOptions, PatchStrategy } from "@kubernetes/client-node";
import { k8sClients, managedLabels } from "./client";

const GROUP = "korepush.io";
const VERSION = "v1alpha1";
const PLURAL = "koreapps";
const mergePatch = setHeaderOptions("Content-Type", PatchStrategy.MergePatch);

export type EnvVarSpec = {
  name: string;
  value?: string;
  secretKeyRef?: { name: string; key: string };
};
export type HealthcheckSpec = {
  test: string[]; // exec command (already resolved from compose CMD/CMD-SHELL)
  interval?: number; // seconds
  timeout?: number;
  retries?: number;
  startPeriod?: number;
};
export type KoreAppSpec = {
  source: "image" | "git";
  image?: string;
  port: number;
  replicas?: number;
  // Container resource limits (k8s quantity strings); operator applies defaults
  // when a field is absent.
  resources?: { cpu?: string; memory?: string };
  command?: string[]; // overrides the image ENTRYPOINT
  args?: string[]; // overrides the image CMD
  healthcheck?: HealthcheckSpec;
  env?: EnvVarSpec[];
  envFrom?: { secretRef: { name: string } }[];
  domains?: { host: string; staging?: boolean }[];
  database?: { name: string; envVar?: string };
};

// The subset of an `apps` row this module reads. (Git build config lives only on
// the Postgres row / build Job — it was never read off the CR, so it's not here.)
type AppLike = {
  slug: string;
  source: string;
  image: string | null;
  port: number;
  replicas: number;
  cpuLimit: string | null;
  memoryLimit: string | null;
  command: string[] | null;
  args: string[] | null;
  healthcheck: HealthcheckSpec | null;
  env: Record<string, string> | null;
  secretKeys: string[] | null;
  dbEnvVar: string;
};

/** Env list from the plain-env map, preserving key order (matches the operator). */
export function envSpec(env: Record<string, string> | null): EnvVarSpec[] {
  return Object.entries(env ?? {}).map(([name, value]) => ({ name, value }));
}

/** Build the full KoreApp spec mirroring an app's current runtime config. */
export function buildKoreAppSpec(
  app: AppLike,
  opts: { dbSlug?: string | null; domains?: { host: string; staging?: boolean }[] } = {},
): KoreAppSpec {
  const spec: KoreAppSpec = {
    source: app.source === "image" ? "image" : "git",
    port: app.port,
    replicas: app.replicas,
  };
  if (app.image) spec.image = app.image;
  if (app.cpuLimit || app.memoryLimit) {
    spec.resources = {};
    if (app.cpuLimit) spec.resources.cpu = app.cpuLimit;
    if (app.memoryLimit) spec.resources.memory = app.memoryLimit;
  }
  if (app.command?.length) spec.command = app.command;
  if (app.args?.length) spec.args = app.args;
  if (app.healthcheck?.test?.length) spec.healthcheck = app.healthcheck;
  const env = envSpec(app.env);
  if (env.length) spec.env = env;
  if (app.secretKeys?.length) spec.envFrom = [{ secretRef: { name: `${app.slug}-env` } }];
  if (opts.dbSlug) spec.database = { name: opts.dbSlug, envVar: app.dbEnvVar || "DATABASE_URL" };
  if (opts.domains?.length) spec.domains = opts.domains;
  return spec;
}

/** Create the CR if absent (idempotent — safe for backfill/adoption). */
export async function createKoreApp(
  namespace: string,
  slug: string,
  spec: KoreAppSpec,
): Promise<void> {
  await k8sClients()
    .custom.createNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: PLURAL,
      body: {
        apiVersion: `${GROUP}/${VERSION}`,
        kind: "KoreApp",
        metadata: { name: slug, namespace, labels: managedLabels({ "korepush.io/app": slug }) },
        spec,
      },
    })
    .catch((e: unknown) => {
      if ((e as { code?: number })?.code === 409) return; // already exists
      throw e;
    });
}

/**
 * Merge-patch spec fields (only the keys you pass are touched — pass `null` to
 * remove one, e.g. `{ database: null }`). `restart: true` bumps the restart
 * stamp so the operator rolls pods even when only a referenced Secret changed.
 */
export async function patchKoreApp(
  namespace: string,
  slug: string,
  opts: { spec?: Record<string, unknown>; restart?: boolean },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (opts.spec) body.spec = opts.spec;
  if (opts.restart) {
    body.metadata = { annotations: { "korepush.io/restartedAt": new Date().toISOString() } };
  }
  await k8sClients().custom.patchNamespacedCustomObject(
    { group: GROUP, version: VERSION, namespace, plural: PLURAL, name: slug, body },
    mergePatch,
  );
}

export async function deleteKoreApp(namespace: string, slug: string): Promise<void> {
  await k8sClients()
    .custom.deleteNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name: slug })
    .catch((e: unknown) => {
      if ((e as { code?: number })?.code === 404) return;
      throw e;
    });
}

/* ── KoreSpace (cluster-scoped: the operator materialises a Namespace + quota) ── */

const KORESPACES = "korespaces";

export type KoreSpaceSpec = {
  displayName?: string;
  quota?: {
    requestsCpu?: string;
    requestsMemory?: string;
    limitsCpu?: string;
    limitsMemory?: string;
    pods?: string;
  };
};

/** Create the KoreSpace CR if absent (idempotent — backfill/adoption safe). */
export async function createKoreSpace(name: string, spec: KoreSpaceSpec): Promise<void> {
  await k8sClients()
    .custom.createClusterCustomObject({
      group: GROUP,
      version: VERSION,
      plural: KORESPACES,
      body: {
        apiVersion: `${GROUP}/${VERSION}`,
        kind: "KoreSpace",
        metadata: { name, labels: managedLabels({ "korepush.io/space": name }) },
        spec,
      },
    })
    .catch((e: unknown) => {
      if ((e as { code?: number })?.code === 409) return;
      throw e;
    });
}

export async function deleteKoreSpace(name: string): Promise<void> {
  await k8sClients()
    .custom.deleteClusterCustomObject({ group: GROUP, version: VERSION, plural: KORESPACES, name })
    .catch((e: unknown) => {
      if ((e as { code?: number })?.code === 404) return;
      throw e;
    });
}

/* ── KoreDatabase (namespaced: the operator materialises a CNPG Cluster) ── */

const KOREDATABASES = "koredatabases";

export type KoreDatabaseSpec = {
  engine?: string;
  version?: number;
  storage?: string;
  instances?: number;
};

/** Create the KoreDatabase CR if absent (idempotent — backfill/adoption safe). */
export async function createKoreDatabase(
  namespace: string,
  slug: string,
  spec: KoreDatabaseSpec,
): Promise<void> {
  await k8sClients()
    .custom.createNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: KOREDATABASES,
      body: {
        apiVersion: `${GROUP}/${VERSION}`,
        kind: "KoreDatabase",
        metadata: { name: slug, namespace, labels: managedLabels({}) },
        spec,
      },
    })
    .catch((e: unknown) => {
      if ((e as { code?: number })?.code === 409) return;
      throw e;
    });
}

export async function deleteKoreDatabase(namespace: string, slug: string): Promise<void> {
  await k8sClients()
    .custom.deleteNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: KOREDATABASES, name: slug })
    .catch((e: unknown) => {
      if ((e as { code?: number })?.code === 404) return;
      throw e;
    });
}

/** The CR's status.phase (operator-authoritative), for the UI to read. */
export async function getKoreAppPhase(namespace: string, slug: string): Promise<string | null> {
  const cr = (await k8sClients()
    .custom.getNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name: slug })
    .catch(() => null)) as { status?: { phase?: string } } | null;
  return cr?.status?.phase ?? null;
}

/** Live status.phase for every KoreApp in a namespace, keyed by name — one list
 *  call for a whole space's app list (avoids an N+1 of per-app GETs). */
export async function listKoreAppPhases(namespace: string): Promise<Record<string, string>> {
  const res = (await k8sClients()
    .custom.listNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL })
    .catch(() => null)) as {
    items?: { metadata?: { name?: string }; status?: { phase?: string } }[];
  } | null;
  const out: Record<string, string> = {};
  for (const it of res?.items ?? []) {
    if (it.metadata?.name && it.status?.phase) out[it.metadata.name] = it.status.phase;
  }
  return out;
}

/** Map a KoreApp status.phase to the lowercase status the UI badge styles
 *  (Pending/Progressing/Running/Stopped → pending/progressing/running/stopped);
 *  null when there's no live phase yet so callers fall back to the DB mirror. */
export function phaseToStatus(phase: string | null | undefined): string | null {
  return phase ? phase.toLowerCase() : null;
}
