import { k8sClients, managedLabels } from "./client";
import { getSpaceBySlug } from "./spaces";

// Private-registry pull credentials for a space, stored as a single merged
// `korepush-pull` dockerconfigjson Secret in the space namespace. The operator
// attaches it as imagePullSecrets on every Deployment in that namespace, so any
// app can pull a private image from a registry the user has added.

const PULL_SECRET = "korepush-pull";
const KEY = ".dockerconfigjson";

type DockerAuth = { username: string; password: string; auth: string };
type DockerConfig = { auths: Record<string, DockerAuth> };

export type RegistryCredential = { registry: string; username: string };

function decode(b64?: string): DockerConfig {
  if (!b64) return { auths: {} };
  try {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return json && typeof json.auths === "object" ? json : { auths: {} };
  } catch {
    return { auths: {} };
  }
}

function encode(cfg: DockerConfig): Record<string, string> {
  return { [KEY]: Buffer.from(JSON.stringify(cfg), "utf8").toString("base64") };
}

/** The registries this space has credentials for (never returns passwords). */
export async function listRegistryCredentials(
  namespace: string,
): Promise<RegistryCredential[]> {
  const { core } = k8sClients();
  const sec = await core
    .readNamespacedSecret({ name: PULL_SECRET, namespace })
    .catch(() => null);
  const cfg = decode(sec?.data?.[KEY]);
  return Object.entries(cfg.auths).map(([registry, a]) => ({
    registry,
    username: a.username,
  }));
}

/** Add or replace one registry credential in the space's merged pull secret. */
export async function setRegistryCredential(
  spaceSlug: string,
  registry: string,
  username: string,
  password: string,
): Promise<void> {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const host = (registry || "").trim() || "docker.io";
  const { core } = k8sClients();
  const existing = await core
    .readNamespacedSecret({ name: PULL_SECRET, namespace: space.namespace })
    .catch(() => null);
  const cfg = decode(existing?.data?.[KEY]);
  cfg.auths[host] = {
    username,
    password,
    auth: Buffer.from(`${username}:${password}`, "utf8").toString("base64"),
  };
  const data = encode(cfg);
  if (existing) {
    existing.data = data;
    await core.replaceNamespacedSecret({
      name: PULL_SECRET,
      namespace: space.namespace,
      body: existing,
    });
  } else {
    await core.createNamespacedSecret({
      namespace: space.namespace,
      body: {
        metadata: {
          name: PULL_SECRET,
          namespace: space.namespace,
          labels: managedLabels({}),
        },
        type: "kubernetes.io/dockerconfigjson",
        data,
      },
    });
  }
}

/** Remove one registry credential (deletes the secret if it becomes empty). */
export async function removeRegistryCredential(
  spaceSlug: string,
  registry: string,
): Promise<void> {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const { core } = k8sClients();
  const existing = await core
    .readNamespacedSecret({ name: PULL_SECRET, namespace: space.namespace })
    .catch(() => null);
  if (!existing) return;
  const cfg = decode(existing.data?.[KEY]);
  delete cfg.auths[registry];
  if (Object.keys(cfg.auths).length === 0) {
    await core
      .deleteNamespacedSecret({ name: PULL_SECRET, namespace: space.namespace })
      .catch(() => {});
    return;
  }
  existing.data = encode(cfg);
  await core.replaceNamespacedSecret({
    name: PULL_SECRET,
    namespace: space.namespace,
    body: existing,
  });
}
