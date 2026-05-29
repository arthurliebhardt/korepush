"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  createSpace,
  deleteSpace,
  createApp,
  deleteApp,
  createGitApp,
  triggerGitBuild,
  setControlPlaneDomain,
  getSpaceBySlug,
  getApp,
  createDatabase,
  deleteDatabase,
  attachDatabase,
  detachDatabase,
  setAppEnv,
  rollbackDeployment,
} from "@korepush/k8s";
import { mintCloneTokenForRepo, detectPort } from "@/lib/github/app";
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
  await requireUser();
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
}): Promise<ActionResult> {
  await requireUser();
  try {
    await createApp(input);
    revalidatePath(`/spaces/${input.spaceSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteAppAction(
  spaceSlug: string,
  appSlug: string,
): Promise<ActionResult> {
  await requireUser();
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
}): Promise<BuildActionResult> {
  await requireUser();
  try {
    // Validate env up front so we never leave an orphan app on a bad var.
    const split = input.env?.length ? splitEnvVars(input.env) : null;
    if (split && "error" in split) return { ok: false, error: split.error };

    // No port given → auto-detect from the repo (Dockerfile EXPOSE / start
    // script), falling back to 3000. korepush injects PORT=<port>, so a
    // $PORT-honoring app conforms regardless.
    const port =
      input.port ??
      (await detectPort(input.repoUrl, input.gitRef ?? "main").catch(
        () => null,
      )) ??
      3000;
    const app = await createGitApp({
      spaceSlug: input.spaceSlug,
      name: input.name,
      repoUrl: input.repoUrl,
      gitRef: input.gitRef,
      port,
      installCmd: input.installCmd,
      buildCmd: input.buildCmd,
      startCmd: input.startCmd,
    });
    // Persist env (incl. secrets) before the build; reconcileApp injects them
    // when the build finalizes.
    if (split) await setAppEnv(input.spaceSlug, app.slug, split);
    const token = await mintCloneTokenForRepo(input.repoUrl).catch(() => null);
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
  await requireUser();
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
  await requireUser();
  try {
    await createDatabase({ spaceSlug, name });
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
  await requireUser();
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
  await requireUser();
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
  await requireUser();
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
  await requireUser();
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
  await requireUser();
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
