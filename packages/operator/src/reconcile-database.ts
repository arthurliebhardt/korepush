import { setHeaderOptions, PatchStrategy } from "@kubernetes/client-node";
import { randomBytes } from "node:crypto";
import { k8sClients, managedLabels } from "@korepush/k8s/client";
import { GROUP, VERSION, KOREDATABASES, type KoreDatabase } from "./types";
import { patchCRStatus } from "./status";

const mergePatch = setHeaderOptions("Content-Type", PatchStrategy.MergePatch);
const CNPG_GROUP = "postgresql.cnpg.io";
const CNPG_VERSION = "v1";

/**
 * Reconcile a KoreDatabase by engine. Every engine exposes a uniform
 * `db-<name>-app` Secret (key `uri`) so the app-attach path is engine-agnostic:
 *   postgres -> a CloudNativePG Cluster (CNPG creates the Secret itself)
 *   redis    -> an operator-managed Deployment + Service + PVC + generated Secret
 */
export async function reconcileDatabase(namespace: string, name: string): Promise<void> {
  const { custom } = k8sClients();
  const kdb = (await custom
    .getNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: KOREDATABASES, name })
    .catch(() => null)) as KoreDatabase | null;
  if (!kdb) return; // deleted → ownerReference GC removes the materialised objects
  if (kdb.metadata.deletionTimestamp) return;

  const engine = (kdb.spec.engine ?? "postgres").toLowerCase();
  if (engine === "postgres") return reconcilePostgres(namespace, name, kdb);
  if (engine === "redis") return reconcileRedis(namespace, name, kdb);
  await patchCRStatus(
    { plural: KOREDATABASES, meta: kdb.metadata, logPrefix: "[db-status]" },
    { phase: "Failed" },
    "UnknownEngine",
    `Unsupported engine "${engine}"`,
  );
}

/**
 * Postgres: reconcile into a CloudNativePG Cluster (db-<name>) in the same
 * namespace. CNPG (no bootstrap block) auto-creates db "app" + the
 * `db-<name>-app` Secret (key `uri`). The Cluster carries an ownerReference so
 * deleting the KoreDatabase GCs it; no finalizer needed (same-namespace GC).
 * NOTE: this body is the pre-Phase-4 reconcile, lifted verbatim — do not edit
 * its behaviour (M-OP1 CNPG runs live on prod).
 */
async function reconcilePostgres(namespace: string, name: string, kdb: KoreDatabase): Promise<void> {
  const { custom } = k8sClients();
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

// URI-safe password (no + or / which would corrupt the redis://:pw@host userinfo).
function genPassword(): string {
  return randomBytes(24).toString("base64url");
}

// One inline engine descriptor — MySQL later is a second object, not a fork.
const redisDescriptor = {
  image: "redis:7-alpine",
  port: 6379,
  dataMountPath: "/data",
};

/**
 * Redis: reconcile into an operator-managed Deployment + Service + RWO PVC +
 * a generated-password Secret. Single-replica + Recreate (RWO local-path can't
 * roll). The connection Secret is CREATE-ONCE: read-existing-first, never
 * rotate (the 90s resync would otherwise re-randomise the password and break
 * already-attached apps). Deployment/Service/Secret carry the CR ownerRef and
 * GC on delete; the PVC has NO ownerRef (data safety) and is deleted explicitly
 * by the control plane (deleteDatabase).
 */
async function reconcileRedis(namespace: string, name: string, kdb: KoreDatabase): Promise<void> {
  const { apps, core } = k8sClients();
  const workload = `db-${name}`;
  const connectionSecret = `${workload}-app`;
  const spaceSlug = namespace.replace(/^ks-/, "");
  const labels = managedLabels({
    "korepush.io/space": spaceSlug,
    "korepush.io/database": name,
    app: workload,
  });
  const owner = {
    apiVersion: kdb.apiVersion,
    kind: kdb.kind,
    name: kdb.metadata.name,
    uid: kdb.metadata.uid!,
    controller: true,
    blockOwnerDeletion: true,
  };

  // (1) Connection Secret — CREATE-ONCE. Reuse the existing password if present.
  const existingSecret = await core
    .readNamespacedSecret({ name: connectionSecret, namespace })
    .catch(() => null);
  if (!existingSecret) {
    const password = genPassword();
    const uri = `redis://:${password}@${workload}:${redisDescriptor.port}`;
    await core
      .createNamespacedSecret({
        namespace,
        body: {
          metadata: { name: connectionSecret, namespace, labels, ownerReferences: [owner] },
          stringData: {
            password,
            host: workload,
            port: String(redisDescriptor.port),
            uri,
          },
        },
      })
      .catch((err: unknown) => {
        if ((err as { code?: number })?.code === 409) return; // raced — fine
        throw err;
      });
  }

  // (2) PVC — create-if-missing, NO ownerReference (deleted by the control plane).
  const pvcName = `${workload}-data`;
  const existingPvc = await core
    .readNamespacedPersistentVolumeClaim({ name: pvcName, namespace })
    .catch(() => null);
  if (!existingPvc) {
    await core
      .createNamespacedPersistentVolumeClaim({
        namespace,
        body: {
          metadata: { name: pvcName, namespace, labels },
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: "local-path",
            resources: { requests: { storage: kdb.spec.storage ?? "1Gi" } },
          },
        },
      })
      .catch((err: unknown) => console.error("[redis pvc] create failed", pvcName, err));
  }

  // (3) Deployment — create-if-missing. replicas=1 + Recreate (RWO PVC). The
  // password is sourced via secretKeyRef (never baked plaintext into args).
  const existingDep = await apps.readNamespacedDeployment({ name: workload, namespace }).catch(() => null);
  if (!existingDep) {
    await apps.createNamespacedDeployment({
      namespace,
      body: {
        metadata: { name: workload, namespace, labels, ownerReferences: [owner] },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: { app: workload } },
          template: {
            metadata: { labels },
            spec: {
              containers: [
                {
                  name: "redis",
                  image: redisDescriptor.image,
                  command: ["sh", "-c", 'exec redis-server --requirepass "$REDIS_PASSWORD" --appendonly yes --dir /data'],
                  env: [
                    { name: "REDIS_PASSWORD", valueFrom: { secretKeyRef: { name: connectionSecret, key: "password" } } },
                  ],
                  ports: [{ containerPort: redisDescriptor.port }],
                  // tcpSocket (not redis-cli -a) so the password never lands in the pod spec.
                  readinessProbe: { tcpSocket: { port: redisDescriptor.port }, periodSeconds: 10 },
                  resources: {
                    requests: { cpu: "50m", memory: "64Mi" },
                    limits: { cpu: "500m", memory: "256Mi" },
                  },
                  volumeMounts: [{ name: "data", mountPath: redisDescriptor.dataMountPath }],
                },
              ],
              volumes: [{ name: "data", persistentVolumeClaim: { claimName: pvcName } }],
            },
          },
        },
      },
    });
  }

  // (4) Service — ClusterIP, create-if-missing.
  const existingSvc = await core.readNamespacedService({ name: workload, namespace }).catch(() => null);
  if (!existingSvc) {
    await core.createNamespacedService({
      namespace,
      body: {
        metadata: { name: workload, namespace, labels, ownerReferences: [owner] },
        spec: { selector: { app: workload }, ports: [{ name: "redis", port: redisDescriptor.port, targetPort: redisDescriptor.port }] },
      },
    });
  }

  // (5) Status from the live Deployment's readiness.
  const liveDep = await apps.readNamespacedDeployment({ name: workload, namespace }).catch(() => null);
  const ready = liveDep?.status?.readyReplicas ?? 0;
  const phase = ready >= 1 ? "Running" : "Provisioning";
  await patchCRStatus(
    { plural: KOREDATABASES, meta: kdb.metadata, logPrefix: "[db-status]" },
    { phase, connectionSecret, readyInstances: ready },
    "Reconciled",
    ready >= 1 ? "Redis ready" : "Provisioning redis",
  );
}
