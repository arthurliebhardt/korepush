import { setHeaderOptions, PatchStrategy } from "@kubernetes/client-node";
import { k8sClients, managedLabels } from "@korepush/k8s/client";
import { GROUP, VERSION, KOREDATABASES, type KoreDatabase } from "./types";
import { patchCRStatus } from "./status";

const mergePatch = setHeaderOptions("Content-Type", PatchStrategy.MergePatch);
const CNPG_GROUP = "postgresql.cnpg.io";
const CNPG_VERSION = "v1";

/**
 * Reconcile a KoreDatabase into a CloudNativePG Cluster (db-<name>) in the same
 * namespace. CNPG (no bootstrap block) auto-creates db "app" + the
 * `db-<name>-app` Secret (key `uri`). The Cluster carries an ownerReference so
 * deleting the KoreDatabase GCs it; no finalizer needed (same-namespace GC).
 */
export async function reconcileDatabase(namespace: string, name: string): Promise<void> {
  const { custom } = k8sClients();
  const kdb = (await custom
    .getNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: KOREDATABASES, name })
    .catch(() => null)) as KoreDatabase | null;
  if (!kdb) return; // deleted → ownerReference GC removes the Cluster
  if (kdb.metadata.deletionTimestamp) return;

  const cluster = `db-${name}`;
  const connectionSecret = `${cluster}-app`;
  const labels = managedLabels({ "korepush.io/space": namespace.replace(/^ks-/, "") });
  const owner = {
    apiVersion: kdb.apiVersion,
    kind: kdb.kind,
    name: kdb.metadata.name,
    uid: kdb.metadata.uid!,
    controller: true,
    blockOwnerDeletion: true,
  };
  const instances = kdb.spec.instances ?? 1;
  const storage = kdb.spec.storage ?? "5Gi";
  // Pin the Postgres major version from spec.version (CRD default 16) onto the
  // CNPG operand image; otherwise CNPG silently uses its own bundled default.
  const version = kdb.spec.version ?? 16;
  const imageName = `ghcr.io/cloudnative-pg/postgresql:${version}`;

  // CNPG Cluster (create-if-missing; adopt an existing one by stamping the
  // ownerRef). We don't mutate a live cluster's storage/instances here —
  // CNPG owns its rollout; we only ensure existence + ownership.
  const existing = (await custom
    .getNamespacedCustomObject({ group: CNPG_GROUP, version: CNPG_VERSION, namespace, plural: "clusters", name: cluster })
    .catch(() => null)) as { metadata?: { ownerReferences?: { uid?: string }[] } } | null;
  if (!existing) {
    await custom.createNamespacedCustomObject({
      group: CNPG_GROUP,
      version: CNPG_VERSION,
      namespace,
      plural: "clusters",
      body: {
        apiVersion: `${CNPG_GROUP}/${CNPG_VERSION}`,
        kind: "Cluster",
        metadata: { name: cluster, namespace, labels, ownerReferences: [owner] },
        spec: {
          instances,
          imageName,
          storage: { size: storage },
          resources: {
            requests: { cpu: "100m", memory: "256Mi" },
            limits: { cpu: "1", memory: "1Gi" },
          },
        },
      },
    });
  } else if (!existing.metadata?.ownerReferences?.some((o) => o.uid === owner.uid)) {
    await custom.patchNamespacedCustomObject(
      { group: CNPG_GROUP, version: CNPG_VERSION, namespace, plural: "clusters", name: cluster, body: { metadata: { ownerReferences: [owner] } } },
      mergePatch,
    );
  }

  // Status from the live CNPG Cluster.
  const cr = (await custom
    .getNamespacedCustomObject({ group: CNPG_GROUP, version: CNPG_VERSION, namespace, plural: "clusters", name: cluster })
    .catch(() => null)) as { status?: { phase?: string; readyInstances?: number } } | null;
  const ready = cr?.status?.readyInstances ?? 0;
  const phase = ready >= instances ? "Running" : "Provisioning";
  await patchCRStatus(
    { plural: KOREDATABASES, meta: kdb.metadata, logPrefix: "[db-status]" },
    { phase, connectionSecret, readyInstances: ready },
    "Reconciled",
    cr?.status?.phase ?? "Provisioning CNPG cluster",
  );
}
