// Reads Flux's GitOps state for a KoreApp so the dashboard can render it.
// Flux's kustomize-controller stamps every object it applies with the labels
// kustomize.toolkit.fluxcd.io/{name,namespace} identifying the managing
// Kustomization. We follow those to the Kustomization (Ready + lastApplied
// revision) and its GitRepository source (url). Read-only — Flux owns writes.
import { k8sClients } from "./client";

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
