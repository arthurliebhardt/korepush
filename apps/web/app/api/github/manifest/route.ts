import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
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

  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("gh_manifest_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const manifest = {
    name: "korepush",
    url: base,
    hook_attributes: { url: `${base}/api/github/webhook`, active: true },
    redirect_url: `${base}/api/github/manifest/callback`,
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
