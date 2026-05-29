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
} from "@korepush/k8s";
import { mintCloneTokenForRepo } from "@/lib/github/app";

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

export async function createGitAppAction(input: {
  spaceSlug: string;
  name: string;
  repoUrl: string;
  gitRef?: string;
  port?: number;
}): Promise<BuildActionResult> {
  await requireUser();
  try {
    const app = await createGitApp(input);
    const token = await mintCloneTokenForRepo(input.repoUrl).catch(() => null);
    const { deploymentId } = await triggerGitBuild(
      input.spaceSlug,
      app.slug,
      "manual",
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
