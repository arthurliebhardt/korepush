import {
  getGithubApp,
  getInstallationToken,
  recordInstallation,
  removeInstallation,
} from "@/lib/github/app";
import { appsForRepoPush, triggerGitBuild } from "@korepush/k8s";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // RAW body — verify BEFORE parsing (HMAC is over the exact bytes).
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  const app = await getGithubApp();
  if (!app) return new Response("GitHub App not configured", { status: 503 });
  const ok = signature ? await app.webhooks.verify(body, signature) : false;
  if (!ok) return new Response("invalid signature", { status: 401 });

  const event = req.headers.get("x-github-event");
  let payload: GithubPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  try {
    if (event === "installation") {
      const id = String(payload.installation?.id ?? "");
      const account = payload.installation?.account?.login ?? "";
      if (id) {
        if (payload.action === "deleted") await removeInstallation(id);
        else await recordInstallation(id, account);
      }
    } else if (event === "push") {
      await handlePush(payload);
    }
  } catch (err) {
    console.error("[github webhook]", err);
    // Still 200 so GitHub doesn't spam retries for a transient handler error.
  }
  return new Response("ok", { status: 200 });
}

type GithubPayload = {
  action?: string;
  ref?: string;
  installation?: { id?: number; account?: { login?: string } };
  repository?: { full_name?: string };
};

async function handlePush(payload: GithubPayload) {
  const fullName = payload.repository?.full_name;
  const ref = payload.ref ?? "";
  if (!fullName || !ref.startsWith("refs/heads/")) return;
  const branch = ref.slice("refs/heads/".length);

  const matches = await appsForRepoPush(fullName, branch);
  if (matches.length === 0) return;

  const installationId = payload.installation?.id
    ? String(payload.installation.id)
    : null;
  const token = installationId
    ? await getInstallationToken(installationId).catch(() => null)
    : null;

  for (const m of matches) {
    await triggerGitBuild(m.spaceSlug, m.appSlug, "push", token ?? undefined);
  }
}
