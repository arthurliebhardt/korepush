import { setHeaderOptions, PatchStrategy } from "@kubernetes/client-node";
import { k8sClients, managedLabels } from "@korepush/k8s/client";
import {
  BASE_DOMAIN,
  CM_GROUP,
  CM_VERSION,
  GW_NS,
  isRealDomain,
  hostTlsSecret,
  domainSecretName,
  ensureHttpsCert,
  removeHttpsCert,
  reconcileHTTPRoute,
  deleteHTTPRoute,
} from "@korepush/k8s/routing";
import { GROUP, VERSION, PLURAL, type KoreApp } from "./types";
import { patchCRStatus } from "./status";

// Finalizer so we can clean cross-namespace resources (kube-system certs +
// shared-Gateway listener refs + the app's env Secret) BEFORE the CR is GC'd —
// ownerReferences only collect same-namespace children.
const FINALIZER = "korepush.io/cleanup";
const mergePatch = setHeaderOptions("Content-Type", PatchStrategy.MergePatch);

type OwnerRef = {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
  controller: boolean;
  blockOwnerDeletion: boolean;
};

/**
 * Reconcile one KoreApp into its runtime: Deployment + Service + auto-host
 * HTTPRoute (+ TLS cert on a real base domain) + custom-domain routes/certs.
 * Level-triggered (re-reads the live CR). Same-namespace children carry an
 * ownerReference (GC); cross-namespace certs + the env Secret are cleaned by
 * the finalizer on delete. Image apps deploy now; git apps wait for spec.image.
 */
export async function reconcile(namespace: string, name: string): Promise<void> {
  const { custom, apps, core } = k8sClients();
  const app = (await custom
    .getNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name })
    .catch(() => null)) as KoreApp | null;
  if (!app) return; // deleted → ownerReference GC removes same-ns children

  // Deletion: run cross-namespace cleanup, then drop the finalizer to release it.
  if (app.metadata.deletionTimestamp) {
    if ((app.metadata.finalizers ?? []).includes(FINALIZER)) {
      await cleanup(namespace, name, app);
      await setFinalizers(
        namespace,
        name,
        (app.metadata.finalizers ?? []).filter((f) => f !== FINALIZER),
      );
    }
    return;
  }

  // Ensure our finalizer is present before creating anything that needs cleanup.
  if (!(app.metadata.finalizers ?? []).includes(FINALIZER)) {
    await setFinalizers(namespace, name, [...(app.metadata.finalizers ?? []), FINALIZER]);
  }

  const spec = app.spec;
  const spaceSlug = namespace.replace(/^ks-/, "");
  const owner: OwnerRef = {
    apiVersion: app.apiVersion,
    kind: app.kind,
    name: app.metadata.name,
    uid: app.metadata.uid!,
    controller: true,
    blockOwnerDeletion: true,
  };
  const labels = managedLabels({
    "korepush.io/space": spaceSlug,
    "korepush.io/app": name,
    app: name,
  });

  if (!spec.image) {
    await patchCRStatus(
      { plural: PLURAL, meta: app.metadata, logPrefix: "[status]" },
      { phase: "Pending" },
      "NoImage",
      "Waiting for an image (build pending)",
    );
    return;
  }

  // Container env: plain values + secretKeyRefs from spec.env, injected PORT,
  // the attached-database connection string (resolved from the CNPG secret in
  // this namespace), and envFrom for the per-app secret. Explicit env wins.
  const env = (spec.env ?? []).map((e) =>
    e.value != null
      ? { name: e.name, value: e.value }
      : { name: e.name, valueFrom: { secretKeyRef: e.secretKeyRef } },
  );
  if (!env.some((e) => e.name === "PORT")) {
    env.push({ name: "PORT", value: String(spec.port) });
  }
  if (spec.database?.name) {
    const dbVar = spec.database.envVar || "DATABASE_URL";
    if (!env.some((e) => e.name === dbVar)) {
      env.push({
        name: dbVar,
        valueFrom: { secretKeyRef: { name: `db-${spec.database.name}-app`, key: "uri" } },
      });
    }
  }
  const envFrom = (spec.envFrom ?? []).map((f) => ({ secretRef: { name: f.secretRef.name } }));
  const hc = spec.healthcheck;
  const probe =
    hc?.test?.length && hc.test[0] !== "NONE"
      ? {
          exec: { command: hc.test },
          periodSeconds: hc.interval ?? 30,
          timeoutSeconds: hc.timeout ?? 5,
          failureThreshold: hc.retries ?? 3,
        }
      : undefined;
  // Persistent volumes -> one RWO PVC each on local-path. Sort by name so a row
  // reorder doesn't churn a (downtime-causing) Recreate via JSON.stringify drift.
  // RWO means only one pod can mount at a time, so any volume forces replicas=1 +
  // Recreate (a RollingUpdate would deadlock on the held volume). Setting strategy
  // explicitly on BOTH branches keeps a volume-less app from drifting against the
  // server-defaulted RollingUpdate.
  const vols = [...(spec.volumes ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const hasVolumes = vols.length > 0;
  const replicas = hasVolumes ? 1 : (spec.replicas ?? 1);
  const strategy = hasVolumes ? { type: "Recreate" } : { type: "RollingUpdate" };
  const volumeMounts = vols.map((v) => ({ name: v.name, mountPath: v.mountPath }));
  const podVolumes = vols.map((v) => ({
    name: v.name,
    persistentVolumeClaim: { claimName: `${name}-${v.name}` },
  }));
  const container = {
    name,
    image: spec.image,
    ports: [{ containerPort: spec.port }],
    env,
    ...(spec.command?.length ? { command: spec.command } : {}),
    ...(spec.args?.length ? { args: spec.args } : {}),
    ...(envFrom.length ? { envFrom } : {}),
    resources: {
      requests: { cpu: "50m", memory: "64Mi" },
      limits: {
        cpu: spec.resources?.cpu ?? "500m",
        memory: spec.resources?.memory ?? "256Mi",
      },
    },
    ...(probe
      ? {
          readinessProbe: probe,
          livenessProbe: { ...probe, initialDelaySeconds: hc?.startPeriod ?? 10 },
        }
      : {}),
    ...(volumeMounts.length ? { volumeMounts } : {}),
  };
  // A restart stamp on the CR (bumped by the control plane on env/secret change)
  // is propagated to the pod template so a Secret-value-only change rolls pods.
  const restartedAt = app.metadata.annotations?.["korepush.io/restartedAt"];
  const podAnnotations = restartedAt ? { "korepush.io/restartedAt": restartedAt } : undefined;

  // Private-registry pull secret: attach the space's merged pull secret if it
  // exists (the control plane maintains `korepush-pull` when registry creds are
  // added). Harmless for public images.
  const hasPull = await core
    .readNamespacedSecret({ name: "korepush-pull", namespace })
    .then(() => true)
    .catch(() => false);
  const imagePullSecrets = hasPull ? [{ name: "korepush-pull" }] : undefined;

  // PVCs: create-if-missing BEFORE the Deployment (else the pod schedules and
  // hangs Pending waiting for a claim). NO ownerReference — PVCs survive
  // Deployment/operator churn AND CR deletion; the control plane deletes them
  // explicitly (deleteApp / setAppVolumes), so data loss is never an implicit GC
  // cascade. Size is immutable after bind (local-path can't resize) — never patch
  // an existing PVC.
  for (const v of vols) {
    const pvcName = `${name}-${v.name}`;
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
              resources: { requests: { storage: v.size } },
            },
          },
        })
        .catch((err: unknown) => console.error("[pvc] create failed", pvcName, err));
    }
  }

  // Deployment: create, or replace only when the meaningful spec drifted.
  // Replace is a read-modify-write on a live object (its readyReplicas churns),
  // so retry on 409 by re-reading — the work queue would retry anyway, this just
  // avoids the noise/latency.
  for (let attempt = 0; attempt < 4; attempt++) {
    const existing = await apps.readNamespacedDeployment({ name, namespace }).catch(() => null);
    if (!existing) {
      await apps.createNamespacedDeployment({
        namespace,
        body: {
          metadata: { name, namespace, labels, ownerReferences: [owner] },
          spec: {
            replicas,
            strategy,
            selector: { matchLabels: { app: name } },
            template: {
              metadata: { labels, ...(podAnnotations ? { annotations: podAnnotations } : {}) },
              spec: {
                containers: [container],
                ...(imagePullSecrets ? { imagePullSecrets } : {}),
                ...(podVolumes.length ? { volumes: podVolumes } : {}),
              },
            },
          },
        },
      });
      break;
    }
    const cur = existing.spec?.template?.spec?.containers?.[0];
    const curRestart = existing.spec?.template?.metadata?.annotations?.["korepush.io/restartedAt"];
    // Adoption: an existing Deployment created by the old control plane has no
    // ownerReference — stamp one so it GCs with the CR. This is a metadata-only
    // replace (pod template unchanged) so it does NOT roll pods.
    const needsOwner = !existing.metadata?.ownerReferences?.some((o) => o.uid === owner.uid);
    // restartedAt is a one-way CR->pod signal: only force a roll when the CR
    // carries a NEW stamp. An unset CR stamp must NOT "drift" against a legacy
    // Deployment that still has an old annotation (that would churn forever).
    const restartChanged = !!restartedAt && restartedAt !== curRestart;
    const drifted =
      needsOwner ||
      restartChanged ||
      JSON.stringify([
        cur?.image,
        cur?.env,
        cur?.envFrom,
        existing.spec?.replicas,
        existing.spec?.template?.spec?.imagePullSecrets,
        existing.spec?.strategy?.type,
        // Normalised projections: k8s may add default fields to mounts/volumes,
        // so compare just the identifying shape to avoid a no-op Recreate churn.
        (cur?.volumeMounts ?? []).map((m) => `${m.name}:${m.mountPath}`),
        (existing.spec?.template?.spec?.volumes ?? []).map(
          (vv) => `${vv.name}:${vv.persistentVolumeClaim?.claimName ?? ""}`,
        ),
      ]) !==
        JSON.stringify([
          container.image,
          container.env,
          container.envFrom,
          replicas,
          imagePullSecrets,
          strategy.type,
          volumeMounts.map((m) => `${m.name}:${m.mountPath}`),
          podVolumes.map((vv) => `${vv.name}:${vv.persistentVolumeClaim.claimName}`),
        ]);
    if (!drifted) break;
    existing.metadata = { ...existing.metadata, labels, ownerReferences: [owner] };
    existing.spec!.replicas = replicas;
    // Full PUT: setting strategy explicitly resets Recreate->RollingUpdate when
    // all volumes are removed; volumes=undefined clears the pod volumes.
    existing.spec!.strategy = strategy;
    existing.spec!.template.spec!.containers = [container];
    existing.spec!.template.spec!.imagePullSecrets = imagePullSecrets;
    existing.spec!.template.spec!.volumes = podVolumes.length ? podVolumes : undefined;
    const tmpl = existing.spec!.template;
    tmpl.metadata = tmpl.metadata ?? {};
    if (restartedAt) {
      tmpl.metadata.annotations = { ...tmpl.metadata.annotations, "korepush.io/restartedAt": restartedAt };
    }
    try {
      await apps.replaceNamespacedDeployment({ name, namespace, body: existing });
      break;
    } catch (e) {
      if ((e as { code?: number })?.code === 409) continue; // re-read + retry
      throw e;
    }
  }

  // Service: create-if-missing, and adopt a pre-existing one by stamping the
  // ownerRef (metadata-only patch — no disruption) so it GCs with the CR.
  const svc = await core.readNamespacedService({ name, namespace }).catch(() => null);
  if (!svc) {
    await core.createNamespacedService({
      namespace,
      body: {
        metadata: { name, namespace, labels, ownerReferences: [owner] },
        spec: { selector: { app: name }, ports: [{ port: 80, targetPort: spec.port }] },
      },
    });
  } else if (!svc.metadata?.ownerReferences?.some((o) => o.uid === owner.uid)) {
    await core.patchNamespacedService(
      { name, namespace, body: { metadata: { ownerReferences: [owner] } } },
      mergePatch,
    );
  }

  // Auto-host route (+ TLS on a real base domain) and custom-domain routes.
  const host = `${name}.${spaceSlug}.${BASE_DOMAIN}`;
  const tlsEnabled = isRealDomain(BASE_DOMAIN);
  if (tlsEnabled) await ensureHttpsCert(host, hostTlsSecret(host), false).catch(() => {});
  await reconcileHTTPRoute(
    namespace,
    name,
    [host],
    tlsEnabled ? ["web", "https"] : ["web"],
    [{ name, weight: 100 }],
    labels,
    owner,
  );
  await reconcileDomains(namespace, name, spec.domains ?? [], labels, owner);

  // Status (phase from readyReplicas + per-domain cert status).
  const liveDep = await apps.readNamespacedDeployment({ name, namespace }).catch(() => null);
  const ready = liveDep?.status?.readyReplicas ?? 0;
  // The scale subresource's statusReplicasPath is .status.replicas, which by
  // contract is the OBSERVED replica count (what `kubectl scale --current-replicas`
  // and any HPA read) — not the desired count (that's spec.replicas).
  const observed = liveDep?.status?.replicas ?? 0;
  const phase = replicas === 0 ? "Stopped" : ready >= replicas ? "Running" : "Progressing";
  await patchCRStatus(
    { plural: PLURAL, meta: app.metadata, logPrefix: "[status]" },
    {
      phase,
      currentImage: spec.image,
      url: `${tlsEnabled ? "https" : "http"}://${host}`,
      replicas: observed,
      readyReplicas: ready,
      selector: `app=${name}`,
      domains: await domainStatuses(name, spec.domains ?? []),
    },
    "Reconciled",
    "Reconciled successfully",
  );
}

/** Custom-domain reconcile from spec.domains[]: one cert per host + a shared route. */
async function reconcileDomains(
  namespace: string,
  name: string,
  domains: { host: string; staging?: boolean }[],
  labels: Record<string, string>,
  owner: OwnerRef,
) {
  const routeName = `${name}-domains`;
  if (domains.length === 0) {
    await deleteHTTPRoute(namespace, routeName);
    return;
  }
  // Every host in spec.domains is past the control plane's DNS precheck, so each
  // gets a cert and the route attaches to the https listener (SNI-selected).
  for (const d of domains) {
    await ensureHttpsCert(d.host, domainSecretName(name, d.host), d.staging ?? false).catch(() => {});
  }
  await reconcileHTTPRoute(
    namespace,
    routeName,
    domains.map((d) => d.host),
    ["web", "https"],
    [{ name, weight: 100 }],
    labels,
    owner,
  );
}

/** Per-domain status from each cert's Ready condition (surfaced on the CR). */
async function domainStatuses(
  name: string,
  domains: { host: string }[],
): Promise<{ host: string; phase: string; message: string }[]> {
  const { custom } = k8sClients();
  const out: { host: string; phase: string; message: string }[] = [];
  for (const d of domains) {
    const cert = (await custom
      .getNamespacedCustomObject({
        group: CM_GROUP,
        version: CM_VERSION,
        namespace: GW_NS,
        plural: "certificates",
        name: domainSecretName(name, d.host),
      })
      .catch(() => null)) as {
      status?: { conditions?: { type: string; status: string; reason?: string; message?: string }[] };
    } | null;
    const ready = cert?.status?.conditions?.find((c) => c.type === "Ready");
    // Phases must match the CRD enum (capitalized): Pending|Issuing|Active|Error.
    let phase = "Issuing";
    let message = "";
    if (ready?.status === "True") {
      phase = "Active";
    } else if (ready) {
      phase = ready.reason === "Failed" ? "Error" : "Issuing";
      message = ready.message ?? "";
    }
    out.push({ host: d.host, phase, message });
  }
  return out;
}

/** Cross-namespace cleanup on CR deletion (the finalizer's whole reason to exist). */
async function cleanup(namespace: string, name: string, app: KoreApp): Promise<void> {
  const { core } = k8sClients();
  const spaceSlug = namespace.replace(/^ks-/, "");
  const autoHost = `${name}.${spaceSlug}.${BASE_DOMAIN}`;
  // Auto-host + custom-domain certs live in kube-system on the shared Gateway —
  // not owner-ref'd, so GC can't reach them.
  await removeHttpsCert(hostTlsSecret(autoHost)).catch(() => {});
  for (const d of app.spec.domains ?? []) {
    await removeHttpsCert(domainSecretName(name, d.host)).catch(() => {});
  }
  // The env Secret is control-plane-created (not owner-ref'd); remove it too.
  const envSecret = `${name}-env`;
  await core
    .deleteNamespacedSecret({ name: envSecret, namespace })
    .then(() => console.log("[cleanup] deleted secret", `${namespace}/${envSecret}`))
    .catch((e: unknown) => {
      const code = (e as { code?: number })?.code;
      if (code !== 404) console.error("[cleanup] secret", `${namespace}/${envSecret}`, code, e);
    });
  // Deployment, Service, and both HTTPRoutes are ownerReference-GC'd.
}

async function setFinalizers(namespace: string, name: string, finalizers: string[]): Promise<void> {
  const { custom } = k8sClients();
  await custom
    .patchNamespacedCustomObject(
      { group: GROUP, version: VERSION, namespace, plural: PLURAL, name, body: { metadata: { finalizers } } },
      mergePatch,
    )
    .catch((e: unknown) => console.error("[finalizer]", name, e));
}

