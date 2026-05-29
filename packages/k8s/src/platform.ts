import { k8sClients } from "./client";

// The control plane manages its own k8s objects (created by install.sh).
const NS = "korepush-system";
const INGRESS = "korepush";
const SECRET = "korepush-app";
const DEPLOYMENT = "korepush";
const PANEL_TLS_SECRET = "korepush-panel-tls";
// Monitoring (Grafana) lives in its own namespace; its public URL is baked at
// install and must be flipped to https when a custom domain is added.
const MONITORING_NS = "korepush-monitoring";
const GRAFANA_DEPLOYMENT = "grafana";
const CM_GROUP = "cert-manager.io";
const CM_VERSION = "v1";

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type ControlPlaneInfo = {
  /** Host rules currently on the control-plane Ingress (empty = catch-all/IP). */
  hosts: string[];
  /** Origins better-auth currently trusts. */
  trustedOrigins: string[];
};

export async function getControlPlaneInfo(): Promise<ControlPlaneInfo> {
  const { net, core } = k8sClients();
  const ing = await net.readNamespacedIngress({ name: INGRESS, namespace: NS });
  const hosts = (ing.spec?.rules ?? [])
    .map((r) => r.host)
    .filter((h): h is string => !!h);

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
  const { net, core, apps, custom } = k8sClients();

  // 1. Add a host rule for the domain (keep existing rules, incl. catch-all)
  //    and attach cert-manager annotation + a TLS block for the domain. The
  //    catch-all rule stays HTTP-only (no host → no cert), so http://<ip>
  //    keeps working as a lockout-safety net.
  const ing = await net.readNamespacedIngress({ name: INGRESS, namespace: NS });
  const rules = ing.spec?.rules ?? [];
  if (!rules.some((r) => r.host === domain)) {
    rules.push({
      host: domain,
      http: {
        paths: [
          {
            path: "/",
            pathType: "Prefix",
            backend: { service: { name: INGRESS, port: { number: 80 } } },
          },
        ],
      },
    });
  }
  const tls = ing.spec?.tls ?? [];
  if (!tls.some((t) => (t.hosts ?? []).includes(domain))) {
    tls.push({ hosts: [domain], secretName: PANEL_TLS_SECRET });
  }
  ing.metadata = ing.metadata ?? {};
  ing.metadata.annotations = {
    ...ing.metadata.annotations,
    "cert-manager.io/cluster-issuer": issuer,
  };
  ing.spec = { ...ing.spec, rules, tls };
  await net.replaceNamespacedIngress({ name: INGRESS, namespace: NS, body: ing });

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
