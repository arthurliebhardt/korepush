import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

export async function GET() {
  const session = await getSession();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  // Use the ORIGIN the user is actually on (not BETTER_AUTH_URL), so the
  // GitHub redirect lands back on the same origin and the session + state
  // cookies are present. Otherwise (e.g. accessed via a tunnel) the callback
  // would be cross-origin and the cookies would be missing.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = host
    ? `${proto}://${host}`
    : (process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
  const state = randomBytes(16).toString("hex");
  // GitHub App names are globally unique — give each instance a unique default
  // (the user can still rename it on GitHub's create page). Stored slug comes
  // from the conversion response, so this only sets the requested display name.
  const appName = `korepush-${randomBytes(4).toString("hex")}`;
  (await cookies()).set("gh_manifest_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const manifest = {
    name: appName,
    url: base,
    hook_attributes: { url: `${base}/api/github/webhook`, active: true },
    redirect_url: `${base}/api/github/manifest/callback`,
    // After a user installs the app on an account/org, GitHub returns here so we
    // record the installation immediately (not only via the webhook) and send
    // them back to Settings. setup_on_update re-fires when repo access changes.
    setup_url: `${base}/api/github/installations/callback`,
    setup_on_update: true,
    public: false,
    default_permissions: { contents: "read", metadata: "read" },
    default_events: ["push"],
  };

  // Auto-submitting form POST to GitHub (the manifest create flow). `state`
  // round-trips back to the callback for CSRF protection.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Connecting to GitHub…</title></head>
<body style="font-family:sans-serif;background:#0a0a0a;color:#ededed">
  <p style="padding:2rem">Redirecting to GitHub to create your app…</p>
  <form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
    <input type="hidden" name="manifest" value='${esc(JSON.stringify(manifest))}'>
    <noscript><button type="submit">Create GitHub App</button></noscript>
  </form>
  <script>document.getElementById('f').submit()</script>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
