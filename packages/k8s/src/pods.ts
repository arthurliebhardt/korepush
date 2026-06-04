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

/** Read a pod's whole log (non-streaming) as a string, capped to tailLines. */
export async function getPodLogs(
  namespace: string,
  podName: string,
  container = "",
  tailLines = 5000,
): Promise<string | null> {
  try {
    const { core } = k8sClients();
    const res = await core.readNamespacedPodLog({
      namespace,
      name: podName,
      container: container || undefined,
      tailLines,
    });
    return typeof res === "string" ? res : null;
  } catch {
    return null;
  }
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
  container = "",
): Promise<AbortController> {
  const { kc } = k8sClients();
  const log = new Log(kc);
  return log.log(namespace, podName, container, stream, options);
}

export type ContainerDiag = {
  pod: string;
  container: string;
  ready: boolean;
  restarts: number;
  state: "running" | "waiting" | "terminated" | "unknown";
  waitingReason?: string;
  waitingMessage?: string;
  lastExitCode?: number;
  lastReason?: string;
  lastSignal?: number;
  lastFinishedAt?: string;
};

export type AppEvent = {
  type: string; // Normal | Warning
  reason: string;
  message: string;
  object: string; // "<Kind>/<name>"
  count: number;
  lastSeen: string | null;
};

export type AppDiagnostics = {
  ok: boolean;
  containers: ContainerDiag[];
  events: AppEvent[];
};

/**
 * Read-only crash/restart + events diagnostics for an app. Never throws —
 * returns {ok:false,...} so the UI degrades gracefully (mirrors getAppMetrics).
 */
export async function getAppDiagnostics(
  namespace: string,
  appSlug: string,
): Promise<AppDiagnostics> {
  const { core } = k8sClients();
  try {
    const pods = await core.listNamespacedPod({
      namespace,
      labelSelector: `app=${appSlug}`,
    });
    const podNames = new Set(
      pods.items.map((p) => p.metadata?.name).filter(Boolean) as string[],
    );

    const containers: ContainerDiag[] = [];
    for (const p of pods.items) {
      for (const cs of p.status?.containerStatuses ?? []) {
        const term = cs.lastState?.terminated;
        containers.push({
          pod: p.metadata?.name ?? "",
          container: cs.name,
          ready: !!cs.ready,
          restarts: cs.restartCount ?? 0,
          state: cs.state?.running
            ? "running"
            : cs.state?.waiting
              ? "waiting"
              : cs.state?.terminated
                ? "terminated"
                : "unknown",
          waitingReason: cs.state?.waiting?.reason,
          waitingMessage: cs.state?.waiting?.message,
          lastExitCode: term?.exitCode,
          lastReason: term?.reason,
          lastSignal: term?.signal,
          lastFinishedAt: term?.finishedAt
            ? new Date(term.finishedAt).toISOString()
            : undefined,
        });
      }
    }

    // k8s field-selectors can't reliably AND on involvedObject.name, so
    // over-fetch the namespace's events and filter to this app's objects.
    const evs = await core
      .listNamespacedEvent({ namespace })
      .catch(() => null);
    const events: AppEvent[] = [];
    for (const e of evs?.items ?? []) {
      const kind = e.involvedObject?.kind ?? "";
      const name = e.involvedObject?.name ?? "";
      const relevant =
        podNames.has(name) ||
        (kind === "Deployment" && name === appSlug) ||
        (kind === "ReplicaSet" && name.startsWith(`${appSlug}-`));
      if (!relevant) continue;
      const ts = e.lastTimestamp ?? e.eventTime;
      events.push({
        type: e.type ?? "Normal",
        reason: e.reason ?? "",
        message: e.message ?? "",
        object: `${kind}/${name}`,
        count: e.count ?? 1,
        lastSeen: ts ? new Date(ts).toISOString() : null,
      });
    }
    events.sort((a, b) => {
      const aw = a.type === "Warning" ? 1 : 0;
      const bw = b.type === "Warning" ? 1 : 0;
      if (aw !== bw) return bw - aw;
      return (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");
    });

    return { ok: true, containers, events: events.slice(0, 50) };
  } catch {
    return { ok: false, containers: [], events: [] };
  }
}

export type EffectiveEnv = {
  ok: boolean;
  pod: string | null;
  env: { name: string; value: string; secret: boolean }[];
};

/**
 * The env actually configured on the running pod. Literal values are shown;
 * secret-backed vars (secretKeyRef + envFrom secrets) are surfaced by NAME only,
 * masked — never resolving the secret value (no exec, no leaking the DB URL).
 */
export async function getEffectiveEnv(
  namespace: string,
  appSlug: string,
): Promise<EffectiveEnv> {
  const { core } = k8sClients();
  try {
    const podName = await getAppPodName(namespace, appSlug);
    if (!podName) return { ok: false, pod: null, env: [] };
    const pod = await core.readNamespacedPod({ name: podName, namespace });
    const c =
      pod.spec?.containers?.find((x) => x.name === appSlug) ??
      pod.spec?.containers?.[0];

    const env: EffectiveEnv["env"] = [];
    for (const e of c?.env ?? []) {
      if (e.value != null) {
        env.push({ name: e.name, value: e.value, secret: false });
      } else if (e.valueFrom?.secretKeyRef) {
        const r = e.valueFrom.secretKeyRef;
        env.push({
          name: e.name,
          value: `from secret ${r.name}/${r.key}`,
          secret: true,
        });
      } else {
        env.push({ name: e.name, value: "(from reference)", secret: true });
      }
    }
    // envFrom secrets: keys are injected but not listed in the spec — read names.
    for (const ef of c?.envFrom ?? []) {
      const secName = ef.secretRef?.name;
      if (!secName) continue;
      const sec = await core
        .readNamespacedSecret({ name: secName, namespace })
        .catch(() => null);
      for (const k of Object.keys(sec?.data ?? {})) {
        env.push({ name: k, value: `from secret ${secName}`, secret: true });
      }
    }
    env.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, pod: podName, env };
  } catch {
    return { ok: false, pod: null, env: [] };
  }
}

/** Whether a pod's named container has started (running or already terminated). */
export async function isContainerStarted(
  namespace: string,
  podName: string,
  container: string,
): Promise<boolean> {
  const { core } = k8sClients();
  const pod = await core
    .readNamespacedPod({ name: podName, namespace })
    .catch(() => null);
  const cs = pod?.status?.containerStatuses?.find((c) => c.name === container);
  return !!cs && (!!cs.state?.running || !!cs.state?.terminated);
}
