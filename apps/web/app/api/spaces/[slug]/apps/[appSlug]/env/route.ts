import { authorizeSpaceRequest } from "@/lib/session";
import { getEffectiveEnv } from "@korepush/k8s";

export const dynamic = "force-dynamic";

// One-shot: the env actually configured on the running pod (secret-backed vars
// surfaced by name only, masked). Not a stream — fetched on panel open + manual
// refresh. Namespace resolved server-side.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; appSlug: string }> },
) {
  const { slug, appSlug } = await params;
  const auth = await authorizeSpaceRequest(slug);
  if (auth instanceof Response) return auth;
  const { space } = auth;

  const env = await getEffectiveEnv(space.namespace, appSlug).catch(() => ({
    ok: false,
    pod: null,
    env: [],
  }));
  return Response.json(env);
}
