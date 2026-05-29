// Public API for the korepush Kubernetes layer.
// NOTE: this package pulls in @kubernetes/client-node — import it only from
// server contexts (server actions, route handlers, server components).

export {
  k8sClients,
  clusterReachable,
  managedLabels,
  MANAGED_BY,
} from "./client";
export { getAppPodName, streamPodLogs } from "./pods";
export {
  listSpaces,
  getSpaceBySlug,
  createSpace,
  deleteSpace,
} from "./spaces";
export { listApps, getApp, createApp, deleteApp } from "./apps";
export type { CreateAppInput } from "./apps";
export {
  getControlPlaneInfo,
  setControlPlaneDomain,
} from "./platform";
export type { ControlPlaneInfo } from "./platform";
export { slugify } from "./util";
