import { PassThrough } from "node:stream";
import { getSession } from "@/lib/session";
import { getSpaceBySlug, getAppPodName, streamPodLogs } from "@kubepush/k8s";

export const dynamic = "force-dynamic";

function sse(event: string, data: string) {
  return `event: ${event}\ndata: ${data}\n\n`;
}

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
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const pod = await getAppPodName(space.namespace, appSlug);
      if (!pod) {
        controller.enqueue(
          encoder.encode(sse("status", "Waiting for pod to be scheduled…")),
        );
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(sse("status", `Streaming ${pod}`)));

      const pt = new PassThrough();
      pt.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString("utf8").split("\n")) {
          if (line.length) controller.enqueue(encoder.encode(sse("log", line)));
        }
      });
      pt.on("end", () => {
        try {
          controller.close();
        } catch {}
      });

      const ac = await streamPodLogs(space.namespace, pod, pt, {
        follow: true,
        tailLines: 200,
        timestamps: false,
      });

      cleanup = () => {
        ac.abort();
        pt.destroy();
      };
    },
    cancel() {
      cleanup?.();
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
