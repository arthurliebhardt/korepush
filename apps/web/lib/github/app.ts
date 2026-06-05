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

/* ──────────────── connected accounts / installations ──────────────── */

export async function recordInstallation(
  installationId: string,
  accountLogin: string,
) {
  await db
    .insert(schema.githubInstallations)
    .values({ installationId, accountLogin })
    .onConflictDoUpdate({
      target: schema.githubInstallations.installationId,
      set: { accountLogin },
    });
}

export async function removeInstallation(installationId: string) {
  await db
    .delete(schema.githubInstallations)
    .where(eq(schema.githubInstallations.installationId, installationId));
}

export async function listInstallations() {
  return db.select().from(schema.githubInstallations);
}

/** The GitHub page where a user installs the app on another account/org. */
export function installUrl(slug: string): string {
  return `https://github.com/apps/${slug}/installations/new`;
}

export type ConnectedAccount = {
  installationId: string;
  accountLogin: string;
  accountType: string; // "User" | "Organization"
  htmlUrl: string | null;
};

/**
 * Authoritative list of connected accounts, reconciled from GitHub
 * (GET /app/installations) — NOT the webhook. Upserts current installations and
 * prunes ones that were uninstalled, so the panel is correct even if the
 * 'installation' webhook never reached us. Falls back to the DB list if GitHub
 * is unreachable (so a transient outage doesn't wipe the view).
 */
export async function syncInstallations(): Promise<ConnectedAccount[]> {
  const app = await getGithubApp();
  if (!app) return [];
  let installs: Array<{
    id: number;
    account?: { login?: string; type?: string; html_url?: string };
  }>;
  try {
    const res = await app.octokit.request("GET /app/installations", { per_page: 100 });
    installs = res.data as typeof installs;
  } catch {
    return (await listInstallations()).map((i) => ({
      installationId: i.installationId,
      accountLogin: i.accountLogin,
      accountType: "",
      htmlUrl: null,
    }));
  }

  const live: ConnectedAccount[] = installs.map((i) => ({
    installationId: String(i.id),
    accountLogin: i.account?.login ?? "",
    accountType: i.account?.type ?? "",
    htmlUrl: i.account?.html_url ?? null,
  }));
  const liveIds = new Set(live.map((l) => l.installationId));

  for (const l of live) {
    await recordInstallation(l.installationId, l.accountLogin).catch(() => {});
  }
  for (const row of await listInstallations()) {
    if (!liveIds.has(row.installationId)) {
      await removeInstallation(row.installationId).catch(() => {});
    }
  }
  return live.sort((a, b) => a.accountLogin.localeCompare(b.accountLogin));
}

/** How many apps deploy from a given installation (warn before disconnecting). */
export async function appsUsingInstallation(installationId: string): Promise<number> {
  const [row] = await db
    .select({ id: schema.githubInstallations.id })
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.installationId, installationId))
    .limit(1);
  if (!row) return 0;
  const apps = await db
    .select({ id: schema.apps.id })
    .from(schema.apps)
    .where(eq(schema.apps.githubInstallationId, row.id));
  return apps.length;
}

/**
 * Disconnect an account: uninstall the app from it on GitHub (so it stops
 * appearing + revokes access), then drop the local row. The apps.* FK is
 * ON DELETE SET NULL, so dependent apps keep running and just lose the link.
 */
export async function disconnectInstallation(installationId: string): Promise<void> {
  const app = await getGithubApp();
  if (app) {
    await app.octokit
      .request("DELETE /app/installations/{installation_id}", {
        installation_id: Number(installationId),
      })
      .catch(() => {}); // tolerate already-uninstalled
  }
  await removeInstallation(installationId);
}

/**
 * All repos accessible across every installation (deduped). Installations are
 * read from GitHub directly (GET /app/installations) rather than the DB, so
 * this works even when the 'installation' webhook can't reach us (e.g. a
 * private/LAN instance). Also syncs installations into the DB so clone-token
 * minting (by repo owner) works.
 */
export async function listAllConnectedRepos(): Promise<InstallationRepo[]> {
  const app = await getGithubApp();
  if (!app) return [];
  let installs: Array<{ id: number; account?: { login?: string } }>;
  try {
    const res = await app.octokit.request("GET /app/installations", {
      per_page: 100,
    });
    installs = res.data as typeof installs;
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const out: InstallationRepo[] = [];
  for (const inst of installs) {
    await recordInstallation(String(inst.id), inst.account?.login ?? "").catch(
      () => {},
    );
    const repos = await listInstallationRepos(inst.id).catch(() => []);
    for (const r of repos) {
      if (!seen.has(r.fullName)) {
        seen.add(r.fullName);
        out.push(r);
      }
    }
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * Parse owner/repo from a GitHub URL, requiring github.com to be the HOST (not
 * merely a substring anywhere in the string). This anchor is the trust boundary
 * that stops a crafted URL like `https://evil.com/github.com/org/repo` from
 * matching an installation — and later receiving its clone token.
 */
function parseRepo(repoUrl: string): { owner: string; repo: string } | null {
  const m = repoUrl
    .trim()
    .match(
      /^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
    );
  return m ? { owner: m[1], repo: m[2] } : null;
}

function ownerOf(repoUrl: string): string | null {
  return parseRepo(repoUrl)?.owner ?? null;
}

/**
 * Canonical `https://github.com/<owner>/<repo>` for storage, or null when `raw`
 * isn't a github.com repo. Callers reject null so the stored repoUrl — which the
 * build script splices a clone token in front of — is always a github.com URL.
 */
export function canonicalRepoUrl(raw: string): string | null {
  const r = parseRepo(raw);
  return r ? `https://github.com/${r.owner}/${r.repo}` : null;
}

/** Octokit scoped to the installation owning `owner`, or null (public repo). */
async function octokitForOwner(owner: string) {
  const app = await getGithubApp();
  if (!app) return null;
  const [inst] = await db
    .select()
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.accountLogin, owner))
    .limit(1);
  if (!inst) return null;
  return app.getInstallationOctokit(Number(inst.installationId));
}

/** Read a file from a GitHub repo (installation-authed if private, else public). */
export async function fetchRepoFile(
  repoUrl: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const r = parseRepo(repoUrl);
  if (!r) return null;
  const decode = (content?: string) =>
    content ? Buffer.from(content, "base64").toString("utf8") : null;

  const octokit = await octokitForOwner(r.owner).catch(() => null);
  if (octokit) {
    try {
      const res = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        { owner: r.owner, repo: r.repo, path, ref },
      );
      return decode((res.data as { content?: string }).content);
    } catch {
      return null; // 404 / not a file
    }
  }
  // No installation → try the public contents API (unauthenticated).
  try {
    const res = await fetch(
      `https://api.github.com/repos/${r.owner}/${r.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "korepush" },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return null;
    return decode(((await res.json()) as { content?: string }).content);
  } catch {
    return null;
  }
}

function validPort(n: number): number | null {
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

/**
 * Best-effort guess at the port a repo's app listens on, for the deploy form.
 * Authoritative signals first (Dockerfile EXPOSE, an explicit port in the
 * package.json start script); otherwise a Node default. Returns null when
 * nothing is found — korepush injects PORT=<port> anyway, so a $PORT-honoring
 * app conforms to whatever the caller defaults to.
 */
export async function detectPort(
  repoUrl: string,
  ref = "main",
): Promise<number | null> {
  const dockerfile = await fetchRepoFile(repoUrl, ref, "Dockerfile");
  if (dockerfile) {
    // First numeric EXPOSE (ignore ${PORT}-style and protocol suffixes).
    const m = dockerfile.match(/^\s*EXPOSE\s+(\d{2,5})/im);
    if (m) {
      const p = validPort(Number(m[1]));
      if (p) return p;
    }
  }
  const pkgRaw = await fetchRepoFile(repoUrl, ref, "package.json");
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      // Explicit port in the start script: -p 8080 / --port=8080 / PORT=8080.
      const start = pkg.scripts?.start ?? "";
      const pm = start.match(/(?:-p|--port|PORT)[\s=]+(\d{2,5})/i);
      if (pm) {
        const p = validPort(Number(pm[1]));
        if (p) return p;
      }
      return 3000; // Node default (Next/Remix/Express/CRA all use 3000)
    } catch {
      // malformed package.json — fall through
    }
  }
  return null;
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
