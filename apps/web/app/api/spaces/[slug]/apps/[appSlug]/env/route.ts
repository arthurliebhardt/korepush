import { getSession } from "@/lib/session";
import { getSpaceBySlug, getEffectiveEnv } from "@korepush/k8s";

export const dynamic = "force-dynamic";

// One-shot: the env actually configured on the running pod (secret-backed vars
// surfaced by name only, masked). Not a stream — fetched on panel open + manual
// refresh. Namespace resolved server-side.
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

  const env = await getEffectiveEnv(space.namespace, appSlug).catch(() => ({
    ok: false,
    pod: null,
    env: [],
  }));
  return Response.json(env);
}
