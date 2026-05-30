import {
  KubeConfig,
  CustomObjectsApi,
  makeInformer,
  type ListPromise,
  type KubernetesListObject,
} from "@kubernetes/client-node";
import { GROUP, VERSION, PLURAL, type KoreApp } from "./types";
import { reconcile } from "./reconcile";

const kc = new KubeConfig();
if (process.env.KUBERNETES_SERVICE_HOST) kc.loadFromCluster();
else kc.loadFromDefault();
const custom = kc.makeApiClient(CustomObjectsApi);

const path = `/apis/${GROUP}/${VERSION}/${PLURAL}`;
const listFn = (() =>
  custom.listClusterCustomObject({
    group: GROUP,
    version: VERSION,
    plural: PLURAL,
  })) as unknown as ListPromise<KoreApp>;

// Level-triggered work queue: events enqueue a namespace/name KEY; the worker
// re-reads the live CR in reconcile(). Serialized (one at a time) — which also
// serializes the shared-Gateway 409 contention. Retry with a fixed backoff.
const dirty = new Set<string>();
let draining = false;

function enqueue(obj: KoreApp) {
  const ns = obj.metadata?.namespace;
  const name = obj.metadata?.name;
  if (ns && name) {
    dirty.add(`${ns}/${name}`);
    void drain();
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (dirty.size) {
      const key = dirty.values().next().value as string;
      dirty.delete(key);
      const [ns, name] = key.split("/");
      try {
        await reconcile(ns, name);
      } catch (e) {
        console.error("[reconcile]", key, e);
        setTimeout(() => {
          dirty.add(key);
          void drain();
        }, 5000);
      }
    }
  } finally {
    draining = false;
  }
}

const informer = makeInformer<KoreApp>(kc, path, listFn);
informer.on("add", enqueue);
informer.on("update", enqueue);
informer.on("delete", enqueue);
// CRITICAL: the informer does NOT auto-restart on a clean close — re-arm it.
informer.on("error", (err: unknown) => {
  console.error("[informer] error; restarting in 5s", err);
  setTimeout(start, 5000);
});

async function start() {
  try {
    await informer.start();
  } catch (e) {
    console.error("[informer] start failed; retrying in 5s", e);
    setTimeout(start, 5000);
  }
}

console.log("[korepush-operator] watching koreapps across all namespaces");
void start();

// Periodic resync: re-enqueue every CR so drift (e.g. a hand-deleted Deployment)
// heals even without an event. Replaces the old in-server poll reconciler.
setInterval(async () => {
  try {
    const list = (await (listFn as () => Promise<KubernetesListObject<KoreApp>>)())
      .items;
    for (const item of list ?? []) enqueue(item);
  } catch (e) {
    console.error("[resync]", e);
  }
}, 90_000);
