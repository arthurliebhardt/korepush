// Reads Flux's GitOps state for a KoreApp so the dashboard can render it.
// Flux's kustomize-controller stamps every object it applies with the labels
// kustomize.toolkit.fluxcd.io/{name,namespace} identifying the managing
// Kustomization. We follow those to the Kustomization (Ready + lastApplied
// revision) and its GitRepository source (url). Read-only — Flux owns writes.
import { k8sClients, managedLabels } from "./client";
import { slugify } from "./util";

const FLUX_NS = "flux-system";
const KORE_GROUP = "korepush.io";
const KORE_VERSION = "v1alpha1";
const KUSTOMIZE_GROUP = "kustomize.toolkit.fluxcd.io";
const SOURCE_GROUP = "source.toolkit.fluxcd.io";
const FLUX_VERSION = "v1";
const LBL_KS_NAME = "kustomize.toolkit.fluxcd.io/name";
const LBL_KS_NAMESPACE = "kustomize.toolkit.fluxcd.io/namespace";

export type GitOpsStatus = {
  managed: boolean; // KoreApp carries Flux's ownership labels
  kustomization: string | null; // "<ns>/<name>"
  repoUrl: string | null;
  revision: string | null; // e.g. "main@sha1:abc123"
  ready: boolean | null; // Ready condition; null = no condition yet
  message: string | null;
};

const UNMANAGED: GitOpsStatus = {
  managed: false,
  kustomization: null,
  repoUrl: null,
  revision: null,
  ready: null,
  message: null,
};

/** Whether a KoreApp's labels mark it as Flux-managed. */
export function isGitOpsManaged(labels: Record<string, string> | undefined): boolean {
  return !!(labels?.[LBL_KS_NAME] && labels?.[LBL_KS_NAMESPACE]);
}

/** Read the live GitOps sync status for one app (best-effort; never throws). */
export async function getGitOpsStatus(namespace: string, slug: string): Promise<GitOpsStatus> {
  const { custom } = k8sClients();
  const cr = (await custom
    .getNamespacedCustomObject({ group: KORE_GROUP, version: KORE_VERSION, namespace, plural: "koreapps", name: slug })
    .catch(() => null)) as { metadata?: { labels?: Record<string, string> } } | null;
  const labels = cr?.metadata?.labels;
  if (!isGitOpsManaged(labels)) return UNMANAGED;

  const ksName = labels![LBL_KS_NAME];
  const ksNs = labels![LBL_KS_NAMESPACE];
  const ks = (await custom
    .getNamespacedCustomObject({ group: KUSTOMIZE_GROUP, version: FLUX_VERSION, namespace: ksNs, plural: "kustomizations", name: ksName })
    .catch(() => null)) as {
    spec?: { sourceRef?: { kind?: string; name?: string; namespace?: string } };
    status?: {
      lastAppliedRevision?: string;
      conditions?: { type: string; status: string; message?: string }[];
    };
  } | null;

  const ready = ks?.status?.conditions?.find((c) => c.type === "Ready");
  // Resolve the GitRepository source for the repo URL.
  let repoUrl: string | null = null;
  const src = ks?.spec?.sourceRef;
  if (src?.kind === "GitRepository" && src.name) {
    const gr = (await custom
      .getNamespacedCustomObject({ group: SOURCE_GROUP, version: FLUX_VERSION, namespace: src.namespace ?? ksNs, plural: "gitrepositories", name: src.name })
      .catch(() => null)) as { spec?: { url?: string } } | null;
    repoUrl = gr?.spec?.url ?? null;
  }

  return {
    managed: true,
    kustomization: `${ksNs}/${ksName}`,
    repoUrl,
    revision: ks?.status?.lastAppliedRevision ?? null,
    ready: ready ? ready.status === "True" : null,
    message: ready?.message ?? null,
  };
}

/* ── Connect/manage GitOps sources from the UI (korepush authors the Flux
 *    GitRepository + Kustomization so users never touch kubectl/Flux). ── */

export type GitOpsSource = {
  name: string;
  repoUrl: string | null;
  branch: string | null;
  path: string | null;
  revision: string | null;
  ready: boolean | null;
  message: string | null;
};

/** Flux object name from a repo URL (last path segment). */
function repoName(url: string): string {
  const last = url.replace(/\.git$/i, "").replace(/\/+$/, "").split("/").pop() ?? "repo";
  return slugify(last) || "repo";
}

/** Connect a git repo: create a Flux GitRepository + Kustomization in
 *  flux-system. Flux then syncs the repo's KoreApp/KoreSpace/KoreDatabase
 *  manifests; the operator reconciles them; the dashboard shows the result. */
export async function connectGitOpsRepo(opts: {
  url: string;
  branch?: string;
  path?: string;
}): Promise<string> {
  const url = opts.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Enter an https git URL, e.g. https://github.com/org/repo");
  }
  const branch = opts.branch?.trim() || "main";
  const name = repoName(url);
  const labels = managedLabels({});
  const { custom } = k8sClients();
  await custom
    .createNamespacedCustomObject({
      group: SOURCE_GROUP,
      version: FLUX_VERSION,
      namespace: FLUX_NS,
      plural: "gitrepositories",
      body: {
        apiVersion: `${SOURCE_GROUP}/${FLUX_VERSION}`,
        kind: "GitRepository",
        metadata: { name, namespace: FLUX_NS, labels },
        spec: { interval: "1m", url, ref: { branch } },
      },
    })
    .catch((e: unknown) => {
      if ((e as { code?: number })?.code === 409) return;
      throw e;
    });
  await custom
    .createNamespacedCustomObject({
      group: KUSTOMIZE_GROUP,
      version: FLUX_VERSION,
      namespace: FLUX_NS,
      plural: "kustomizations",
      body: {
        apiVersion: `${KUSTOMIZE_GROUP}/${FLUX_VERSION}`,
        kind: "Kustomization",
        metadata: { name, namespace: FLUX_NS, labels },
        spec: {
          interval: "5m",
          path: opts.path?.trim() || "./",
          prune: true,
          sourceRef: { kind: "GitRepository", name },
        },
      },
    })
    .catch((e: unknown) => {
      if ((e as { code?: number })?.code === 409) return;
      throw e;
    });
  return name;
}

type KsItem = {
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: { path?: string; sourceRef?: { kind?: string; name?: string; namespace?: string } };
  status?: {
    lastAppliedRevision?: string;
    conditions?: { type: string; status: string; message?: string }[];
  };
};

/** List the GitOps sources korepush created (Kustomizations in flux-system) + status. */
export async function listGitOpsSources(): Promise<GitOpsSource[]> {
  const { custom } = k8sClients();
  const res = (await custom
    .listNamespacedCustomObject({ group: KUSTOMIZE_GROUP, version: FLUX_VERSION, namespace: FLUX_NS, plural: "kustomizations" })
    .catch(() => null)) as { items?: KsItem[] } | null;
  const out: GitOpsSource[] = [];
  for (const ks of res?.items ?? []) {
    if (ks.metadata?.labels?.["app.kubernetes.io/managed-by"] !== "korepush") continue;
    const ready = ks.status?.conditions?.find((c) => c.type === "Ready");
    let repoUrl: string | null = null;
    let branch: string | null = null;
    const src = ks.spec?.sourceRef;
    if (src?.kind === "GitRepository" && src.name) {
      const gr = (await custom
        .getNamespacedCustomObject({ group: SOURCE_GROUP, version: FLUX_VERSION, namespace: src.namespace ?? FLUX_NS, plural: "gitrepositories", name: src.name })
        .catch(() => null)) as { spec?: { url?: string; ref?: { branch?: string } } } | null;
      repoUrl = gr?.spec?.url ?? null;
      branch = gr?.spec?.ref?.branch ?? null;
    }
    out.push({
      name: ks.metadata!.name!,
      repoUrl,
      branch,
      path: ks.spec?.path ?? null,
      revision: ks.status?.lastAppliedRevision ?? null,
      ready: ready ? ready.status === "True" : null,
      message: ready?.message ?? null,
    });
  }
  return out;
}

/** Disconnect a GitOps source (delete its Kustomization + GitRepository). */
export async function disconnectGitOpsRepo(name: string): Promise<void> {
  const { custom } = k8sClients();
  await custom
    .deleteNamespacedCustomObject({ group: KUSTOMIZE_GROUP, version: FLUX_VERSION, namespace: FLUX_NS, plural: "kustomizations", name })
    .catch(() => {});
  await custom
    .deleteNamespacedCustomObject({ group: SOURCE_GROUP, version: FLUX_VERSION, namespace: FLUX_NS, plural: "gitrepositories", name })
    .catch(() => {});
}
