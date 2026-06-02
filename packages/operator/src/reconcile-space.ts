import { setHeaderOptions, PatchStrategy } from "@kubernetes/client-node";
import { k8sClients, managedLabels } from "@korepush/k8s/client";
import { GROUP, VERSION, KORESPACES, type KoreSpace } from "./types";
import { patchCRStatus } from "./status";

const mergePatch = setHeaderOptions("Content-Type", PatchStrategy.MergePatch);

const QUOTA_DEFAULTS = {
  requestsCpu: "2",
  requestsMemory: "4Gi",
  limitsCpu: "4",
  limitsMemory: "8Gi",
  pods: "20",
};

/**
 * Reconcile a KoreSpace (cluster-scoped) into a Namespace (ks-<name>) + a
 * ResourceQuota + a LimitRange. The Namespace carries an ownerReference so
 * deleting the KoreSpace garbage-collects it (and everything inside — KoreApp
 * finalizers run as the namespace terminates). No finalizer needed here: all
 * children die with the namespace, which the ownerRef GC removes.
 */
export async function reconcileSpace(_ns: string, name: string): Promise<void> {
  const { custom, core } = k8sClients();
  const ksp = (await custom
    .getClusterCustomObject({ group: GROUP, version: VERSION, plural: KORESPACES, name })
    .catch(() => null)) as KoreSpace | null;
  if (!ksp) return; // deleted → ownerReference GC removes the Namespace
  if (ksp.metadata.deletionTimestamp) return; // Namespace GC handles teardown

  const namespace = `ks-${name}`;
  const labels = managedLabels({ "korepush.io/space": name });
  const owner = {
    apiVersion: ksp.apiVersion,
    kind: ksp.kind,
    name: ksp.metadata.name,
    uid: ksp.metadata.uid!,
    controller: true,
    blockOwnerDeletion: true,
  };
  const q = { ...QUOTA_DEFAULTS, ...(ksp.spec.quota ?? {}) };

  // Namespace (create-if-missing; adopt an existing one by stamping the ownerRef).
  const existingNs = await core.readNamespace({ name: namespace }).catch(() => null);
  if (!existingNs) {
    await core.createNamespace({
      body: { metadata: { name: namespace, labels, ownerReferences: [owner] } },
    });
  } else if (!existingNs.metadata?.ownerReferences?.some((o) => o.uid === owner.uid)) {
    await core.patchNamespace(
      { name: namespace, body: { metadata: { ownerReferences: [owner] } } },
      mergePatch,
    );
  }

  // ResourceQuota (create-if-missing; the values rarely change).
  if (!(await core.readNamespacedResourceQuota({ name: "korepush-quota", namespace }).catch(() => null))) {
    await core.createNamespacedResourceQuota({
      namespace,
      body: {
        metadata: { name: "korepush-quota", namespace, labels },
        spec: {
          hard: {
            "requests.cpu": q.requestsCpu,
            "requests.memory": q.requestsMemory,
            "limits.cpu": q.limitsCpu,
            "limits.memory": q.limitsMemory,
            pods: q.pods,
          },
        },
      },
    });
  }

  // LimitRange so pods without explicit requests/limits (e.g. CNPG) satisfy the quota.
  if (!(await core.readNamespacedLimitRange({ name: "korepush-defaults", namespace }).catch(() => null))) {
    await core.createNamespacedLimitRange({
      namespace,
      body: {
        metadata: { name: "korepush-defaults", namespace, labels },
        spec: {
          limits: [
            {
              type: "Container",
              _default: { cpu: "1", memory: "1Gi" },
              defaultRequest: { cpu: "50m", memory: "64Mi" },
            },
          ],
        },
      },
    });
  }

  await patchCRStatus(
    { plural: KORESPACES, meta: ksp.metadata, cluster: true, logPrefix: "[space-status]" },
    { phase: "Running", namespace },
    "Provisioned",
    "Namespace + quota ready",
  );
}
