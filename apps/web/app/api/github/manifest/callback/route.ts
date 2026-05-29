import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { saveAppConfig } from "@/lib/github/config";
import { resetGithubApp } from "@/lib/github/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const cookieState = jar.get("gh_manifest_state")?.value;
  // The state cookie was set behind the admin gate in /manifest, and is the
  // CSRF proof for this GitHub redirect. (A session can't be reliably required
  // here — cookies may differ across the cross-site redirect.)
  if (!code || !state || !cookieState || state !== cookieState) {
    return new Response("Invalid or expired state", { status: 400 });
  }
  jar.delete("gh_manifest_state");

  // Exchange the temporary code for the new App's credentials (no auth needed).
  const res = await fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    return new Response(`GitHub App creation failed (${res.status})`, {
      status: 502,
    });
  }
  const data = (await res.json()) as {
    id: number;
    slug: string;
    pem: string;
    webhook_secret: string;
    client_id?: string;
    client_secret?: string;
    html_url?: string;
  };

  await saveAppConfig({
    appId: String(data.id),
    slug: data.slug,
    privateKey: data.pem,
    webhookSecret: data.webhook_secret,
    clientId: data.client_id ?? null,
    clientSecret: data.client_secret ?? null,
    htmlUrl: data.html_url ?? null,
  });
  resetGithubApp();

  // Send the user to install the freshly-created app on their account/org.
  redirect(`https://github.com/apps/${data.slug}/installations/new`);
}
