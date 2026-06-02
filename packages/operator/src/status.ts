import { setHeaderOptions, PatchStrategy } from "@kubernetes/client-node";
import { k8sClients } from "@korepush/k8s/client";
import { GROUP, VERSION } from "./types";

const mergePatch = setHeaderOptions("Content-Type", PatchStrategy.MergePatch);

type CRMeta = { name: string; namespace?: string; generation?: number };

/**
 * Patch a korepush CR's status subresource: spread `partial`, stamp
 * observedGeneration, and attach the single Ready condition (status mirrors
 * phase === "Running"). Set `cluster` for cluster-scoped CRs (KoreSpace).
 * Never throws — logs on failure (status is best-effort; the work queue retries).
 */
export async function patchCRStatus(
  opts: { plural: string; meta: CRMeta; cluster?: boolean; logPrefix: string },
  partial: Record<string, unknown> & { phase?: string },
  reason: string,
  message: string,
): Promise<void> {
  const { custom } = k8sClients();
  const status = {
    ...partial,
    observedGeneration: opts.meta.generation,
    conditions: [
      {
        type: "Ready",
        status: partial.phase === "Running" ? "True" : "False",
        observedGeneration: opts.meta.generation,
        lastTransitionTime: new Date().toISOString(),
        reason,
        message,
      },
    ],
  };
  const body = { status };
  const req = opts.cluster
    ? custom.patchClusterCustomObjectStatus(
        { group: GROUP, version: VERSION, plural: opts.plural, name: opts.meta.name, body },
        mergePatch,
      )
    : custom.patchNamespacedCustomObjectStatus(
        {
          group: GROUP,
          version: VERSION,
          namespace: opts.meta.namespace!,
          plural: opts.plural,
          name: opts.meta.name,
          body,
        },
        mergePatch,
      );
  await req.catch((e: unknown) => console.error(opts.logPrefix, opts.meta.name, e));
}
