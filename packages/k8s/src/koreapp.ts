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
export type KoreAppSpec = {
  source: "image" | "git";
  image?: string;
  git?: {
    repoUrl: string;
    ref?: string;
    rootDir?: string;
    installCmd?: string;
    buildCmd?: string;
    startCmd?: string;
  };
  port: number;
  replicas?: number;
  env?: EnvVarSpec[];
  envFrom?: { secretRef: { name: string } }[];
  domains?: { host: string; staging?: boolean }[];
  database?: { name: string; envVar?: string };
};

// The subset of an `apps` row this module reads.
type AppLike = {
  slug: string;
  source: string;
  image: string | null;
  repoUrl: string | null;
  gitRef: string | null;
  rootDir: string | null;
  installCmd: string | null;
  buildCmd: string | null;
  startCmd: string | null;
  port: number;
  replicas: number;
  env: Record<string, string> | null;
  secretKeys: string[] | null;
  dbEnvVar: string;
};

/** The CRD requires git.repoUrl to match ^https:// — normalise SSH/bare forms. */
function normalizeRepoUrl(u: string): string {
  let s = u.trim();
  s = s.replace(/^git@([^:]+):/i, "https://$1/");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/^http:\/\//i, "https://");
}

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
  if (spec.source === "git" && app.repoUrl) {
    spec.git = {
      repoUrl: normalizeRepoUrl(app.repoUrl),
      ref: app.gitRef || "main",
      ...(app.rootDir ? { rootDir: app.rootDir } : {}),
      ...(app.installCmd ? { installCmd: app.installCmd } : {}),
      ...(app.buildCmd ? { buildCmd: app.buildCmd } : {}),
      ...(app.startCmd ? { startCmd: app.startCmd } : {}),
    };
  }
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

/** The CR's status.phase (operator-authoritative), for the UI to read. */
export async function getKoreAppPhase(namespace: string, slug: string): Promise<string | null> {
  const cr = (await k8sClients()
    .custom.getNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name: slug })
    .catch(() => null)) as { status?: { phase?: string } } | null;
  return cr?.status?.phase ?? null;
}
