import { and, eq } from "drizzle-orm";
import { db, schema } from "@korepush/db";
import { getSpaceBySlug } from "./spaces";
import { slugify, isUniqueViolation } from "./util";
import { deleteApp } from "./apps";
import { deleteDatabase } from "./databases";

// A stack groups the apps + databases created from one compose import. It owns
// NO cluster objects — members own their CRs — so this is pure control-plane
// grouping: atomic create (one stack + member FKs), atomic delete (cascade via
// the members' own teardown), and a live aggregate status (computed at read
// time, never stored).

export async function listStacks(spaceId: string) {
  return db
    .select()
    .from(schema.stacks)
    .where(eq(schema.stacks.spaceId, spaceId))
    .orderBy(schema.stacks.createdAt);
}

export async function getStack(spaceId: string, slug: string) {
  const [row] = await db
    .select()
    .from(schema.stacks)
    .where(and(eq(schema.stacks.spaceId, spaceId), eq(schema.stacks.slug, slug)))
    .limit(1);
  return row ?? null;
}

/** Member apps + databases of a stack (by the stackId FK). */
export async function listStackMembers(spaceId: string, stackId: string) {
  const [apps, databases] = await Promise.all([
    db
      .select()
      .from(schema.apps)
      .where(and(eq(schema.apps.spaceId, spaceId), eq(schema.apps.stackId, stackId)))
      .orderBy(schema.apps.createdAt),
    db
      .select()
      .from(schema.databases)
      .where(and(eq(schema.databases.spaceId, spaceId), eq(schema.databases.stackId, stackId)))
      .orderBy(schema.databases.createdAt),
  ]);
  return { apps, databases };
}

export async function createStack(spaceSlug: string, name: string) {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) throw new Error("Space not found");
  const slug = slugify(name);
  if (!slug) throw new Error("Invalid stack name");
  const [row] = await db
    .insert(schema.stacks)
    .values({ spaceId: space.id, name, slug })
    .returning()
    .catch((err) => {
      if (isUniqueViolation(err)) {
        throw new Error(`A stack named "${name}" already exists in this space.`);
      }
      throw err;
    });
  return row;
}

export type StackDeleteFailure = {
  kind: "app" | "database";
  slug: string;
  error: string;
};

/**
 * Atomically delete a stack: tear down every member through the proven
 * deleteApp/deleteDatabase paths (which clean up CRs, PVCs, env Secrets, and
 * the detach dance), then drop the stack row LAST — only when every member
 * succeeded. APPS are deleted before DATABASES so a member app isn't
 * force-restarted (by deleteDatabase's detach) moments before its own deletion,
 * and a failed app-delete leaves its DB intact for a clean retry. Idempotent:
 * deleteApp/deleteDatabase early-return on missing rows and use 404-tolerant
 * k8s deletes, so re-running after a partial failure re-attempts only the
 * survivors (their stackId is still set — the FK is set-null, not cascade).
 */
export async function deleteStack(
  spaceSlug: string,
  stackSlug: string,
): Promise<{ ok: boolean; failures: StackDeleteFailure[] }> {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) return { ok: true, failures: [] };
  const stack = await getStack(space.id, stackSlug);
  if (!stack) return { ok: true, failures: [] };

  const { apps, databases } = await listStackMembers(space.id, stack.id);
  const failures: StackDeleteFailure[] = [];

  for (const app of apps) {
    try {
      await deleteApp(spaceSlug, app.slug);
    } catch (err) {
      failures.push({ kind: "app", slug: app.slug, error: errMsg(err) });
    }
  }
  for (const database of databases) {
    try {
      await deleteDatabase(spaceSlug, database.slug);
    } catch (err) {
      failures.push({ kind: "database", slug: database.slug, error: errMsg(err) });
    }
  }

  if (failures.length === 0) {
    await db.delete(schema.stacks).where(eq(schema.stacks.id, stack.id));
    return { ok: true, failures: [] };
  }
  return { ok: false, failures };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
