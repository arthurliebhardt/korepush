// DB-free routing + TLS layer for the shared Gateway. Everything here depends
// only on the k8s client (./client) and node:dns — NO @korepush/db — so it can
// be imported by BOTH the control plane (apps.ts/platform.ts) and the operator
// bundle without dragging Postgres/drizzle in. The naming helpers
// (hostTlsSecret/domainSecretName) and the Gateway/cert coordinates are
// load-bearing contracts shared by both processes; keep them identical.
import { promises as dns } from "node:dns";
import { k8sClients, managedLabels } from "./client";

export const BASE_DOMAIN = process.env.KOREPUSH_BASE_DOMAIN ?? "localhost";
export const CM_GROUP = "cert-manager.io";
export const CM_VERSION = "v1";
// The shared Gateway (Gateway API) lives in kube-system with Traefik. Routing
// is HTTPRoutes attached to its listeners ("web" HTTP, "https" HTTPS).
export const GW_GROUP = "gateway.networking.k8s.io";
export const GW_VERSION = "v1";
export const GW_NAME = "korepush";
export const GW_NS = "kube-system";

export type HttpBackend = { name: string; weight: number };

/**
 * Create/replace an HTTPRoute in `namespace` attaching to the shared Gateway's
 * listener `sections` (e.g. ["web"] or ["web","https"]), routing the given
 * hostnames (empty = host-less catch-all) to weighted same-namespace Services.
 * Optional `ownerRef` makes the route GC with its owner (operator use).
 */
export async function reconcileHTTPRoute(
  namespace: string,
  name: string,
  hostnames: string[],
  sections: string[],
  backends: HttpBackend[],
  labels: Record<string, string>,
  ownerRef?: Record<string, unknown>,
) {
  const { custom } = k8sClients();
  const body: Record<string, unknown> = {
    apiVersion: `${GW_GROUP}/${GW_VERSION}`,
    kind: "HTTPRoute",
    metadata: {
      name,
      namespace,
      labels,
      ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
    },
    spec: {
      parentRefs: sections.map((s) => ({
        name: GW_NAME,
        namespace: GW_NS,
        sectionName: s,
      })),
      ...(hostnames.length ? { hostnames } : {}),
      rules: [
        {
          backendRefs: backends.map((b) => ({
            name: b.name,
            port: 80,
            weight: b.weight,
          })),
        },
      ],
    },
  };
  const existing = (await custom
    .getNamespacedCustomObject({
      group: GW_GROUP,
      version: GW_VERSION,
      namespace,
      plural: "httproutes",
      name,
    })
    .catch(() => null)) as { metadata?: { resourceVersion?: string } } | null;
  if (!existing) {
    await custom.createNamespacedCustomObject({
      group: GW_GROUP,
      version: GW_VERSION,
      namespace,
      plural: "httproutes",
      body,
    });
  } else {
    (body.metadata as Record<string, unknown>).resourceVersion =
      existing.metadata?.resourceVersion;
    await custom.replaceNamespacedCustomObject({
      group: GW_GROUP,
      version: GW_VERSION,
      namespace,
      plural: "httproutes",
      name,
      body,
    });
  }
}

export async function deleteHTTPRoute(namespace: string, name: string) {
  await k8sClients()
    .custom.deleteNamespacedCustomObject({
      group: GW_GROUP,
      version: GW_VERSION,
      namespace,
      plural: "httproutes",
      name,
    })
    .catch(() => {});
}

/** Globally-unique TLS Secret name for a hostname (certs live in kube-system). */
export function hostTlsSecret(host: string): string {
  const h = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `tls-${h}`.slice(0, 253);
}

/** Globally-unique cert Secret name for an app's custom domain. */
export function domainSecretName(appSlug: string, host: string): string {
  const h = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${appSlug}-d-${h}`.slice(0, 253);
}

// Add/remove a cert Secret on the shared Gateway's single "https" listener
// (Traefik selects by SNI). Conflict-safe (the Gateway is a shared object).
async function patchGatewayHttpsCert(secretName: string, add: boolean) {
  const { custom } = k8sClients();
  type Listener = Record<string, unknown> & {
    name: string;
    tls?: { certificateRefs?: Array<{ name: string }> };
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    const gw = (await custom.getNamespacedCustomObject({
      group: GW_GROUP,
      version: GW_VERSION,
      namespace: GW_NS,
      plural: "gateways",
      name: GW_NAME,
    })) as { spec?: { listeners?: Listener[] } };
    let listeners = [...(gw.spec?.listeners ?? [])];
    const https = listeners.find((l) => l.name === "https");
    const ref = { kind: "Secret", group: "", name: secretName };
    if (add) {
      if (!https) {
        listeners.push({
          name: "https",
          protocol: "HTTPS",
          port: 8443,
          tls: { mode: "Terminate", certificateRefs: [ref] },
          allowedRoutes: { namespaces: { from: "All" } },
        } as Listener);
      } else {
        const refs = (https.tls!.certificateRefs ??= []);
        if (!refs.some((r) => r.name === secretName)) refs.push(ref);
      }
    } else if (https) {
      https.tls!.certificateRefs = (https.tls!.certificateRefs ?? []).filter(
        (r) => r.name !== secretName,
      );
      if (https.tls!.certificateRefs.length === 0) {
        listeners = listeners.filter((l) => l.name !== "https");
      }
    } else {
      return; // nothing to remove
    }
    const body = { ...gw, spec: { ...gw.spec, listeners } };
    try {
      await custom.replaceNamespacedCustomObject({
        group: GW_GROUP,
        version: GW_VERSION,
        namespace: GW_NS,
        plural: "gateways",
        name: GW_NAME,
        body,
      });
      return;
    } catch (e) {
      if ((e as { code?: number })?.code === 409) continue; // re-read + retry
      throw e;
    }
  }
}

/** Provision a cert for `host` (kube-system) and put it on the https listener. */
export async function ensureHttpsCert(
  host: string,
  secretName: string,
  useStaging: boolean,
) {
  const { custom } = k8sClients();
  const existing = await custom
    .getNamespacedCustomObject({
      group: CM_GROUP,
      version: CM_VERSION,
      namespace: GW_NS,
      plural: "certificates",
      name: secretName,
    })
    .catch(() => null);
  if (!existing) {
    await custom.createNamespacedCustomObject({
      group: CM_GROUP,
      version: CM_VERSION,
      namespace: GW_NS,
      plural: "certificates",
      body: {
        apiVersion: `${CM_GROUP}/${CM_VERSION}`,
        kind: "Certificate",
        metadata: { name: secretName, namespace: GW_NS, labels: managedLabels({}) },
        spec: {
          secretName,
          dnsNames: [host],
          issuerRef: {
            name: useStaging ? "letsencrypt-staging" : "letsencrypt-prod",
            kind: "ClusterIssuer",
            group: CM_GROUP,
          },
        },
      },
    });
  }
  await patchGatewayHttpsCert(secretName, true);
}

export async function removeHttpsCert(secretName: string) {
  await patchGatewayHttpsCert(secretName, false);
  const { custom, core } = k8sClients();
  await custom
    .deleteNamespacedCustomObject({
      group: CM_GROUP,
      version: CM_VERSION,
      namespace: GW_NS,
      plural: "certificates",
      name: secretName,
    })
    .catch(() => {});
  await core
    .deleteNamespacedSecret({ name: secretName, namespace: GW_NS })
    .catch(() => {});
}

/** The server's reachable IP, for DNS instructions + the DNS precheck. */
export async function getNodeIp(): Promise<string | null> {
  if (process.env.KOREPUSH_NODE_IP) return process.env.KOREPUSH_NODE_IP;
  try {
    const { core } = k8sClients();
    const nodes = await core.listNode();
    const addrs = nodes.items[0]?.status?.addresses ?? [];
    return (
      addrs.find((a) => a.type === "ExternalIP")?.address ??
      addrs.find((a) => a.type === "InternalIP")?.address ??
      null
    );
  } catch {
    return null;
  }
}

/** True when `host` resolves to the same IP as the app's auto host / node IP. */
export async function dnsPointsHere(
  host: string,
  autoHost: string,
  serverIp: string | null,
): Promise<boolean> {
  const targets = new Set<string>();
  if (serverIp) targets.add(serverIp);
  try {
    (await dns.resolve4(autoHost)).forEach((a) => targets.add(a));
  } catch {
    // auto host may be unresolvable (IP-only base) — fall back to serverIp.
  }
  if (targets.size === 0) return false;
  try {
    const addrs = await dns.resolve4(host);
    return addrs.some((a) => targets.has(a));
  } catch {
    return false;
  }
}

/** True for a real owned domain (not localhost, an IP, or a magic-DNS base). */
export function isRealDomain(d: string): boolean {
  if (!d || d === "localhost") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d)) return false;
  if (d.endsWith(".sslip.io") || d.endsWith(".nip.io")) return false;
  return d.includes(".");
}
