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
import { GROUP, VERSION, PLURAL, type KoreApp, type KoreAppStatus } from "./types";

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
    await setStatus(app, { phase: "Pending" }, "NoImage", "Waiting for an image (build pending)");
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
  const container = {
    name,
    image: spec.image,
    ports: [{ containerPort: spec.port }],
    env,
    ...(envFrom.length ? { envFrom } : {}),
    resources: {
      requests: { cpu: "50m", memory: "64Mi" },
      limits: { cpu: "500m", memory: "256Mi" },
    },
  };
  const replicas = spec.replicas ?? 1;
  // A restart stamp on the CR (bumped by the control plane on env/secret change)
  // is propagated to the pod template so a Secret-value-only change rolls pods.
  const restartedAt = app.metadata.annotations?.["korepush.io/restartedAt"];
  const podAnnotations = restartedAt ? { "korepush.io/restartedAt": restartedAt } : undefined;

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
            selector: { matchLabels: { app: name } },
            template: {
              metadata: { labels, ...(podAnnotations ? { annotations: podAnnotations } : {}) },
              spec: { containers: [container] },
            },
          },
        },
      });
      break;
    }
    const cur = existing.spec?.template?.spec?.containers?.[0];
    const curRestart = existing.spec?.template?.metadata?.annotations?.["korepush.io/restartedAt"];
    const drifted =
      JSON.stringify([cur?.image, cur?.env, cur?.envFrom, existing.spec?.replicas, curRestart]) !==
      JSON.stringify([container.image, container.env, container.envFrom, replicas, restartedAt]);
    if (!drifted) break;
    existing.metadata = { ...existing.metadata, labels, ownerReferences: [owner] };
    existing.spec!.replicas = replicas;
    existing.spec!.template.spec!.containers = [container];
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

  // Service (create-if-missing).
  if (!(await core.readNamespacedService({ name, namespace }).catch(() => null))) {
    await core.createNamespacedService({
      namespace,
      body: {
        metadata: { name, namespace, labels, ownerReferences: [owner] },
        spec: { selector: { app: name }, ports: [{ port: 80, targetPort: spec.port }] },
      },
    });
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
  const ready =
    (await apps.readNamespacedDeployment({ name, namespace }).catch(() => null))?.status
      ?.readyReplicas ?? 0;
  const phase = replicas === 0 ? "Stopped" : ready >= replicas ? "Running" : "Progressing";
  await setStatus(
    app,
    {
      phase,
      currentImage: spec.image,
      url: `${tlsEnabled ? "https" : "http"}://${host}`,
      replicas,
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

async function setStatus(
  app: KoreApp,
  partial: Partial<KoreAppStatus>,
  reason: string,
  message: string,
): Promise<void> {
  const { custom } = k8sClients();
  const status: KoreAppStatus = {
    ...partial,
    observedGeneration: app.metadata.generation,
    conditions: [
      {
        type: "Ready",
        status: partial.phase === "Running" ? "True" : "False",
        observedGeneration: app.metadata.generation,
        lastTransitionTime: new Date().toISOString(),
        reason,
        message,
      },
    ],
  };
  // Merge-patch the status subresource (no resourceVersion → no 409 with the
  // finalizer patch / concurrent spec writes).
  await custom
    .patchNamespacedCustomObjectStatus(
      {
        group: GROUP,
        version: VERSION,
        namespace: app.metadata.namespace,
        plural: PLURAL,
        name: app.metadata.name,
        body: { status },
      },
      mergePatch,
    )
    .catch((e: unknown) => console.error("[status]", app.metadata.name, e));
}
