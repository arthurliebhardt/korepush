import { authorizeSpaceRequest } from "@/lib/session";
import { k8sClients } from "@korepush/k8s";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; appSlug: string }> },
) {
  const { slug, appSlug } = await params;
  const auth = await authorizeSpaceRequest(slug);
  if (auth instanceof Response) return auth;
  const { space } = auth;

  const { apps, core } = k8sClients();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Enqueue can throw once the client has disconnected (the controller is
      // closed); stop ticking instead of leaking an unhandled rejection.
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          if (timer) clearInterval(timer);
        }
      };
      async function tick() {
        try {
          const dep = await apps.readNamespacedDeployment({
            name: appSlug,
            namespace: space.namespace,
          });
          const desired = dep.spec?.replicas ?? 0;
          const ready = dep.status?.readyReplicas ?? 0;

          const pods = await core.listNamespacedPod({
            namespace: space.namespace,
            labelSelector: `app=${appSlug}`,
          });
          const podSummaries = pods.items.map((p) => ({
            name: p.metadata?.name,
            phase: p.status?.phase,
            restarts:
              p.status?.containerStatuses?.reduce(
                (n, c) => n + (c.restartCount ?? 0),
                0,
              ) ?? 0,
          }));

          const phase =
            desired > 0 && ready >= desired
              ? "running"
              : ready > 0
                ? "degraded"
                : "provisioning";

          send(JSON.stringify({ phase, ready, desired, pods: podSummaries }));
        } catch {
          send(JSON.stringify({ phase: "failed" }));
        }
      }

      await tick();
      timer = setInterval(tick, 2000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
