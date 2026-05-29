// Public API for the korepush Kubernetes layer.
// NOTE: this package pulls in @kubernetes/client-node — import it only from
// server contexts (server actions, route handlers, server components).

export {
  k8sClients,
  clusterReachable,
  managedLabels,
  MANAGED_BY,
} from "./client";
export { getAppPodName, streamPodLogs, isContainerStarted } from "./pods";
export {
  listSpaces,
  getSpaceBySlug,
  createSpace,
  deleteSpace,
} from "./spaces";
export {
  listApps,
  getApp,
  createApp,
  deleteApp,
  createGitApp,
  triggerGitBuild,
  finalizeBuild,
  appsForRepoPush,
  listDeployments,
  latestBuildingDeployment,
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
export { slugify } from "./util";
