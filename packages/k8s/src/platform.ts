import { k8sClients } from "./client";

// The control plane manages its own k8s objects (created by install.sh).
const NS = "kubepush-system";
const INGRESS = "kubepush";
const SECRET = "kubepush-app";
const DEPLOYMENT = "kubepush";

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

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
  const trustedOrigins = decodeSecretCsv(sec.data?.KUBEPUSH_TRUSTED_ORIGINS);
  return { hosts, trustedOrigins };
}

/**
 * Point a custom domain at this control plane. Adds an Ingress host rule
 * (keeping the catch-all IP rule), trusts the domain's origins, sets it as the
 * app base domain, and restarts the control plane to pick up the new env.
 */
export async function setControlPlaneDomain(domainRaw: string): Promise<void> {
  const domain = domainRaw.trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    throw new Error("Enter a valid domain, e.g. kube.example.com");
  }
  const { net, core, apps } = k8sClients();

  // 1. Add a host rule for the domain (keep existing rules, incl. catch-all).
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
            backend: {
              service: { name: INGRESS, port: { number: 80 } },
            },
          },
        ],
      },
    });
    ing.spec = { ...ing.spec, rules };
    await net.replaceNamespacedIngress({ name: INGRESS, namespace: NS, body: ing });
  }

  // 2. Trust the domain's origins + use it as the app base domain.
  const sec = await core.readNamespacedSecret({ name: SECRET, namespace: NS });
  const origins = new Set(decodeSecretCsv(sec.data?.KUBEPUSH_TRUSTED_ORIGINS));
  origins.add(`http://${domain}`);
  origins.add(`https://${domain}`);
  sec.data = {
    ...sec.data,
    KUBEPUSH_TRUSTED_ORIGINS: encodeSecret([...origins].join(",")),
    KUBEPUSH_BASE_DOMAIN: encodeSecret(domain),
  };
  await core.replaceNamespacedSecret({ name: SECRET, namespace: NS, body: sec });

  // 3. Restart the control plane so the new env takes effect.
  const dep = await apps.readNamespacedDeployment({ name: DEPLOYMENT, namespace: NS });
  const tmpl = dep.spec!.template;
  tmpl.metadata = tmpl.metadata ?? {};
  tmpl.metadata.annotations = {
    ...tmpl.metadata.annotations,
    "kubepush.io/restartedAt": new Date().toISOString(),
  };
  await apps.replaceNamespacedDeployment({ name: DEPLOYMENT, namespace: NS, body: dep });
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
