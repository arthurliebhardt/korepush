import { App } from "@octokit/app";
import { eq } from "drizzle-orm";
import { db, schema } from "@korepush/db";
import { getAppConfig } from "./config";

let cached: { appId: string; app: App } | null = null;

/** The platform's GitHub App client, or null if not connected yet. */
export async function getGithubApp(): Promise<App | null> {
  const cfg = await getAppConfig();
  if (!cfg) return null;
  if (cached?.appId === cfg.appId) return cached.app;
  const app = new App({
    appId: cfg.appId,
    privateKey: cfg.privateKey,
    webhooks: { secret: cfg.webhookSecret },
  });
  cached = { appId: cfg.appId, app };
  return app;
}

/** Reset the cached App (call after (re)connecting). */
export function resetGithubApp() {
  cached = null;
}

/** Short-lived (~1h) installation token, for cloning private repos. */
export async function getInstallationToken(
  installationId: string | number,
): Promise<string | null> {
  const app = await getGithubApp();
  if (!app) return null;
  const auth = (await app.octokit.auth({
    type: "installation",
    installationId: Number(installationId),
  })) as { token: string };
  return auth.token;
}

export type InstallationRepo = {
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
};

export async function listInstallationRepos(
  installationId: string | number,
): Promise<InstallationRepo[]> {
  const app = await getGithubApp();
  if (!app) return [];
  const octokit = await app.getInstallationOctokit(Number(installationId));
  const res = await octokit.request("GET /installation/repositories", {
    per_page: 100,
  });
  const repos = (
    res.data as {
      repositories: Array<{
        full_name: string;
        clone_url: string;
        default_branch: string;
        private: boolean;
      }>;
    }
  ).repositories;
  return repos.map((r) => ({
    fullName: r.full_name,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch,
    private: r.private,
  }));
}

/* ──────────────── installations (from the 'installation' webhook) ──────────────── */

export async function recordInstallation(
  installationId: string,
  accountLogin: string,
) {
  await db
    .insert(schema.githubInstallations)
    .values({ installationId, accountLogin })
    .onConflictDoNothing();
}

export async function removeInstallation(installationId: string) {
  await db
    .delete(schema.githubInstallations)
    .where(eq(schema.githubInstallations.installationId, installationId));
}

export async function listInstallations() {
  return db.select().from(schema.githubInstallations);
}

function ownerOf(repoUrl: string): string | null {
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/[^/]+/i);
  return m ? m[1] : null;
}

/**
 * Mint a clone token for a repo by matching its owner to an installation.
 * Returns null for public repos with no installation (clone works without auth).
 */
export async function mintCloneTokenForRepo(
  repoUrl: string,
): Promise<string | null> {
  const owner = ownerOf(repoUrl);
  if (!owner) return null;
  const [inst] = await db
    .select()
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.accountLogin, owner))
    .limit(1);
  if (!inst) return null;
  return getInstallationToken(inst.installationId).catch(() => null);
}
