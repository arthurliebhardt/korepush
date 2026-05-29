import * as k8s from "@kubernetes/client-node";

export const MANAGED_BY = "kubepush";

let cached: ReturnType<typeof build> | null = null;

function build() {
  const kc = new k8s.KubeConfig();
  // In-cluster the API host is injected as KUBERNETES_SERVICE_HOST. Otherwise
  // use the local kubeconfig (KUBECONFIG env or ~/.kube/config).
  if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
  } else {
    kc.loadFromDefault();
  }
  return {
    kc,
    core: kc.makeApiClient(k8s.CoreV1Api),
    apps: kc.makeApiClient(k8s.AppsV1Api),
    net: kc.makeApiClient(k8s.NetworkingV1Api),
  };
}

export function k8sClients() {
  if (!cached) cached = build();
  return cached;
}

/** Quick connectivity probe used by the dashboard health indicator. */
export async function clusterReachable(): Promise<boolean> {
  try {
    await k8sClients().core.listNamespace({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

/** Standard labels stamped on every kubepush-managed object. */
export function managedLabels(extra: Record<string, string> = {}) {
  return { "app.kubernetes.io/managed-by": MANAGED_BY, ...extra };
}
