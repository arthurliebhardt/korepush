// Per-app / per-space resource metrics, read from the in-cluster Prometheus
// over its HTTP query API (no @kubernetes/client-node needed — it's plain
// service-DNS HTTP, exactly like reaching postgres or the registry). Mirrors
// databases.ts: typed result objects, never throws — returns safe defaults so
// the UI degrades gracefully when Prometheus is still warming up / unreachable.

const PROM_URL =
  process.env.KOREPUSH_PROMETHEUS_URL ??
  "http://prometheus.korepush-monitoring.svc.cluster.local:9090";

export type MetricPoint = { t: number; y: number | null }; // t = ms epoch
export type MetricSeries = { pod: string; points: MetricPoint[] };

export type AppMetrics = {
  ok: boolean; // false when Prometheus is unreachable / has no data yet
  windowSec: number;
  cpu: MetricSeries[]; // cores, per pod (range)
  memory: MetricSeries[]; // working-set bytes, per pod (range)
  netRx: MetricSeries[]; // bytes/sec received, per pod (range)
  netTx: MetricSeries[]; // bytes/sec transmitted, per pod (range)
  restarts: number; // cumulative across pods (instant)
  cpuLimitCores: number | null; // denominator for %-of-limit (null = unlimited)
  memLimitBytes: number | null;
};

export type SpaceMetrics = {
  ok: boolean;
  cpuCores: number;
  memoryBytes: number;
  restarts: number;
  pods: number;
};

type PromData = {
  resultType?: string;
  result?: Array<{
    metric?: Record<string, string>;
    value?: [number, string];
    values?: Array<[number, string]>;
  }>;
};

async function promFetch(
  path: string,
  params: Record<string, string>,
): Promise<PromData | null> {
  let url: URL;
  try {
    url = new URL(path, PROM_URL);
  } catch {
    return null;
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { status?: string; data?: PromData };
    if (json.status !== "success") return null;
    return json.data ?? null;
  } catch {
    return null;
  }
}

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function instantScalar(expr: string): Promise<number | null> {
  const data = await promFetch("/api/v1/query", { query: expr });
  return num(data?.result?.[0]?.value?.[1]);
}

async function rangeSeries(
  expr: string,
  start: number,
  end: number,
  step: number,
): Promise<MetricSeries[]> {
  const data = await promFetch("/api/v1/query_range", {
    query: expr,
    start: String(start),
    end: String(end),
    step: String(step),
  });
  if (!data?.result) return [];
  return data.result.map((s) => ({
    pod: s.metric?.pod ?? "pod",
    points: (s.values ?? []).map(([t, v]) => ({ t: t * 1000, y: num(v) })),
  }));
}

/** Step (s) that keeps a window under ~maxPoints, rounded to the scrape interval. */
function pickStep(windowSec: number, maxPoints = 180, scrape = 30): number {
  const raw = Math.ceil(windowSec / maxPoints);
  return Math.max(scrape, Math.ceil(raw / scrape) * scrape);
}

// A Deployment names its pods <slug>-<rs-hash>-<pod-hash> — two trailing
// non-dash segments. Anchored Prometheus regex on those segments matches an
// app's pods without colliding with a sibling whose slug shares the prefix
// (e.g. querying "node" must not match "node-api-…").
function podRe(slug: string): string {
  return `${slug}-[^-]+-[^-]+`;
}

/** Quick Prometheus connectivity probe (mirrors clusterReachable()). */
export async function prometheusReachable(): Promise<boolean> {
  const data = await promFetch("/api/v1/query", { query: "vector(1)" });
  return (data?.result?.length ?? 0) > 0;
}

export async function getAppMetrics(
  namespace: string,
  slug: string,
  windowSec = 1800,
): Promise<AppMetrics> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - windowSec;
  const step = pickStep(windowSec);
  const re = podRe(slug);
  // cAdvisor container metrics carry a `container` label (drop the pod-cgroup
  // and pause container with container!=""); network metrics are per-pod only.
  const cad = `namespace="${namespace}",pod=~"${re}",container!=""`;
  const net = `namespace="${namespace}",pod=~"${re}"`;
  const all = `namespace="${namespace}",pod=~"${re}"`;

  const [cpu, memory, netRx, netTx, restarts, cpuLimit, memLimit] =
    await Promise.all([
      rangeSeries(
        `sum by (pod) (rate(container_cpu_usage_seconds_total{${cad}}[5m]))`,
        start,
        end,
        step,
      ),
      rangeSeries(
        `sum by (pod) (container_memory_working_set_bytes{${cad}})`,
        start,
        end,
        step,
      ),
      rangeSeries(
        `sum by (pod) (rate(container_network_receive_bytes_total{${net}}[5m]))`,
        start,
        end,
        step,
      ),
      rangeSeries(
        `sum by (pod) (rate(container_network_transmit_bytes_total{${net}}[5m]))`,
        start,
        end,
        step,
      ),
      instantScalar(`sum(kube_pod_container_status_restarts_total{${all}})`),
      instantScalar(
        `sum(kube_pod_container_resource_limits{${all},resource="cpu"})`,
      ),
      instantScalar(
        `sum(kube_pod_container_resource_limits{${all},resource="memory"})`,
      ),
    ]);

  const ok = cpu.length > 0 || memory.length > 0 || restarts !== null;
  return {
    ok,
    windowSec,
    cpu,
    memory,
    netRx,
    netTx,
    restarts: restarts ?? 0,
    // 0 limit means "no limit set" → render as unlimited, not 0%.
    cpuLimitCores: cpuLimit && cpuLimit > 0 ? cpuLimit : null,
    memLimitBytes: memLimit && memLimit > 0 ? memLimit : null,
  };
}

export type SpaceMetricsSeries = {
  ok: boolean;
  windowSec: number;
  cpu: MetricPoint[]; // summed cores across the namespace (range)
  memory: MetricPoint[]; // summed working-set bytes across the namespace (range)
  cpuNow: number | null;
  memNow: number | null;
  pods: number;
  restarts: number;
};

export type PodUsage = {
  pod: string;
  cpu: number | null; // cores (instant)
  mem: number | null; // bytes (instant)
  restarts: number;
};

/** Range query yielding a single (no `by`) series → a flat point list. */
async function rangeScalar(
  expr: string,
  start: number,
  end: number,
  step: number,
): Promise<MetricPoint[]> {
  const data = await promFetch("/api/v1/query_range", {
    query: expr,
    start: String(start),
    end: String(end),
    step: String(step),
  });
  const vals = data?.result?.[0]?.values ?? [];
  return vals.map(([t, v]) => ({ t: t * 1000, y: num(v) }));
}

async function instantByPod(
  expr: string,
): Promise<Record<string, number | null>> {
  const data = await promFetch("/api/v1/query", { query: expr });
  const out: Record<string, number | null> = {};
  for (const r of data?.result ?? []) {
    const pod = r.metric?.pod;
    if (pod) out[pod] = num(r.value?.[1]);
  }
  return out;
}

function lastDefined(points: MetricPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].y != null) return points[i].y;
  }
  return null;
}

/** Space-wide CPU + memory TREND (range) for the overview's charts. */
export async function getSpaceMetricsSeries(
  namespace: string,
  windowSec = 3600,
): Promise<SpaceMetricsSeries> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - windowSec;
  const step = pickStep(windowSec);
  const f = `namespace="${namespace}",container!=""`;
  const [cpu, memory, restarts, pods] = await Promise.all([
    rangeScalar(
      `sum(rate(container_cpu_usage_seconds_total{${f}}[5m]))`,
      start,
      end,
      step,
    ),
    rangeScalar(`sum(container_memory_working_set_bytes{${f}})`, start, end, step),
    instantScalar(
      `sum(kube_pod_container_status_restarts_total{namespace="${namespace}"})`,
    ),
    instantScalar(
      `count(count by (pod) (container_memory_working_set_bytes{${f}}))`,
    ),
  ]);
  return {
    ok: cpu.length > 0 || memory.length > 0,
    windowSec,
    cpu,
    memory,
    cpuNow: lastDefined(cpu),
    memNow: lastDefined(memory),
    pods: pods ?? 0,
    restarts: restarts ?? 0,
  };
}

/** Per-pod instant CPU / memory / restarts — the page maps pods to apps. */
export async function getSpaceWorkloadBreakdown(
  namespace: string,
): Promise<PodUsage[]> {
  const f = `namespace="${namespace}",container!=""`;
  const [cpu, mem, restarts] = await Promise.all([
    instantByPod(`sum by (pod) (rate(container_cpu_usage_seconds_total{${f}}[5m]))`),
    instantByPod(`sum by (pod) (container_memory_working_set_bytes{${f}})`),
    instantByPod(
      `sum by (pod) (kube_pod_container_status_restarts_total{namespace="${namespace}"})`,
    ),
  ]);
  const pods = new Set([...Object.keys(cpu), ...Object.keys(mem)]);
  return [...pods].map((pod) => ({
    pod,
    cpu: cpu[pod] ?? null,
    mem: mem[pod] ?? null,
    restarts: restarts[pod] ?? 0,
  }));
}

/** Aggregate live usage across every workload pod in a space's namespace. */
export async function getSpaceMetrics(
  namespace: string,
): Promise<SpaceMetrics> {
  const f = `namespace="${namespace}",container!=""`;
  const [cpu, mem, restarts, pods] = await Promise.all([
    instantScalar(
      `sum(rate(container_cpu_usage_seconds_total{${f}}[5m]))`,
    ),
    instantScalar(`sum(container_memory_working_set_bytes{${f}})`),
    instantScalar(
      `sum(kube_pod_container_status_restarts_total{namespace="${namespace}"})`,
    ),
    instantScalar(
      `count(count by (pod) (container_memory_working_set_bytes{${f}}))`,
    ),
  ]);
  return {
    ok: cpu !== null || mem !== null,
    cpuCores: cpu ?? 0,
    memoryBytes: mem ?? 0,
    restarts: restarts ?? 0,
    pods: pods ?? 0,
  };
}
