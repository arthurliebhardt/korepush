import {
  listApps,
  listDatabases,
  getDatabaseInfo,
  listKoreAppPhases,
  lastDeployedAt,
  phaseToStatus,
  listAllDomains,
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

export async function getSpaceDomains(space: SpaceRef) {
  const all = await listAllDomains(space.ownerId).catch(() => []);
  return all.filter((d) => d.spaceSlug === space.slug);
}

export function baseDomain(): string {
  return process.env.KOREPUSH_BASE_DOMAIN ?? "localhost";
}
