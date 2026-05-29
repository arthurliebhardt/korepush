import { getSession } from "@/lib/session";
import { getSpaceBySlug, getAppMetrics } from "@korepush/k8s";

export const dynamic = "force-dynamic";

// SSE stream of per-app resource metrics. Namespace is resolved from the space
// server-side (never from user input) so Prometheus is never exposed to the
// browser and a user can't query another tenant's namespace. Ticks every 5s —
// the scrape interval is 30s, so faster is wasted.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; appSlug: string }> },
) {
  if (!(await getSession())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { slug, appSlug } = await params;
  const space = await getSpaceBySlug(slug);
  if (!space) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      async function tick() {
        const metrics = await getAppMetrics(space!.namespace, appSlug).catch(
          () => null,
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(metrics ?? { ok: false })}\n\n`,
          ),
        );
      }
      await tick();
      timer = setInterval(tick, 5000);
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
