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
  deleteDatabase,
  attachDatabase,
  detachDatabase,
  setAppEnv,
  setAppVolumes,
  rollbackDeployment,
  addAppDomain,
  removeAppDomain,
  refreshAppDomainStatus,
  setRegistryCredential,
  removeRegistryCredential,
  createStack,
  getStack,
  deleteStack,
  listStackMembers,
  computeStackDiff,
  setStackSourceYaml,
  updateApp,
  slugify,
} from "@korepush/k8s";
import type { VolumeSpec, StackDiff, AppUpdatePlan } from "@korepush/k8s";
import {
  mintCloneTokenForRepo,
  detectPort,
  canonicalRepoUrl,
  disconnectInstallation,
} from "@/lib/github/app";
import { detectProject } from "@/lib/github/detect";

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

// Server-side authoritative validation of persistent-volume rows (the CRD
// enforces the same shape, but reject early with a friendly message). Returns an
// error string, or the cleaned list.
const VOL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const VOL_SIZE_RE = /^[0-9]+(Ki|Mi|Gi|Ti)$/;
function validateVolumes(
  volumes: VolumeSpec[] | undefined,
): { error: string } | { volumes: VolumeSpec[] } {
  const clean = (volumes ?? [])
    .map((v) => ({ name: v.name?.trim(), mountPath: v.mountPath?.trim(), size: (v.size?.trim() || "1Gi") }))
    .filter((v) => v.name || v.mountPath);
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const v of clean) {
    if (!VOL_NAME_RE.test(v.name) || v.name.length > 40) {
      return { error: `Volume name "${v.name}" must be lowercase letters, digits and dashes (≤40 chars).` };
    }
    if (!v.mountPath.startsWith("/") || v.mountPath.length > 256) {
      return { error: `Mount path "${v.mountPath}" must be an absolute path.` };
    }
    if (!VOL_SIZE_RE.test(v.size)) {
      return { error: `Volume size "${v.size}" must be a whole number with a unit, e.g. 1Gi.` };
    }
    if (names.has(v.name)) return { error: `Duplicate volume name "${v.name}".` };
    if (paths.has(v.mountPath)) return { error: `Duplicate mount path "${v.mountPath}".` };
    names.add(v.name);
    paths.add(v.mountPath);
  }
  return { volumes: clean };
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
  volumes?: VolumeSpec[];
}): Promise<{ ok: true; appSlug: string } | { ok: false; error: string }> {
  await assertOwnsSpace(input.spaceSlug);
  try {
    const split = input.env?.length ? splitEnvVars(input.env) : null;
    if (split && "error" in split) return { ok: false, error: split.error };
    const vres = validateVolumes(input.volumes);
    if ("error" in vres) return { ok: false, error: vres.error };
    const app = await createApp({
      spaceSlug: input.spaceSlug,
      name: input.name,
      image: input.image,
      port: input.port,
      cpuLimit: input.cpuLimit || undefined,
      memoryLimit: input.memoryLimit || undefined,
      volumes: vres.volumes.length ? vres.volumes : undefined,
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
export async function previewComposeAction(
  spaceSlug: string,
  yaml: string,
  stackName = "",
) {
  const { space } = await assertOwnsSpace(spaceSlug);
  const plan = parseComposePlan(yaml);
  if (!plan.ok) {
    return { ...plan, collisions: [] as string[], stackCollision: false };
  }
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
  const stackSlug = slugify(stackName);
  const stackCollision = !!stackSlug && !!(await getStack(space.id, stackSlug));
  return { ...plan, collisions, stackCollision };
}

export type ComposeImportResult = {
  service: string;
  kind: "app" | "database";
  status: "created" | "updated" | "removed" | "failed";
  slug?: string;
  error?: string;
};

/** Fan a compose file out into one named stack of apps + databases (re-parsed
 *  server-side). Aborts up front on a member-slug or stack-name collision so a
 *  doomed import never leaves a half-built or empty stack behind. */
export async function importComposeAction(
  spaceSlug: string,
  yaml: string,
  stackName: string,
): Promise<{
  ok: boolean;
  error?: string;
  results: ComposeImportResult[];
  stackSlug?: string;
  stackName?: string;
}> {
  const { space } = await assertOwnsSpace(spaceSlug);
  const plan = parseComposePlan(yaml); // never trust a client-sent plan
  if (!plan.ok) return { ok: false, error: plan.error, results: [] };
  if (!stackName.trim()) {
    return { ok: false, error: "Enter a name for this stack.", results: [] };
  }

  // Abort BEFORE creating the stack row if any member slug collides — otherwise
  // a fully-colliding import would create an orphan empty stack.
  const [existingApps, existingDbs] = await Promise.all([
    listApps(space.id),
    listDatabases(space.id),
  ]);
  const taken = new Set<string>([
    ...existingApps.map((a) => a.slug),
    ...existingDbs.map((d) => d.slug),
  ]);
  const colliding = [...plan.apps, ...plan.databases]
    .filter((x) => taken.has(x.slug))
    .map((x) => x.slug);
  if (colliding.length > 0) {
    return {
      ok: false,
      error: `Already exists in this space: ${colliding.join(", ")} — rename those services and import again.`,
      results: [],
    };
  }

  // Create the stack first; thread its id into every member.
  let stack;
  try {
    stack = await createStack(spaceSlug, stackName.trim());
  } catch (err) {
    return { ok: false, error: errorMessage(err), results: [] };
  }

  const results: ComposeImportResult[] = [];
  const dbIdByService = new Map<string, string>();

  // Databases first so app attaches have a target.
  for (const db of plan.databases) {
    try {
      const row = await createDatabase({ spaceSlug, name: db.name, engine: db.engine, stackId: stack.id });
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
        command: app.command,
        args: app.args,
        healthcheck: app.healthcheck,
        volumes: app.volumes,
        stackId: stack.id,
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

  // If nothing was created, drop the empty stack row so it doesn't linger.
  const created = results.some((r) => r.status === "created");
  if (!created) {
    await deleteStack(spaceSlug, stack.slug).catch(() => {});
    revalidatePath(`/spaces/${spaceSlug}`);
    return { ok: false, error: "No services could be imported.", results };
  }

  await setStackSourceYaml(spaceSlug, stack.slug, yaml).catch(() => {});
  revalidatePath(`/spaces/${spaceSlug}`);
  revalidatePath(`/spaces/${spaceSlug}/stacks`);
  return { ok: true, results, stackSlug: stack.slug, stackName: stack.name };
}

export async function deleteStackAction(
  spaceSlug: string,
  stackSlug: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    const res = await deleteStack(spaceSlug, stackSlug);
    revalidatePath(`/spaces/${spaceSlug}`);
    revalidatePath(`/spaces/${spaceSlug}/stacks`);
    if (!res.ok) {
      return {
        ok: false,
        error: `Some members could not be deleted — ${res.failures
          .map((f) => `${f.kind} ${f.slug}: ${f.error}`)
          .join("; ")}. The stack was kept; try again.`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteAppAction(
  spaceSlug: string,
  appSlug: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await deleteApp(spaceSlug, appSlug);
    revalidatePath(`/spaces/${spaceSlug}`);
    revalidatePath(`/spaces/${spaceSlug}/stacks`);
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
  engine?: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await createDatabase({ spaceSlug, name, engine });
    revalidatePath(`/spaces/${spaceSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
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
    revalidatePath(`/spaces/${spaceSlug}/stacks`);
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

export async function addRegistryCredentialAction(
  spaceSlug: string,
  registry: string,
  username: string,
  password: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  if (!username.trim() || !password) {
    return { ok: false, error: "Username and password are required." };
  }
  try {
    await setRegistryCredential(spaceSlug, registry, username.trim(), password);
    revalidatePath(`/spaces/${spaceSlug}/settings`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function removeRegistryCredentialAction(
  spaceSlug: string,
  registry: string,
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  try {
    await removeRegistryCredential(spaceSlug, registry);
    revalidatePath(`/spaces/${spaceSlug}/settings`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Diff a new compose against an existing stack's LIVE members (no side effects).
 *  The destructive bucket (prune + volume removals) is what the confirm gate
 *  protects; db removals also list their space-wide attached-app blast radius. */
export async function previewReImportStackAction(
  spaceSlug: string,
  stackSlug: string,
  yaml: string,
) {
  const { space } = await assertOwnsSpace(spaceSlug);
  const stack = await getStack(space.id, stackSlug);
  if (!stack) return { ok: false as const, error: "Stack not found." };
  const plan = parseComposePlan(yaml);
  if (!plan.ok) return { ok: false as const, error: plan.error ?? "Invalid compose file." };

  const members = await listStackMembers(space.id, stack.id);
  const [allApps, allDbs] = await Promise.all([listApps(space.id), listDatabases(space.id)]);
  const memberSlugs = new Set<string>([
    ...members.apps.map((a) => a.slug),
    ...members.databases.map((d) => d.slug),
  ]);
  const outOfStack = new Set<string>(
    [...allApps.map((a) => a.slug), ...allDbs.map((d) => d.slug)].filter(
      (s) => !memberSlugs.has(s),
    ),
  );
  const diff = computeStackDiff(plan, members.apps, members.databases, outOfStack);

  // Space-wide blast radius of each pruned database (deleteDatabase detaches
  // EVERY attached app, in or out of the stack).
  const blastRadius = diff.databases.remove.map((r) => {
    const row = members.databases.find((d) => d.slug === r.slug);
    const apps = row
      ? allApps.filter((a) => a.attachedDbId === row.id).map((a) => a.slug)
      : [];
    return { db: r.slug, apps };
  });

  return { ok: true as const, diff, blastRadius, stackName: stack.name };
}

/** Apply a re-import: re-diff server-side, then ADD new members + UPDATE changed
 *  app fields, and (only when confirmRemove) prune removed members + volumes. */
export async function reImportStackAction(
  spaceSlug: string,
  stackSlug: string,
  yaml: string,
  confirmRemove: boolean,
): Promise<{
  ok: boolean;
  error?: string;
  results: ComposeImportResult[];
  stackSlug?: string;
  stackName?: string;
}> {
  const { space } = await assertOwnsSpace(spaceSlug);
  const stack = await getStack(space.id, stackSlug);
  if (!stack) return { ok: false, error: "Stack not found.", results: [] };
  const plan = parseComposePlan(yaml);
  if (!plan.ok) return { ok: false, error: plan.error, results: [] };

  // Re-diff from live members (never trust a client plan).
  const members = await listStackMembers(space.id, stack.id);
  const [allApps, allDbs] = await Promise.all([listApps(space.id), listDatabases(space.id)]);
  const memberSlugs = new Set<string>([
    ...members.apps.map((a) => a.slug),
    ...members.databases.map((d) => d.slug),
  ]);
  const outOfStack = new Set<string>(
    [...allApps.map((a) => a.slug), ...allDbs.map((d) => d.slug)].filter(
      (s) => !memberSlugs.has(s),
    ),
  );
  const diff = computeStackDiff(plan, members.apps, members.databases, outOfStack);

  // Pre-flight hard aborts (NO writes).
  if (diff.newCollisions.length > 0) {
    return {
      ok: false,
      error: `These services collide with resources outside this stack: ${diff.newCollisions.join(", ")} — rename them.`,
      results: [],
    };
  }
  const destructiveCount =
    diff.apps.remove.length +
    diff.databases.remove.length +
    diff.apps.update.filter((u) => u.removedVolumes.length > 0).length;
  if (destructiveCount > 0 && !confirmRemove) {
    return {
      ok: false,
      error: `${destructiveCount} item(s) would be permanently deleted — confirm to proceed.`,
      results: [],
    };
  }

  const results: ComposeImportResult[] = [];
  // Resolve attach targets: existing stack dbs + newly-created ones.
  const dbIdBySlug = new Map<string, string>(members.databases.map((d) => [d.slug, d.id]));

  // 1) ADD databases first (so attaches resolve).
  for (const d of diff.databases.add) {
    try {
      const row = await createDatabase({ spaceSlug, name: d.name, engine: d.engine, stackId: stack.id });
      dbIdBySlug.set(row.slug, row.id);
      results.push({ service: d.service, kind: "database", status: "created", slug: row.slug });
    } catch (err) {
      results.push({ service: d.service, kind: "database", status: "failed", error: errorMessage(err) });
    }
  }

  // 2) UPDATE changed apps in place.
  for (const u of diff.apps.update) {
    try {
      await applyAppUpdate(spaceSlug, u, dbIdBySlug);
      results.push({ service: u.service, kind: "app", status: "updated", slug: u.slug });
    } catch (err) {
      results.push({ service: u.service, kind: "app", status: "failed", error: errorMessage(err) });
    }
  }

  // 3) ADD new apps.
  for (const a of diff.apps.add) {
    try {
      const split = a.env.length ? splitEnvVars(a.env) : null;
      if (split && "error" in split) {
        results.push({ service: a.service, kind: "app", status: "failed", error: split.error });
        continue;
      }
      const createdApp = await createApp({
        spaceSlug,
        name: a.service,
        image: a.image,
        port: a.port,
        cpuLimit: a.cpuLimit,
        memoryLimit: a.memoryLimit,
        command: a.command,
        args: a.args,
        healthcheck: a.healthcheck,
        volumes: a.volumes,
        stackId: stack.id,
      });
      if (split) await setAppEnv(spaceSlug, createdApp.slug, split);
      if (a.attachDatabaseService) {
        const dbId = dbIdBySlug.get(slugify(a.attachDatabaseService));
        if (dbId) await attachDatabase(spaceSlug, createdApp.slug, dbId).catch(() => {});
      }
      results.push({ service: a.service, kind: "app", status: "created", slug: createdApp.slug });
    } catch (err) {
      results.push({ service: a.service, kind: "app", status: "failed", error: errorMessage(err) });
    }
  }

  // 4) PRUNE (only reachable when confirmRemove — pre-flight gated). Apps first
  //    (so deleteDatabase's detach doesn't force-restart an app about to be
  //    deleted), then databases.
  if (confirmRemove) {
    for (const r of diff.apps.remove) {
      try {
        await deleteApp(spaceSlug, r.slug);
        results.push({ service: r.slug, kind: "app", status: "removed", slug: r.slug });
      } catch (err) {
        results.push({ service: r.slug, kind: "app", status: "failed", error: errorMessage(err) });
      }
    }
    for (const r of diff.databases.remove) {
      try {
        await deleteDatabase(spaceSlug, r.slug);
        results.push({ service: r.slug, kind: "database", status: "removed", slug: r.slug });
      } catch (err) {
        results.push({ service: r.slug, kind: "database", status: "failed", error: errorMessage(err) });
      }
    }
  }

  const ok = results.every((r) => r.status !== "failed");
  if (ok) await setStackSourceYaml(spaceSlug, stack.slug, yaml).catch(() => {});
  revalidatePath(`/spaces/${spaceSlug}`);
  revalidatePath(`/spaces/${spaceSlug}/stacks`);
  revalidatePath(`/spaces/${spaceSlug}/stacks/${stackSlug}`);
  return { ok, results, stackSlug: stack.slug, stackName: stack.name };
}

/** Apply one matched app's in-place changes (spec fields, env, volumes, attach). */
async function applyAppUpdate(
  spaceSlug: string,
  u: AppUpdatePlan,
  dbIdBySlug: Map<string, string>,
): Promise<void> {
  if (Object.keys(u.spec).length > 0) {
    await updateApp(spaceSlug, u.slug, u.spec);
  }
  if (u.envChanged) {
    const split = splitEnvVars(u.desiredEnv);
    if ("error" in split) throw new Error(split.error);
    await setAppEnv(spaceSlug, u.slug, split);
  }
  if (u.addedVolumes.length > 0 || u.removedVolumes.length > 0) {
    await setAppVolumes(spaceSlug, u.slug, u.desiredVolumes);
  }
  if (u.attach.kind === "attach" && u.attach.dbSlug) {
    const dbId = dbIdBySlug.get(u.attach.dbSlug);
    if (dbId) await attachDatabase(spaceSlug, u.slug, dbId);
  } else if (u.attach.kind === "detach") {
    await detachDatabase(spaceSlug, u.slug);
  }
}

export async function setAppVolumesAction(
  spaceSlug: string,
  appSlug: string,
  volumes: VolumeSpec[],
): Promise<ActionResult> {
  await assertOwnsSpace(spaceSlug);
  const vres = validateVolumes(volumes);
  if ("error" in vres) return { ok: false, error: vres.error };
  try {
    await setAppVolumes(spaceSlug, appSlug, vres.volumes);
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

/** Disconnect a GitHub account/org: uninstall the app from it + drop the link. */
export async function disconnectGithubAccountAction(
  installationId: string,
): Promise<ActionResult> {
  const session = await requireUser();
  if ((session.user as { role?: string }).role !== "admin") {
    return { ok: false, error: "Only an admin can manage GitHub accounts." };
  }
  try {
    await disconnectInstallation(installationId);
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
