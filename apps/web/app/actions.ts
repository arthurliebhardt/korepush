"use server";

import { revalidatePath } from "next/cache";
import { requireUser, assertOwnsSpace } from "@/lib/session";
import {
  createSpace,
  deleteSpace,
  createApp,
  listApps,
  listDatabases,
  parseComposePlan,
  deleteApp,
  createGitApp,
  addEnvironment,
  triggerGitBuild,
  setControlPlaneDomain,
  getSpaceBySlug,
  getApp,
  createDatabase,
  getDatabase,
  getDatabaseInfo,
  runUserQuery,
  deleteDatabase,
  attachDatabase,
  detachDatabase,
  setAppEnv,
  rollbackDeployment,
  addAppDomain,
  removeAppDomain,
  refreshAppDomainStatus,
} from "@korepush/k8s";
import {
  mintCloneTokenForRepo,
  detectPort,
  canonicalRepoUrl,
} from "@/lib/github/app";
import { detectProject } from "@/lib/github/detect";
import type { QueryResult } from "@korepush/k8s";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type BuildActionResult =
  | { ok: true; appSlug: string; deploymentId: string }
  | { ok: false; error: string };

export async function createSpaceAction(name: string): Promise<ActionResult> {
  const session = await requireUser();
  try {
    await createSpace(name, session.user.id);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteSpaceAction(slug: string): Promise<ActionResult> {
  await assertOwnsSpace(slug);
  try {
    await deleteSpace(slug);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function createAppAction(input: {
  spaceSlug: string;
  name: string;
  image: string;
  port?: number;
  env?: EnvVarInput[];
  attachDatabaseId?: string;
  cpuLimit?: string;
  memoryLimit?: string;
}): Promise<{ ok: true; appSlug: string } | { ok: false; error: string }> {
  await assertOwnsSpace(input.spaceSlug);
  try {
    const split = input.env?.length ? splitEnvVars(input.env) : null;
    if (split && "error" in split) return { ok: false, error: split.error };
    const app = await createApp({
      spaceSlug: input.spaceSlug,
      name: input.name,
      image: input.image,
      port: input.port,
      cpuLimit: input.cpuLimit || undefined,
      memoryLimit: input.memoryLimit || undefined,
    });
    // Env (incl. secrets stored in a k8s Secret) + DB attach are applied after
    // create; the operator re-reconciles the workload with them.
    if (split) await setAppEnv(input.spaceSlug, app.slug, split);
    if (input.attachDatabaseId) {
      await attachDatabase(
        input.spaceSlug,
        app.slug,
        input.attachDatabaseId,
      ).catch(() => {});
    }
    revalidatePath(`/spaces/${input.spaceSlug}`);
    return { ok: true, appSlug: app.slug };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Parse a docker-compose file into a preview plan (no side effects). */
export async function previewComposeAction(spaceSlug: string, yaml: string) {
  const { space } = await assertOwnsSpace(spaceSlug);
  const plan = parseComposePlan(yaml);
  if (!plan.ok) return { ...plan, collisions: [] as string[] };
  const [apps, dbs] = await Promise.all([
    listApps(space.id),
    listDatabases(space.id),
  ]);
  const existing = new Set<string>([
    ...apps.map((a) => a.slug),
    ...dbs.map((d) => d.slug),
  ]);
  const collisions = [...plan.apps, ...plan.databases]
    .filter((x) => existing.has(x.slug))
    .map((x) => x.slug);
  return { ...plan, collisions };
}

export type ComposeImportResult = {
  service: string;
  kind: "app" | "database";
  status: "created" | "failed";
  slug?: string;
  error?: string;
};

/** Fan a compose file out into apps + Postgres databases (re-parsed server-side). */
export async function importComposeAction(
  spaceSlug: string,
  yaml: string,
): Promise<{ ok: boolean; error?: string; results: ComposeImportResult[] }> {
  await assertOwnsSpace(spaceSlug);
  const plan = parseComposePlan(yaml); // never trust a client-sent plan
  if (!plan.ok) return { ok: false, error: plan.error, results: [] };

  const results: ComposeImportResult[] = [];
  const dbIdByService = new Map<string, string>();

  // Databases first so app attaches have a target.
  for (const db of plan.databases) {
    try {
      const row = await createDatabase({ spaceSlug, name: db.name });
      dbIdByService.set(db.service, row.id);
      results.push({ service: db.service, kind: "database", status: "created", slug: row.slug });
    } catch (err) {
      results.push({ service: db.service, kind: "database", status: "failed", error: errorMessage(err) });
    }
  }

  for (const app of plan.apps) {
    try {
      const split = app.env.length ? splitEnvVars(app.env) : null;
      if (split && "error" in split) {
        results.push({ service: app.service, kind: "app", status: "failed", error: split.error });
        continue;
      }
      const created = await createApp({
        spaceSlug,
        name: app.service,
        image: app.image,
        port: app.port,
        cpuLimit: app.cpuLimit,
        memoryLimit: app.memoryLimit,
      });
      if (split) await setAppEnv(spaceSlug, created.slug, split);
      if (app.attachDatabaseService) {
        const dbId = dbIdByService.get(app.attachDatabaseService);
        if (dbId) await attachDatabase(spaceSlug, created.slug, dbId).catch(() => {});
      }
      results.push({ service: app.service, kind: "app", status: "created", slug: created.slug });
    } catch (err) {
      results.push({ service: app.service, kind: "app", status: "failed", error: errorMessage(err) });
    }
  }

  revalidatePath(`/spaces/${spaceSlug}`);
  return { ok: results.some((r) => r.status === "created"), results };
}

export async function deleteAppAction(
  spaceSlug: string,
  appSlug: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await deleteApp(spaceSlug, appSlug);
    revalidatePath(`/spaces/${spaceSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function detectProjectAction(repoUrl: string, gitRef: string) {
  await requireUser();
  const detection = await detectProject(repoUrl, gitRef || "main").catch(
    () => null,
  );
  return { ok: !!detection, detection };
}

export async function createGitAppAction(input: {
  spaceSlug: string;
  name: string;
  repoUrl: string;
  gitRef?: string;
  port?: number;
  env?: EnvVarInput[];
  installCmd?: string;
  buildCmd?: string;
  startCmd?: string;
  attachDatabaseId?: string;
}): Promise<BuildActionResult> {
  await assertOwnsSpace(input.spaceSlug);
  try {
    // Reject anything that isn't a github.com repo, and store the canonical
    // form — the build script splices a clone token in front of this URL, so it
    // must never point at an attacker-controlled host.
    const repoUrl = canonicalRepoUrl(input.repoUrl);
    if (!repoUrl) {
      return {
        ok: false,
        error: "Enter a valid GitHub repository URL (https://github.com/owner/repo).",
      };
    }
    // Validate env up front so we never leave an orphan app on a bad var.
    const split = input.env?.length ? splitEnvVars(input.env) : null;
    if (split && "error" in split) return { ok: false, error: split.error };

    // No port given → auto-detect from the repo (Dockerfile EXPOSE / start
    // script), falling back to 3000. korepush injects PORT=<port>, so a
    // $PORT-honoring app conforms regardless.
    const port =
      input.port ??
      (await detectPort(repoUrl, input.gitRef ?? "main").catch(() => null)) ??
      3000;
    const app = await createGitApp({
      spaceSlug: input.spaceSlug,
      name: input.name,
      repoUrl,
      gitRef: input.gitRef,
      port,
      installCmd: input.installCmd,
      buildCmd: input.buildCmd,
      startCmd: input.startCmd,
    });
    // Persist env (incl. secrets) before the build; the operator injects them
    // once the build patches spec.image onto the CR.
    if (split) await setAppEnv(input.spaceSlug, app.slug, split);
    // Attach a database BEFORE the first build so its connection string is
    // injected on the very first deploy (avoids a build-then-redeploy cycle).
    if (input.attachDatabaseId) {
      await attachDatabase(
        input.spaceSlug,
        app.slug,
        input.attachDatabaseId,
      ).catch(() => {});
    }
    const token = await mintCloneTokenForRepo(repoUrl).catch(() => null);
    const { deploymentId } = await triggerGitBuild(
      input.spaceSlug,
      app.slug,
      "import",
      token ?? undefined,
    );
    revalidatePath(`/spaces/${input.spaceSlug}`);
    return { ok: true, appSlug: app.slug, deploymentId };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function addEnvironmentAction(input: {
  spaceSlug: string;
  appSlug: string;
  branch: string;
  envName: string;
}): Promise<BuildActionResult> {
  await assertOwnsSpace(input.spaceSlug);
  try {
    const app = await addEnvironment(
      input.spaceSlug,
      input.appSlug,
      input.branch,
      input.envName,
    );
    // Build the new environment from its branch (same path as import).
    const token = app.repoUrl
      ? await mintCloneTokenForRepo(app.repoUrl).catch(() => null)
      : null;
    const { deploymentId } = await triggerGitBuild(
      input.spaceSlug,
      app.slug,
      "import",
      token ?? undefined,
    );
    revalidatePath(`/spaces/${input.spaceSlug}`);
    return { ok: true, appSlug: app.slug, deploymentId };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function redeployAction(
  spaceSlug: string,
  appSlug: string,
): Promise<BuildActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    const space = await getSpaceBySlug(spaceSlug);
    const app = space ? await getApp(space.id, appSlug) : null;
    const token = app?.repoUrl
      ? await mintCloneTokenForRepo(app.repoUrl).catch(() => null)
      : null;
    const { deploymentId } = await triggerGitBuild(
      spaceSlug,
      appSlug,
      "manual",
      token ?? undefined,
    );
    revalidatePath(`/spaces/${spaceSlug}/apps/${appSlug}`);
    return { ok: true, appSlug, deploymentId };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function createDatabaseAction(
  spaceSlug: string,
  name: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await createDatabase({ spaceSlug, name });
    revalidatePath(`/spaces/${spaceSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// Per-database in-flight guard (single control-plane replica → in-memory is
// enough) so scripted Run-spam can't open many transient clients at once.
const runningQueries = new Set<string>();

/**
 * Run owner-supplied SQL against a database the caller owns. SECURITY: the
 * connection URI is resolved entirely server-side from the OWNED database row —
 * the action never accepts a URI/host/namespace/id. assertOwnsSpace runs on
 * every call; getDatabase binds dbSlug to that owned space. See runUserQuery for
 * the execution hardening (extended protocol, timeouts, row cap).
 */
export async function runDatabaseQueryAction(
  spaceSlug: string,
  dbSlug: string,
  sql: string,
): Promise<QueryResult> {
  let key: string | null = null;
  try {
    const { space } = await assertOwnsSpace(spaceSlug);
    const row = await getDatabase(space.id, dbSlug);
    if (!row) return { ok: false, error: "Database not found." };
    key = `${space.id}:${row.slug}`;
    if (runningQueries.has(key)) {
      return { ok: false, error: "A query is already running on this database." };
    }
    runningQueries.add(key);
    const info = await getDatabaseInfo(space.namespace, row.slug);
    if (!info.connectionUri) {
      return { ok: false, error: "Database is still provisioning." };
    }
    const res = await runUserQuery(info.connectionUri, sql);
    console.log(
      `[db-console] ${space.slug}/${row.slug} ${res.ok ? `rows=${res.rowCount}${res.truncated ? "+" : ""} ${res.durationMs}ms` : "error"}`,
    );
    return res;
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  } finally {
    if (key) runningQueries.delete(key);
  }
}

export async function deleteDatabaseAction(
  spaceSlug: string,
  slug: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await deleteDatabase(spaceSlug, slug);
    revalidatePath(`/spaces/${spaceSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function attachDatabaseAction(
  spaceSlug: string,
  appSlug: string,
  databaseId: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await attachDatabase(spaceSlug, appSlug, databaseId);
    revalidatePath(`/spaces/${spaceSlug}/apps/${appSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function detachDatabaseAction(
  spaceSlug: string,
  appSlug: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await detachDatabase(spaceSlug, appSlug);
    revalidatePath(`/spaces/${spaceSlug}/apps/${appSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function rollbackAction(
  spaceSlug: string,
  appSlug: string,
  deploymentId: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await rollbackDeployment(spaceSlug, appSlug, deploymentId);
    revalidatePath(`/spaces/${spaceSlug}/apps/${appSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export type EnvVarInput = { key: string; value: string; secret: boolean };

/** Validate + split env rows into plain/secret maps, or return an error. */
function splitEnvVars(
  vars: EnvVarInput[],
):
  | { plain: Record<string, string>; secrets: Record<string, string> }
  | { error: string } {
  const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const plain: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const seen = new Set<string>();
  for (const v of vars) {
    const key = v.key.trim();
    if (!key) continue;
    if (!KEY_RE.test(key)) return { error: `Invalid variable name: "${key}"` };
    if (key === "PORT") return { error: "PORT is managed by korepush." };
    if (seen.has(key)) return { error: `Duplicate variable: ${key}` };
    seen.add(key);
    if (v.secret) secrets[key] = v.value;
    else plain[key] = v.value;
  }
  return { plain, secrets };
}

export async function setAppEnvAction(
  spaceSlug: string,
  appSlug: string,
  vars: EnvVarInput[],
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  const split = splitEnvVars(vars);
  if ("error" in split) return { ok: false, error: split.error };
  try {
    await setAppEnv(spaceSlug, appSlug, split);
    revalidatePath(`/spaces/${spaceSlug}/apps/${appSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function addAppDomainAction(
  spaceSlug: string,
  appSlug: string,
  host: string,
  useStaging = false,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await addAppDomain(spaceSlug, appSlug, host, useStaging);
    revalidatePath(`/spaces/${spaceSlug}/apps/${appSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function removeAppDomainAction(
  spaceSlug: string,
  appSlug: string,
  host: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await removeAppDomain(spaceSlug, appSlug, host);
    revalidatePath(`/spaces/${spaceSlug}/apps/${appSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export type AppDomainView = {
  host: string;
  status: string;
  statusMessage: string | null;
  useStaging: boolean;
};

export async function refreshAppDomainsAction(
  spaceSlug: string,
  appSlug: string,
): Promise<AppDomainView[]> {
  await assertOwnsSpace(spaceSlug);
  const rows = await refreshAppDomainStatus(spaceSlug, appSlug).catch(() => []);
  return rows.map((d) => ({
    host: d.host,
    status: d.status,
    statusMessage: d.statusMessage,
    useStaging: d.useStaging,
  }));
}

export async function setDomainAction(
  domain: string,
  useStaging = false,
): Promise<ActionResult> {
  const session = await requireUser();
  if ((session.user as { role?: string }).role !== "admin") {
    return { ok: false, error: "Only an admin can change the domain." };
  }
  try {
    await setControlPlaneDomain(domain, {
      email: session.user.email,
      useStaging,
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}
