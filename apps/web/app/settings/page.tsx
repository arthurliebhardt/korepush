import { requireUser } from "@/lib/session";
import { getControlPlaneInfo } from "@korepush/k8s";
import { DomainSettings } from "@/components/domain-settings";
import { AppShell } from "@/components/app-shell";
import { getAppConfig } from "@/lib/github/config";
import { syncInstallations, appsUsingInstallation, installUrl } from "@/lib/github/app";
import { GithubAccounts, type GithubAccount } from "@/components/github-accounts";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireUser();

  let hosts: string[] = [];
  let unavailable: string | null = null;
  try {
    ({ hosts } = await getControlPlaneInfo());
  } catch {
    unavailable =
      "Control-plane settings are only available on an in-cluster install " +
      "(the korepush-system resources aren't reachable from this dev server).";
  }

  // Reconcile connected accounts straight from GitHub (authoritative) so the
  // panel is correct even if the 'installation' webhook never reached us.
  const ghApp = await getAppConfig().catch(() => null);
  const accounts: GithubAccount[] = ghApp
    ? await Promise.all(
        (await syncInstallations().catch(() => [])).map(async (a) => ({
          ...a,
          appCount: await appsUsingInstallation(a.installationId).catch(() => 0),
        })),
      )
    : [];

  return (
    <AppShell
      email={session.user.email}
      userId={session.user.id}
      isAdmin={(session.user as { role?: string }).role === "admin"}
      crumbs={[{ label: "Settings" }]}
    >
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          Domain, GitHub &amp; access for this instance.
        </p>
      </div>

      {/* ── GitHub ── */}
      <div className="mb-8 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted">GitHub accounts</h2>
          {ghApp && (
            <a className="text-xs text-muted hover:text-foreground" href="/api/github/manifest">
              Reconnect a different app
            </a>
          )}
        </div>
        {ghApp ? (
          <GithubAccounts
            slug={ghApp.slug}
            appHtmlUrl={ghApp.htmlUrl}
            installUrl={installUrl(ghApp.slug)}
            accounts={accounts}
          />
        ) : (
          <div className="card space-y-3">
            <p className="text-sm text-muted">
              Connect a GitHub App to deploy from repos and auto-deploy on push.
              One click creates the app on your account, then you can add more
              accounts and organizations.
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
      </main>
    </AppShell>
  );
}
