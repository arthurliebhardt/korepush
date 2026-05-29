import { PassThrough } from "node:stream";
import { getSession } from "@/lib/session";
import {
  getSpaceBySlug,
  getApp,
  getBuildPodName,
  buildJobName,
  finalizeBuild,
  streamPodLogs,
  BUILD_NS,
} from "@korepush/k8s";

export const dynamic = "force-dynamic";

function sse(event: string, data: string) {
  return `event: ${event}\ndata: ${data}\n\n`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{ slug: string; appSlug: string; deploymentId: string }>;
  },
) {
  if (!(await getSession())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { slug, appSlug, deploymentId } = await params;
  const space = await getSpaceBySlug(slug);
  if (!space) return new Response("Not found", { status: 404 });
  const app = await getApp(space.id, appSlug);
  if (!app) return new Response("Not found", { status: 404 });

  const jobName = buildJobName(appSlug, deploymentId.slice(0, 8));
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {}
      };
      const finalizeAndClose = async () => {
        const status = await finalizeBuild(deploymentId).catch(() => "unknown");
        send("done", status);
        try {
          controller.close();
        } catch {}
      };

      send("status", "Starting build…");
      let pod: string | null = null;
      for (let i = 0; i < 60 && !pod; i++) {
        pod = await getBuildPodName(jobName);
        if (!pod) await sleep(2000);
      }
      if (!pod) {
        send("status", "Build pod did not start in time.");
        await finalizeAndClose();
        return;
      }
      send("status", `Building in ${pod}`);

      const pt = new PassThrough();
      pt.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString("utf8").split("\n")) {
          if (line.length) send("log", line);
        }
      });
      pt.on("end", () => void finalizeAndClose());

      try {
        const ac = await streamPodLogs(BUILD_NS, pod, pt, {
          follow: true,
          tailLines: 1000,
        });
        cleanup = () => {
          ac.abort();
          pt.destroy();
        };
      } catch {
        await finalizeAndClose();
      }
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
