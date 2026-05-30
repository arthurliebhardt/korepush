import { k8sClients } from "./client";
import { reconcileHTTPRoute, ensureHttpsCert } from "./apps";

// The control plane manages its own k8s objects (created by install.sh).
const NS = "korepush-system";
const SERVICE = "korepush";
const CP_ROUTE = "korepush-cp"; // HTTPRoute for the control-plane custom domain
const SECRET = "korepush-app";
const DEPLOYMENT = "korepush";
const PANEL_TLS_SECRET = "korepush-panel-tls";
// Monitoring (Grafana) lives in its own namespace; its public URL is baked at
// install and must be flipped to https when a custom domain is added.
const MONITORING_NS = "korepush-monitoring";
const GRAFANA_DEPLOYMENT = "grafana";
const CM_GROUP = "cert-manager.io";
const CM_VERSION = "v1";
const GW_GROUP = "gateway.networking.k8s.io";
const GW_VERSION = "v1";
const MANAGED = { "app.kubernetes.io/managed-by": "korepush" };

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type ControlPlaneInfo = {
  /** Custom domain hostnames currently routed to the control plane. */
  hosts: string[];
  /** Origins better-auth currently trusts. */
  trustedOrigins: string[];
};

export async function getControlPlaneInfo(): Promise<ControlPlaneInfo> {
  const { custom, core } = k8sClients();
  const route = (await custom
    .getNamespacedCustomObject({
      group: GW_GROUP,
      version: GW_VERSION,
      namespace: NS,
      plural: "httproutes",
      name: CP_ROUTE,
    })
    .catch(() => null)) as { spec?: { hostnames?: string[] } } | null;
  const hosts = route?.spec?.hostnames ?? [];

  const sec = await core.readNamespacedSecret({ name: SECRET, namespace: NS });
  const trustedOrigins = decodeSecretCsv(sec.data?.KOREPUSH_TRUSTED_ORIGINS);
  return { hosts, trustedOrigins };
}

/**
 * Point a custom domain at this control plane AND provision HTTPS for it.
 * Adds an Ingress host rule (keeping the catch-all IP rule so you can't get
 * locked out), annotates the Ingress for cert-manager + adds a TLS block
 * (Let's Encrypt issues the cert once DNS resolves here and :80 is reachable),
 * flips the canonical URL to https, points Grafana at the https sub-path, and
 * restarts the control plane to pick up the new env. Idempotent — re-adding a
 * domain safely re-asserts all of the above.
 */
export async function setControlPlaneDomain(
  domainRaw: string,
  opts: { email?: string; useStaging?: boolean } = {},
): Promise<void> {
  const domain = domainRaw.trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    throw new Error("Enter a valid domain, e.g. kube.example.com");
  }
  const issuer = opts.useStaging ? "letsencrypt-staging" : "letsencrypt-prod";
  const { core, apps, custom } = k8sClients();

  // 1. Provision a cert for the domain (on the shared Gateway's https listener,
  //    SNI-selected) and route it to the control plane via an HTTPRoute on the
  //    web (HTTP) + https listeners. The host-less catch-all HTTPRoute (raw-IP)
  //    is static + untouched, so http://<ip> never locks you out.
  await ensureHttpsCert(domain, PANEL_TLS_SECRET, opts.useStaging ?? false);
  await reconcileHTTPRoute(
    NS,
    CP_ROUTE,
    [domain],
    ["web", "https"],
    [{ name: SERVICE, weight: 100 }],
    MANAGED,
  );

  // 2. Trust the domain's origins, use it as the app base domain, and make
  //    https the canonical control-plane URL.
  const sec = await core.readNamespacedSecret({ name: SECRET, namespace: NS });
  const origins = new Set(decodeSecretCsv(sec.data?.KOREPUSH_TRUSTED_ORIGINS));
  origins.add(`http://${domain}`);
  origins.add(`https://${domain}`);
  sec.data = {
    ...sec.data,
    KOREPUSH_TRUSTED_ORIGINS: encodeSecret([...origins].join(",")),
    KOREPUSH_BASE_DOMAIN: encodeSecret(domain),
    BETTER_AUTH_URL: encodeSecret(`https://${domain}`),
  };
  await core.replaceNamespacedSecret({ name: SECRET, namespace: NS, body: sec });

  // 3. Restart the control plane so the new env takes effect.
  const dep = await apps.readNamespacedDeployment({ name: DEPLOYMENT, namespace: NS });
  const tmpl = dep.spec!.template;
  tmpl.metadata = tmpl.metadata ?? {};
  tmpl.metadata.annotations = {
    ...tmpl.metadata.annotations,
    "korepush.io/restartedAt": new Date().toISOString(),
  };
  await apps.replaceNamespacedDeployment({ name: DEPLOYMENT, namespace: NS, body: dep });

  // 4. Point Grafana at the https sub-path (best-effort: monitoring may not be
  //    installed). Grafana shares the panel cert via SNI — no separate cert.
  try {
    const g = await apps.readNamespacedDeployment({
      name: GRAFANA_DEPLOYMENT,
      namespace: MONITORING_NS,
    });
    const c = g.spec?.template?.spec?.containers?.[0];
    if (c) {
      c.env = c.env ?? [];
      const rootUrl = `https://${domain}/grafana`;
      const existing = c.env.find((e) => e.name === "GF_SERVER_ROOT_URL");
      if (existing) existing.value = rootUrl;
      else c.env.push({ name: "GF_SERVER_ROOT_URL", value: rootUrl });
      const gt = g.spec!.template;
      gt.metadata = gt.metadata ?? {};
      gt.metadata.annotations = {
        ...gt.metadata.annotations,
        "korepush.io/restartedAt": new Date().toISOString(),
      };
      await apps.replaceNamespacedDeployment({
        name: GRAFANA_DEPLOYMENT,
        namespace: MONITORING_NS,
        body: g,
      });
    }
  } catch {
    // monitoring stack absent — skip.
  }

  // 5. Backfill the ACME account email from the admin if the issuer has none
  //    (best-effort; cert-manager may be absent).
  if (opts.email && EMAIL_RE.test(opts.email)) {
    try {
      const obj = (await custom.getClusterCustomObject({
        group: CM_GROUP,
        version: CM_VERSION,
        plural: "clusterissuers",
        name: issuer,
      })) as { spec?: { acme?: { email?: string } } };
      if (obj.spec?.acme && !obj.spec.acme.email) {
        obj.spec.acme.email = opts.email;
        await custom.replaceClusterCustomObject({
          group: CM_GROUP,
          version: CM_VERSION,
          plural: "clusterissuers",
          name: issuer,
          body: obj,
        });
      }
    } catch {
      // cert-manager / issuer absent — skip.
    }
  }
}

function decodeSecretCsv(b64?: string): string[] {
  if (!b64) return [];
  return Buffer.from(b64, "base64")
    .toString("utf8")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function encodeSecret(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
