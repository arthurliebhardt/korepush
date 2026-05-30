export type EnvVarSpec = {
  name: string;
  value?: string;
  secretKeyRef?: { name: string; key: string };
};

export type KoreAppSpec = {
  source: "image" | "git";
  image?: string;
  git?: {
    repoUrl: string;
    ref?: string;
    rootDir?: string;
    installCmd?: string;
    buildCmd?: string;
    startCmd?: string;
  };
  port: number;
  replicas?: number;
  env?: EnvVarSpec[];
  envFrom?: { secretRef: { name: string } }[];
  domains?: { host: string; staging?: boolean }[];
  database?: { name: string; envVar?: string };
  canary?: { image: string; weight: number };
};

export type KoreAppStatus = {
  phase?: string;
  observedGeneration?: number;
  currentImage?: string;
  url?: string;
  replicas?: number;
  readyReplicas?: number;
  selector?: string;
  conditions?: {
    type: string;
    status: "True" | "False" | "Unknown";
    observedGeneration?: number;
    lastTransitionTime: string;
    reason: string;
    message: string;
  }[];
  domains?: { host: string; phase?: string; message?: string }[];
};

export type KoreApp = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    generation?: number;
    resourceVersion?: string;
    labels?: Record<string, string>;
    // Typed as Date to satisfy client-node's KubernetesObject; at runtime it's
    // an ISO string — we only ever truthy-check it.
    deletionTimestamp?: Date;
    finalizers?: string[];
  };
  spec: KoreAppSpec;
  status?: KoreAppStatus;
};

export const GROUP = "korepush.io";
export const VERSION = "v1alpha1";
export const PLURAL = "koreapps";
