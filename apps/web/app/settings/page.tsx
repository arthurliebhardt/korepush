import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getControlPlaneInfo } from "@korepush/k8s";
import { DomainSettings } from "@/components/domain-settings";
import { getAppConfig } from "@/lib/github/config";
import { listInstallations } from "@/lib/github/app";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireUser();

  let hosts: string[] = [];
  let unavailable: string | null = null;
  try {
    ({ hosts } = await getControlPlaneInfo());
  } catch {
    unavailable =
      "Control-plane settings are only available on an in-cluster install " +
      "(the korepush-system resources aren't reachable from this dev server).";
  }

  const ghApp = await getAppConfig().catch(() => null);
  const installations = ghApp ? await listInstallations().catch(() => []) : [];

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Spaces
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          Domain, GitHub &amp; access for this instance.
        </p>
      </div>

      {/* ── GitHub ── */}
      <div className="mb-8 space-y-3">
        <h2 className="text-sm font-medium text-muted">GitHub</h2>
        {ghApp ? (
          <div className="card space-y-3">
            <p className="text-sm">
              Connected as{" "}
              <a
                href={ghApp.htmlUrl ?? "#"}
                className="font-mono text-foreground underline"
              >
                {ghApp.slug}
              </a>
            </p>
            <div className="text-sm text-muted">
              Installations:{" "}
              {installations.length === 0 ? (
                <span>none yet — install the app to connect repos.</span>
              ) : (
                <span className="text-foreground">
                  {installations.map((i) => i.accountLogin).join(", ")}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <a
                className="btn-ghost"
                href={`https://github.com/apps/${ghApp.slug}/installations/new`}
              >
                Install on a repo/org
              </a>
              <a className="btn-ghost" href="/api/github/manifest">
                Reconnect
              </a>
            </div>
            <p className="text-xs text-muted">
              Pushes to connected repos auto-deploy matching apps. Private repos
              are cloned with a short-lived installation token.
            </p>
          </div>
        ) : (
          <div className="card space-y-3">
            <p className="text-sm text-muted">
              Connect a GitHub App to deploy from repos and auto-deploy on push.
              One click creates the app on your account — no manual setup.
            </p>
            <a className="btn-primary w-fit" href="/api/github/manifest">
              Connect GitHub
            </a>
          </div>
        )}
      </div>

      {/* ── Domain ── */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Domain</h2>
        {unavailable ? (
          <div className="card text-sm text-muted">{unavailable}</div>
        ) : (
          <DomainSettings hosts={hosts} />
        )}
      </div>
    </div>
  );
}
