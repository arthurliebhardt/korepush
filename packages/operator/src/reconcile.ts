import { k8sClients, managedLabels } from "@korepush/k8s";
import { GROUP, VERSION, PLURAL, type KoreApp, type KoreAppStatus } from "./types";

const BASE_DOMAIN = process.env.KOREPUSH_BASE_DOMAIN ?? "localhost";
const GW_GROUP = "gateway.networking.k8s.io";
const GW_VERSION = "v1";

type OwnerRef = {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
  controller: boolean;
  blockOwnerDeletion: boolean;
};

/**
 * Reconcile one KoreApp → Deployment + Service + auto-host HTTPRoute. Level-
 * triggered: re-reads the live CR. Children carry an ownerReference so deleting
 * the CR garbage-collects them (M-OP1; cross-namespace cert cleanup via a
 * finalizer lands in M-OP2). Image apps only for now.
 */
export async function reconcile(namespace: string, name: string): Promise<void> {
  const { custom, apps, core } = k8sClients();
  const app = (await custom
    .getNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name })
    .catch(() => null)) as KoreApp | null;
  if (!app) return; // deleted → ownerReference GC removes children
  if (app.metadata.deletionTimestamp) return; // finalizer cleanup: M-OP2

  const spec = app.spec;
  const owner: OwnerRef = {
    apiVersion: app.apiVersion,
    kind: app.kind,
    name: app.metadata.name,
    uid: app.metadata.uid!,
    controller: true,
    blockOwnerDeletion: true,
  };
  const labels = managedLabels({ app: name, "korepush.io/app": name });

  if (!spec.image) {
    await setStatus(app, { phase: "Pending" }, "NoImage", "Waiting for an image (build pending)");
    return;
  }

  // Container from the CR spec (plain env + secretKeyRef + envFrom + PORT).
  const env = (spec.env ?? []).map((e) =>
    e.value != null
      ? { name: e.name, value: e.value }
      : { name: e.name, valueFrom: { secretKeyRef: e.secretKeyRef } },
  );
  if (!env.some((e) => e.name === "PORT")) {
    env.push({ name: "PORT", value: String(spec.port) });
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

  // Deployment: create, or replace ONLY when the meaningful spec drifted (so a
  // resync doesn't churn healthy pods).
  const existing = await apps.readNamespacedDeployment({ name, namespace }).catch(() => null);
  if (!existing) {
    await apps.createNamespacedDeployment({
      namespace,
      body: {
        metadata: { name, namespace, labels, ownerReferences: [owner] },
        spec: {
          replicas,
          selector: { matchLabels: { app: name } },
          template: { metadata: { labels }, spec: { containers: [container] } },
        },
      },
    });
  } else {
    const cur = existing.spec?.template?.spec?.containers?.[0];
    const drifted =
      JSON.stringify([cur?.image, cur?.env, cur?.envFrom, existing.spec?.replicas]) !==
      JSON.stringify([container.image, container.env, container.envFrom, replicas]);
    if (drifted) {
      existing.metadata = { ...existing.metadata, labels, ownerReferences: [owner] };
      existing.spec!.replicas = replicas;
      existing.spec!.template.spec!.containers = [container];
      await apps.replaceNamespacedDeployment({ name, namespace, body: existing });
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

  // Auto-host HTTPRoute on the shared Gateway (derived host).
  const host = `${name}.${namespace.replace(/^ks-/, "")}.${BASE_DOMAIN}`;
  await ensureHTTPRoute(namespace, name, host, labels, owner);

  // Status.
  const ready =
    (await apps.readNamespacedDeployment({ name, namespace }).catch(() => null))?.status
      ?.readyReplicas ?? 0;
  const phase = replicas === 0 ? "Stopped" : ready >= replicas ? "Running" : "Progressing";
  await setStatus(
    app,
    { phase, currentImage: spec.image, url: `http://${host}`, replicas, readyReplicas: ready, selector: `app=${name}` },
    "Reconciled",
    "Reconciled successfully",
  );
}

async function ensureHTTPRoute(
  namespace: string,
  name: string,
  host: string,
  labels: Record<string, string>,
  owner: OwnerRef,
) {
  const { custom } = k8sClients();
  const body: Record<string, unknown> = {
    apiVersion: `${GW_GROUP}/${GW_VERSION}`,
    kind: "HTTPRoute",
    metadata: { name, namespace, labels, ownerReferences: [owner] },
    spec: {
      parentRefs: [{ name: "korepush", namespace: "kube-system", sectionName: "web" }],
      hostnames: [host],
      rules: [{ backendRefs: [{ name, port: 80, weight: 100 }] }],
    },
  };
  const existing = (await custom
    .getNamespacedCustomObject({ group: GW_GROUP, version: GW_VERSION, namespace, plural: "httproutes", name })
    .catch(() => null)) as { metadata?: { resourceVersion?: string } } | null;
  if (!existing) {
    await custom.createNamespacedCustomObject({ group: GW_GROUP, version: GW_VERSION, namespace, plural: "httproutes", body });
  } else {
    (body.metadata as Record<string, unknown>).resourceVersion = existing.metadata?.resourceVersion;
    await custom.replaceNamespacedCustomObject({ group: GW_GROUP, version: GW_VERSION, namespace, plural: "httproutes", name, body });
  }
}

async function setStatus(
  app: KoreApp,
  partial: Partial<KoreAppStatus>,
  reason: string,
  message: string,
) {
  const { custom } = k8sClients();
  app.status = {
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
  await custom
    .replaceNamespacedCustomObjectStatus({
      group: GROUP,
      version: VERSION,
      namespace: app.metadata.namespace,
      plural: PLURAL,
      name: app.metadata.name,
      body: app,
    })
    .catch((e: unknown) => console.error("[status]", app.metadata.name, e));
}
