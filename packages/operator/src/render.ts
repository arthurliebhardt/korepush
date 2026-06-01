// korepush.yaml → CR manifests. PURE: a parsed korepush.yaml object in, an
// array of KoreSpace/KoreDatabase/KoreApp manifests out. The render controller
// fetches the doc from a Flux GitRepository artifact and applies the result;
// every generated CR is labelled so the controller can prune removed ones and
// the UI can show them as GitOps-managed (read-only).
import { GROUP, VERSION } from "./types";

type KyEnv = Record<string, string>;
type KyApp = {
  name?: string;
  space?: string;
  image?: string;
  git?: {
    repoUrl: string;
    ref?: string;
    rootDir?: string;
    installCmd?: string;
    buildCmd?: string;
    startCmd?: string;
  };
  port?: number;
  replicas?: number;
  env?: KyEnv;
  domains?: string[];
  database?: { name: string; envVar?: string };
};
type KyDatabase = { space?: string; name: string; engine?: string; storage?: string };

/** The friendly format users write in their repo's korepush.yaml. */
export type KorepushYaml = {
  defaultSpace?: string;
  spaces?: string[];
  databases?: KyDatabase[];
  apps?: KyApp[];
};

export type Manifest = {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string; labels: Record<string, string> };
  spec: Record<string, unknown>;
};

const AV = `${GROUP}/${VERSION}`;
export const SOURCE_LABEL = "korepush.io/source";

/** Render korepush.yaml into KoreSpace/KoreDatabase/KoreApp manifests. */
export function renderManifests(doc: KorepushYaml, sourceName: string): Manifest[] {
  const labels = {
    "app.kubernetes.io/managed-by": "korepush",
    "korepush.io/managed-by": "gitops",
    [SOURCE_LABEL]: sourceName,
  };
  const ns = (space: string) => `ks-${space}`;
  const spaceOf = (s?: string) => {
    const sp = s ?? doc.defaultSpace;
    if (!sp) throw new Error("an app/database has no space and no top-level defaultSpace");
    return sp;
  };

  const out: Manifest[] = [];

  // Spaces: declared + any referenced by apps/databases (so they self-provision).
  const spaces = new Set<string>(doc.spaces ?? []);
  for (const a of doc.apps ?? []) spaces.add(spaceOf(a.space));
  for (const d of doc.databases ?? []) spaces.add(spaceOf(d.space));
  for (const space of spaces) {
    out.push({ apiVersion: AV, kind: "KoreSpace", metadata: { name: space, labels }, spec: {} });
  }

  for (const d of doc.databases ?? []) {
    if (!d.name) throw new Error("a database is missing name");
    out.push({
      apiVersion: AV,
      kind: "KoreDatabase",
      metadata: { name: d.name, namespace: ns(spaceOf(d.space)), labels },
      spec: { engine: d.engine ?? "postgres", ...(d.storage ? { storage: d.storage } : {}) },
    });
  }

  for (const a of doc.apps ?? []) {
    if (!a.name) throw new Error("an app is missing name");
    const isGit = !!a.git;
    const spec: Record<string, unknown> = {
      source: isGit ? "git" : "image",
      port: a.port ?? (isGit ? 3000 : 80),
      replicas: a.replicas ?? 1,
    };
    if (a.image) spec.image = a.image;
    if (a.git) {
      spec.git = {
        repoUrl: a.git.repoUrl,
        ref: a.git.ref ?? "main",
        ...(a.git.rootDir ? { rootDir: a.git.rootDir } : {}),
        ...(a.git.installCmd ? { installCmd: a.git.installCmd } : {}),
        ...(a.git.buildCmd ? { buildCmd: a.git.buildCmd } : {}),
        ...(a.git.startCmd ? { startCmd: a.git.startCmd } : {}),
      };
    }
    if (a.env && Object.keys(a.env).length) {
      spec.env = Object.entries(a.env).map(([name, value]) => ({ name, value }));
    }
    if (a.domains?.length) spec.domains = a.domains.map((host) => ({ host }));
    if (a.database) {
      spec.database = { name: a.database.name, envVar: a.database.envVar ?? "DATABASE_URL" };
    }
    out.push({
      apiVersion: AV,
      kind: "KoreApp",
      metadata: { name: a.name, namespace: ns(spaceOf(a.space)), labels },
      spec,
    });
  }

  return out;
}
