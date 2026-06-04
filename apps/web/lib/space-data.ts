import {
  listApps,
  listDatabases,
  getDatabaseInfo,
  listKoreAppPhases,
  lastDeployedAt,
  phaseToStatus,
  listAllDomains,
  listStacks,
  getStack,
} from "@korepush/k8s";

export type SpaceRef = {
  id: string;
  slug: string;
  name: string;
  namespace: string;
  ownerId: string;
};

export type SpaceApp = Omit<
  Awaited<ReturnType<typeof listApps>>[number],
  "status"
> & { status: string };

// Apps with live status (operator CR phase, falling back to the DB mirror),
// grouped into projects (environments sharing a projectId), plus last-deploy.
export async function getSpaceApps(space: SpaceRef) {
  const [appRows, phases] = await Promise.all([
    listApps(space.id),
    listKoreAppPhases(space.namespace).catch(
      (): Record<string, string> => ({}),
    ),
  ]);
  const apps: SpaceApp[] = appRows.map((a) => ({
    ...a,
    status: phaseToStatus(phases[a.slug]) ?? a.status,
  }));
  const lastDeploy = await lastDeployedAt(appRows.map((a) => a.id));

  const projectMap = new Map<string, SpaceApp[]>();
  for (const a of apps) {
    const g = projectMap.get(a.projectId);
    if (g) g.push(a);
    else projectMap.set(a.projectId, [a]);
  }

  return { apps, projects: [...projectMap.values()], lastDeploy };
}

export type SpaceDatabase = Omit<
  Awaited<ReturnType<typeof listDatabases>>[number],
  "status"
> & {
  status: string;
  info: {
    ready: boolean;
    phase: string;
    connectionUri: string | null;
    host: string | null;
  };
};

export async function getSpaceDatabases(
  space: SpaceRef,
): Promise<SpaceDatabase[]> {
  const dbRows = await listDatabases(space.id);
  return Promise.all(
    dbRows.map(async (d) => {
      const info = await getDatabaseInfo(space.namespace, d.slug, d.engine).catch(() => ({
        ready: false,
        phase: "provisioning",
        connectionUri: null,
        host: null,
      }));
      const status = info.ready
        ? "running"
        : info.phase === "failed"
          ? "failed"
          : "provisioning";
      return { ...d, status, info };
    }),
  );
}

export type StackStatus =
  | "empty"
  | "running"
  | "provisioning"
  | "pending"
  | "degraded";

/**
 * Aggregate a stack's status from its members. IMPORTANT: the KoreApp operator
 * never emits a "failed" phase (only Pending/Progressing/Running/Stopped), so a
 * crash-looping app stays "progressing" — we can't detect app failure here.
 * Databases DO surface "failed". So: any failed/degraded → degraded; any in-
 * flight (provisioning/progressing) → provisioning; any pending → pending; all
 * running → running; anything else (mixed/stopped/unknown) → degraded
 * (conservative). The detail page always renders per-member badges so a member
 * silently stuck "progressing" is still visible.
 */
export function rollupStatus(statuses: string[]): StackStatus {
  if (statuses.length === 0) return "empty";
  if (statuses.some((s) => s === "failed" || s === "degraded")) return "degraded";
  if (statuses.some((s) => s === "provisioning" || s === "progressing")) {
    return "provisioning";
  }
  if (statuses.some((s) => s === "pending")) return "pending";
  if (statuses.every((s) => s === "running")) return "running";
  return "degraded"; // mixed / stopped / unknown
}

export type SpaceStack = {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  appCount: number;
  dbCount: number;
  status: StackStatus;
};

export async function getSpaceStacks(space: SpaceRef): Promise<SpaceStack[]> {
  const [stackRows, { apps }, dbs] = await Promise.all([
    listStacks(space.id),
    getSpaceApps(space),
    getSpaceDatabases(space),
  ]);
  return stackRows.map((s) => {
    const memberApps = apps.filter((a) => a.stackId === s.id);
    const memberDbs = dbs.filter((d) => d.stackId === s.id);
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      createdAt: s.createdAt,
      appCount: memberApps.length,
      dbCount: memberDbs.length,
      status: rollupStatus([
        ...memberApps.map((a) => a.status),
        ...memberDbs.map((d) => d.status),
      ]),
    };
  });
}

export async function getStackWithMembers(space: SpaceRef, stackSlug: string) {
  const stack = await getStack(space.id, stackSlug);
  if (!stack) return null;
  const [{ apps }, dbs] = await Promise.all([
    getSpaceApps(space),
    getSpaceDatabases(space),
  ]);
  const memberApps = apps.filter((a) => a.stackId === stack.id);
  const memberDbs = dbs.filter((d) => d.stackId === stack.id);
  return {
    ...stack,
    appCount: memberApps.length,
    dbCount: memberDbs.length,
    apps: memberApps,
    databases: memberDbs,
    status: rollupStatus([
      ...memberApps.map((a) => a.status),
      ...memberDbs.map((d) => d.status),
    ]),
  };
}

export async function getSpaceDomains(space: SpaceRef) {
  const all = await listAllDomains(space.ownerId).catch(() => []);
  return all.filter((d) => d.spaceSlug === space.slug);
}

export function baseDomain(): string {
  return process.env.KOREPUSH_BASE_DOMAIN ?? "localhost";
}
