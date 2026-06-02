import { authorizeSpaceRequest } from "@/lib/session";
import { getAppDiagnostics } from "@korepush/k8s";

export const dynamic = "force-dynamic";

// SSE stream of crash/restart + events diagnostics. 5s cadence (events change
// slowly; /status stays at 2s for the headline badge). Namespace resolved
// server-side, never trusted from the client.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; appSlug: string }> },
) {
  const { slug, appSlug } = await params;
  const auth = await authorizeSpaceRequest(slug);
  if (auth instanceof Response) return auth;
  const { space } = auth;

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          if (timer) clearInterval(timer);
        }
      };
      async function tick() {
        const diag = await getAppDiagnostics(space.namespace, appSlug).catch(
          () => null,
        );
        send(JSON.stringify(diag ?? { ok: false }));
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
