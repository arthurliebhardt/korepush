import { and, eq } from "drizzle-orm";
import { db, schema } from "@korepush/db";
import { getSpaceBySlug } from "./spaces";
import { slugify, isUniqueViolation } from "./util";
import { deleteApp, type UpdateAppInput } from "./apps";
import { deleteDatabase } from "./databases";
import type {
  ComposePlan,
  ComposeAppPlan,
  ComposeDatabasePlan,
  ComposeEnvRow,
} from "./compose";
import type { VolumeSpec, HealthcheckSpec } from "./koreapp";

type AppRow = typeof schema.apps.$inferSelect;
type DatabaseRow = typeof schema.databases.$inferSelect;

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

/** Persist the last-imported compose YAML (advisory — pre-fill + audit only). */
export async function setStackSourceYaml(
  spaceSlug: string,
  stackSlug: string,
  yaml: string,
): Promise<void> {
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) return;
  await db
    .update(schema.stacks)
    .set({ sourceYaml: yaml, updatedAt: new Date() })
    .where(and(eq(schema.stacks.spaceId, space.id), eq(schema.stacks.slug, stackSlug)));
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

/* ──────────────────────────────────────────────────────────────────────────
 * Compose re-import diff (Phase 6). Pure: diffs a desired ComposePlan against
 * a stack's LIVE member rows (apps/databases). The live rows are authoritative
 * — never a stored YAML. Produces add / in-place-update / destructive-remove
 * buckets + the exact apply instructions, with careful normalization so a no-op
 * re-import shows ZERO changes (no needless pod rolls).
 * ──────────────────────────────────────────────────────────────────────── */

export type FieldChange = { field: string; from: string; to: string };

export type AppUpdatePlan = {
  slug: string;
  service: string;
  changes: FieldChange[]; // display chips
  spec: UpdateAppInput; // image/cpu/mem/command/args/healthcheck deltas
  envChanged: boolean;
  desiredEnv: ComposeEnvRow[]; // full compose env to setAppEnv when envChanged
  desiredVolumes: VolumeSpec[]; // full desired volume list (setAppVolumes)
  addedVolumes: string[]; // names (safe)
  removedVolumes: string[]; // names (DESTRUCTIVE)
  attach: { kind: "none" | "attach" | "detach"; dbSlug?: string };
  portRequiresRecreate: boolean; // read-only note (port is immutable in place)
};

export type AppRemovePlan = { slug: string; name: string; hasData: boolean };
export type DbRemovePlan = { slug: string; name: string };

export type StackDiff = {
  apps: {
    add: ComposeAppPlan[];
    update: AppUpdatePlan[];
    remove: AppRemovePlan[];
  };
  databases: {
    add: ComposeDatabasePlan[];
    remove: DbRemovePlan[];
    warn: { slug: string; message: string }[];
  };
  newCollisions: string[]; // desired ADD slug that exists OUTSIDE this stack
  hasChanges: boolean;
  hasDestructive: boolean;
};

const normNull = (v: string | null | undefined) => v ?? null;
const normArr2 = (a: string[] | null | undefined) => (a && a.length ? a : null);
const normHc2 = (h: HealthcheckSpec | null | undefined) =>
  h?.test?.length && h.test[0] !== "NONE" ? h : null;
const jeq2 = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function computeStackDiff(
  plan: ComposePlan,
  currentApps: AppRow[],
  currentDatabases: DatabaseRow[],
  outOfStackSlugs: Set<string>,
): StackDiff {
  const appBySlug = new Map(currentApps.map((a) => [a.slug, a]));
  const dbBySlug = new Map(currentDatabases.map((d) => [d.slug, d]));
  const dbSlugById = new Map(currentDatabases.map((d) => [d.id, d.slug]));
  // Resolve a compose attach service -> the desired db slug.
  const dbSlugByService = new Map(plan.databases.map((d) => [d.service, d.slug]));

  const newCollisions: string[] = [];
  const appAdd: ComposeAppPlan[] = [];
  const appUpdate: AppUpdatePlan[] = [];
  const desiredAppSlugs = new Set(plan.apps.map((a) => a.slug));
  const desiredDbSlugs = new Set(plan.databases.map((d) => d.slug));

  for (const a of plan.apps) {
    const cur = appBySlug.get(a.slug);
    if (!cur) {
      if (outOfStackSlugs.has(a.slug)) newCollisions.push(a.slug);
      appAdd.push(a);
      continue;
    }
    // Matched -> compute in-place update.
    const changes: FieldChange[] = [];
    const spec: UpdateAppInput = {};

    if (a.image !== cur.image) {
      changes.push({ field: "image", from: cur.image ?? "—", to: a.image });
      spec.image = a.image;
    }
    const desiredCpu = normNull(a.cpuLimit);
    const desiredMem = normNull(a.memoryLimit);
    if (desiredCpu !== cur.cpuLimit || desiredMem !== cur.memoryLimit) {
      changes.push({
        field: "resources",
        from: `${cur.cpuLimit ?? "default"} / ${cur.memoryLimit ?? "default"}`,
        to: `${desiredCpu ?? "default"} / ${desiredMem ?? "default"}`,
      });
      spec.cpuLimit = desiredCpu;
      spec.memoryLimit = desiredMem;
    }
    if (!jeq2(normArr2(a.command), normArr2(cur.command))) {
      changes.push({ field: "command", from: fmtArr(cur.command), to: fmtArr(a.command) });
      spec.command = normArr2(a.command);
    }
    if (!jeq2(normArr2(a.args), normArr2(cur.args))) {
      changes.push({ field: "args", from: fmtArr(cur.args), to: fmtArr(a.args) });
      spec.args = normArr2(a.args);
    }
    if (!jeq2(normHc2(a.healthcheck), normHc2(cur.healthcheck))) {
      changes.push({ field: "healthcheck", from: cur.healthcheck ? "set" : "none", to: a.healthcheck ? "set" : "none" });
      spec.healthcheck = normHc2(a.healthcheck) as HealthcheckSpec | null;
    }

    // Env: plain map + secret KEY set (secret VALUES are unstorable -> undetectable).
    const desiredPlain: Record<string, string> = {};
    const desiredSecretKeys = new Set<string>();
    for (const e of a.env) {
      if (e.secret) desiredSecretKeys.add(e.key);
      else desiredPlain[e.key] = e.value;
    }
    const curSecretKeys = new Set(cur.secretKeys ?? []);
    const envChanged =
      !jeq2(desiredPlain, cur.env ?? {}) || !setEq(desiredSecretKeys, curSecretKeys);
    if (envChanged) {
      const desiredKeys = new Set([...Object.keys(desiredPlain), ...desiredSecretKeys]);
      const curKeys = new Set([...Object.keys(cur.env ?? {}), ...curSecretKeys]);
      const added = [...desiredKeys].filter((k) => !curKeys.has(k));
      const removed = [...curKeys].filter((k) => !desiredKeys.has(k));
      const parts: string[] = [];
      if (added.length) parts.push(`+${added.join(", +")}`);
      if (removed.length) parts.push(`-${removed.join(", -")}`);
      changes.push({ field: "env", from: `${curKeys.size} vars`, to: parts.join(" ") || "values changed" });
    }

    // Volumes: by name; additions safe, removals DESTRUCTIVE (PVC deleted).
    const desiredVolumes = a.volumes ?? [];
    const desiredVolNames = new Set(desiredVolumes.map((v) => v.name));
    const curVolNames = new Set((cur.volumes ?? []).map((v) => v.name));
    const addedVolumes = [...desiredVolNames].filter((n) => !curVolNames.has(n));
    const removedVolumes = [...curVolNames].filter((n) => !desiredVolNames.has(n));
    if (addedVolumes.length) {
      changes.push({ field: "volumes", from: `${curVolNames.size}`, to: `+${addedVolumes.join(", +")}` });
    }

    // Attach: resolve desired vs current db slug.
    const desiredAttachSlug = a.attachDatabaseService
      ? dbSlugByService.get(a.attachDatabaseService) ?? slugify(a.attachDatabaseService)
      : null;
    const curAttachSlug = cur.attachedDbId ? dbSlugById.get(cur.attachedDbId) ?? "(external)" : null;
    let attach: AppUpdatePlan["attach"] = { kind: "none" };
    if (desiredAttachSlug !== curAttachSlug) {
      if (desiredAttachSlug) {
        attach = { kind: "attach", dbSlug: desiredAttachSlug };
        changes.push({ field: "database", from: curAttachSlug ?? "none", to: desiredAttachSlug });
      } else {
        attach = { kind: "detach" };
        changes.push({ field: "database", from: curAttachSlug ?? "none", to: "none" });
      }
    }

    const portRequiresRecreate = a.port !== cur.port;
    if (portRequiresRecreate) {
      changes.push({ field: "port", from: String(cur.port), to: `${a.port} (requires recreate — not applied)` });
    }

    const touched =
      Object.keys(spec).length > 0 ||
      envChanged ||
      addedVolumes.length > 0 ||
      removedVolumes.length > 0 ||
      attach.kind !== "none" ||
      portRequiresRecreate; // surfaced read-only so the user isn't silently ignored
    if (touched) {
      appUpdate.push({
        slug: a.slug,
        service: a.service,
        changes,
        spec,
        envChanged,
        desiredEnv: a.env,
        desiredVolumes,
        addedVolumes,
        removedVolumes,
        attach,
        portRequiresRecreate,
      });
    }
  }

  // Removed apps (in stack, not in compose) — DESTRUCTIVE.
  const appRemove: AppRemovePlan[] = currentApps
    .filter((a) => !desiredAppSlugs.has(a.slug))
    .map((a) => ({ slug: a.slug, name: a.name, hasData: (a.volumes ?? []).length > 0 }));

  // Databases: add / remove (destructive) / warn-immutable (engine change).
  const dbAdd: ComposeDatabasePlan[] = [];
  const dbWarn: { slug: string; message: string }[] = [];
  for (const d of plan.databases) {
    const cur = dbBySlug.get(d.slug);
    if (!cur) {
      if (outOfStackSlugs.has(d.slug)) newCollisions.push(d.slug);
      dbAdd.push(d);
    } else if (cur.engine !== d.engine) {
      dbWarn.push({
        slug: d.slug,
        message: `engine ${cur.engine} → ${d.engine} can't change in place — remove and re-import to recreate (destroys data).`,
      });
    }
  }
  const dbRemove: DbRemovePlan[] = currentDatabases
    .filter((d) => !desiredDbSlugs.has(d.slug))
    .map((d) => ({ slug: d.slug, name: d.name }));

  const hasDestructive =
    appRemove.length > 0 ||
    dbRemove.length > 0 ||
    appUpdate.some((u) => u.removedVolumes.length > 0);
  const hasChanges =
    appAdd.length > 0 ||
    appUpdate.length > 0 ||
    appRemove.length > 0 ||
    dbAdd.length > 0 ||
    dbRemove.length > 0;

  return {
    apps: { add: appAdd, update: appUpdate, remove: appRemove },
    databases: { add: dbAdd, remove: dbRemove, warn: dbWarn },
    newCollisions,
    hasChanges,
    hasDestructive,
  };
}

function setEq(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}
function fmtArr(a: string[] | null | undefined): string {
  return a && a.length ? a.join(" ") : "none";
}
