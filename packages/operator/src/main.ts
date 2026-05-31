import {
  KubeConfig,
  CustomObjectsApi,
  makeInformer,
  type ListPromise,
  type KubernetesListObject,
  type KubernetesObject,
} from "@kubernetes/client-node";
import { GROUP, VERSION, PLURAL, KORESPACES } from "./types";
import { reconcile } from "./reconcile";
import { reconcileSpace } from "./reconcile-space";

const kc = new KubeConfig();
if (process.env.KUBERNETES_SERVICE_HOST) kc.loadFromCluster();
else kc.loadFromDefault();
const custom = kc.makeApiClient(CustomObjectsApi);

// One reconciler per CR kind. All feed a single serialized work queue, which
// also serializes the shared-Gateway 409 contention (KoreApp routing).
type KindDef = {
  plural: string;
  reconcile: (namespace: string, name: string) => Promise<void>;
  listFn: ListPromise<KubernetesObject>;
};
const KINDS: KindDef[] = [
  { plural: PLURAL, reconcile },
  { plural: KORESPACES, reconcile: reconcileSpace },
].map((k) => ({
  ...k,
  // listClusterCustomObject enumerates across all namespaces for namespaced
  // CRDs and the cluster set for cluster-scoped ones — works for both.
  listFn: (() =>
    custom.listClusterCustomObject({
      group: GROUP,
      version: VERSION,
      plural: k.plural,
    })) as unknown as ListPromise<KubernetesObject>,
}));

// Level-triggered work queue: events enqueue a "plural|ns|name" key; the worker
// re-reads the live CR in its reconcile(). Serialized, fixed-backoff retry.
const dirty = new Set<string>();
let draining = false;
const byPlural = new Map(KINDS.map((k) => [k.plural, k.reconcile]));

function enqueue(plural: string, obj: KubernetesObject) {
  const name = obj.metadata?.name;
  if (!name) return;
  dirty.add(`${plural}|${obj.metadata?.namespace ?? ""}|${name}`);
  void drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (dirty.size) {
      const key = dirty.values().next().value as string;
      dirty.delete(key);
      const [plural, ns, name] = key.split("|");
      const fn = byPlural.get(plural);
      if (!fn) continue;
      try {
        await fn(ns, name);
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

function watch(k: KindDef) {
  const path = `/apis/${GROUP}/${VERSION}/${k.plural}`;
  const informer = makeInformer<KubernetesObject>(kc, path, k.listFn);
  informer.on("add", (o) => enqueue(k.plural, o));
  informer.on("update", (o) => enqueue(k.plural, o));
  informer.on("delete", (o) => enqueue(k.plural, o));
  // CRITICAL: the informer does NOT auto-restart on a clean close — re-arm it.
  informer.on("error", (err: unknown) => {
    console.error(`[informer:${k.plural}] error; restarting in 5s`, err);
    setTimeout(() => start(informer, k.plural), 5000);
  });
  return informer;
}

async function start(informer: ReturnType<typeof makeInformer>, plural: string) {
  try {
    await informer.start();
  } catch (e) {
    console.error(`[informer:${plural}] start failed; retrying in 5s`, e);
    setTimeout(() => start(informer, plural), 5000);
  }
}

const informers = KINDS.map((k) => ({ k, informer: watch(k) }));
console.log("[korepush-operator] watching", KINDS.map((k) => k.plural).join(", "));
for (const { k, informer } of informers) void start(informer, k.plural);

// Periodic resync: re-enqueue every CR so drift heals even without an event.
setInterval(async () => {
  for (const k of KINDS) {
    try {
      const list = (await (k.listFn as () => Promise<KubernetesListObject<KubernetesObject>>)())
        .items;
      for (const item of list ?? []) enqueue(k.plural, item);
    } catch (e) {
      console.error("[resync]", k.plural, e);
    }
  }
}, 90_000);
