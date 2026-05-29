import { Log, type LogOptions } from "@kubernetes/client-node";
import type { Writable } from "node:stream";
import { k8sClients } from "./client";

/** Name of the most relevant pod for an app (running first, else newest). */
export async function getAppPodName(
  namespace: string,
  appSlug: string,
): Promise<string | null> {
  const { core } = k8sClients();
  const pods = await core.listNamespacedPod({
    namespace,
    labelSelector: `app=${appSlug}`,
  });
  if (pods.items.length === 0) return null;

  const sorted = [...pods.items].sort((a, b) => {
    const aRunning = a.status?.phase === "Running" ? 1 : 0;
    const bRunning = b.status?.phase === "Running" ? 1 : 0;
    if (aRunning !== bRunning) return bRunning - aRunning;
    const at = a.metadata?.creationTimestamp
      ? new Date(a.metadata.creationTimestamp).getTime()
      : 0;
    const bt = b.metadata?.creationTimestamp
      ? new Date(b.metadata.creationTimestamp).getTime()
      : 0;
    return bt - at;
  });
  return sorted[0]?.metadata?.name ?? null;
}

/**
 * Stream a pod's logs into a Writable. Returns an AbortController to stop it.
 * Encapsulates the Kubernetes client so consumers never import it directly.
 */
export async function streamPodLogs(
  namespace: string,
  podName: string,
  stream: Writable,
  options: LogOptions = { follow: true, tailLines: 200 },
): Promise<AbortController> {
  const { kc } = k8sClients();
  const log = new Log(kc);
  return log.log(namespace, podName, "", stream, options);
}
