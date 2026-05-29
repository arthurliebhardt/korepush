import { getSession } from "@/lib/session";
import { getSpaceBySlug, getAppDiagnostics } from "@korepush/k8s";

export const dynamic = "force-dynamic";

// SSE stream of crash/restart + events diagnostics. 5s cadence (events change
// slowly; /status stays at 2s for the headline badge). Namespace resolved
// server-side, never trusted from the client.
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
        const diag = await getAppDiagnostics(space!.namespace, appSlug).catch(
          () => null,
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(diag ?? { ok: false })}\n\n`),
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
