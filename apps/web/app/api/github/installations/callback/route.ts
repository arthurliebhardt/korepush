import { redirect } from "next/navigation";
import { syncInstallations } from "@/lib/github/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GitHub's post-install "Setup URL" return. After a user installs (or updates)
 * the korepush GitHub App on an account/org, GitHub sends them here with
 * ?installation_id=…&setup_action=install. We reconcile the connected accounts
 * straight from GitHub (authoritative — independent of webhook delivery) and
 * drop them back on Settings.
 */
export async function GET() {
  await syncInstallations().catch(() => {});
  redirect("/settings?github=connected");
}
