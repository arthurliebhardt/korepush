// Public API for the korepush Kubernetes layer.
// NOTE: this package pulls in @kubernetes/client-node — import it only from
// server contexts (server actions, route handlers, server components).

export {
  k8sClients,
  clusterReachable,
  managedLabels,
  MANAGED_BY,
} from "./client";
export {
  getAppPodName,
  streamPodLogs,
  isContainerStarted,
  getAppDiagnostics,
  getEffectiveEnv,
} from "./pods";
export type {
  AppDiagnostics,
  ContainerDiag,
  AppEvent,
  EffectiveEnv,
} from "./pods";
export {
  listSpaces,
  listSpacesForUser,
  listSpacesWithStats,
  getSpaceBySlug,
  createSpace,
  deleteSpace,
  backfillKoreSpaces,
} from "./spaces";
export {
  listApps,
  getApp,
  createApp,
  deleteApp,
  createGitApp,
  addEnvironment,
  listProjectEnvs,
  triggerGitBuild,
  finalizeBuild,
  appsForRepoPush,
  attachDatabase,
  detachDatabase,
  setAppEnv,
  rollbackDeployment,
  listDeployments,
  getDeployment,
  lastDeployedAt,
  latestBuildingDeployment,
  addAppDomain,
  removeAppDomain,
  listAppDomains,
  refreshAppDomainStatus,
  getNodeIp,
  backfillKoreApps,
  startBuildFinalizer,
} from "./apps";
export type { CreateAppInput, CreateGitAppInput } from "./apps";
export {
  BUILD_NS,
  buildImageRef,
  buildJobName,
  getBuildJobPhase,
  getBuildPodName,
} from "./build";
export type { BuildPhase } from "./build";
export {
  getControlPlaneInfo,
  setControlPlaneDomain,
} from "./platform";
export type { ControlPlaneInfo } from "./platform";
export {
  listDatabases,
  getDatabase,
  createDatabase,
  getDatabaseInfo,
  deleteDatabase,
  backfillKoreDatabases,
} from "./databases";
export type { DatabaseInfo } from "./databases";
export {
  prometheusReachable,
  getAppMetrics,
  getSpaceMetrics,
  getSpaceMetricsSeries,
  getSpaceWorkloadBreakdown,
} from "./metrics";
export type {
  AppMetrics,
  SpaceMetrics,
  SpaceMetricsSeries,
  PodUsage,
  MetricSeries,
  MetricPoint,
} from "./metrics";
export {
  listAllDeployments,
  listAllDatabases,
  listAllDomains,
} from "./overview";
export { slugify } from "./util";
export { getKoreAppPhase, listKoreAppPhases, phaseToStatus } from "./koreapp";
