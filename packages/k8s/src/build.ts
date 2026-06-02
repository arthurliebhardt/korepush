import * as k8s from "@kubernetes/client-node";
import { k8sClients, managedLabels } from "./client";

// Builds run in the control-plane namespace (no per-space quota) and push to
// the in-cluster registry by its svc-DNS name. containerd pulls the same name
// via the registries.yaml mirror (-> NodePort) that install.sh writes.
export const BUILD_NS = "korepush-system";
export const REGISTRY_HOST = "registry.korepush-system.svc.cluster.local:5000";
const BUILDKIT_IMAGE = "moby/buildkit:v0.27.0";
// Build container: buildctl + git + the Railpack CLI (see builder/Dockerfile).
const BUILDER_IMAGE =
  process.env.KOREPUSH_BUILDER_IMAGE ??
  "ghcr.io/arthurliebhardt/korepush-builder:latest";
const RAILPACK_FRONTEND = "ghcr.io/railwayapp/railpack-frontend:v0.23.0";

/** Canonical image ref — identical for buildkit push and the pod's image field. */
export function buildImageRef(spaceSlug: string, appSlug: string, tag: string) {
  return `${REGISTRY_HOST}/${spaceSlug}/${appSlug}:${tag}`;
}

export function buildJobName(appSlug: string, tag: string) {
  return `build-${appSlug}-${tag}`.slice(0, 63);
}

const BUILD_SCRIPT = `set -e
echo "── cloning $REPO_URL ($GIT_REF) ──"
# Private repos: inject a short-lived installation token (GIT_TOKEN). Only ever
# attach it to a github.com URL — never trust REPO_URL's host with the token,
# even though the control plane already validates it (defense in depth).
if [ -n "$GIT_TOKEN" ]; then
  case "$REPO_URL" in
    https://github.com/*)
      CLONE="https://x-access-token:$GIT_TOKEN@github.com/\${REPO_URL#https://github.com/}" ;;
    *)
      echo "refusing to attach clone token to non-github.com URL: $REPO_URL" >&2
      exit 1 ;;
  esac
else
  CLONE="$REPO_URL"
fi
if [ -n "$GIT_REF" ]; then
  git clone --depth 1 --branch "$GIT_REF" "$CLONE" /workspace/repo
else
  git clone --depth 1 "$CLONE" /workspace/repo
fi
echo "── waiting for buildkitd ──"
for i in $(seq 1 60); do [ -S /run/buildkit/buildkitd.sock ] && break; sleep 1; done
cd /workspace/repo
if [ -f Dockerfile ]; then
  echo "── Dockerfile detected → building with BuildKit ──"
  buildctl --addr unix:///run/buildkit/buildkitd.sock build \\
    --frontend dockerfile.v0 \\
    --local context=/workspace/repo \\
    --local dockerfile=/workspace/repo \\
    --output type=image,name=$IMAGE,push=true,registry.insecure=true \\
    --progress=plain
else
  echo "── no Dockerfile → Railpack auto-detect ──"
  railpack prepare /workspace/repo \\
    --plan-out /workspace/railpack-plan.json \\
    --info-out /workspace/railpack-info.json
  buildctl --addr unix:///run/buildkit/buildkitd.sock build \\
    --frontend=gateway.v0 \\
    --opt source=${RAILPACK_FRONTEND} \\
    --local context=/workspace/repo \\
    --local dockerfile=/workspace \\
    --opt filename=railpack-plan.json \\
    --output type=image,name=$IMAGE,push=true,registry.insecure=true \\
    --progress=plain
fi
echo "── pushed $IMAGE ──"`;

type CreateBuildJobInput = {
  jobName: string;
  appSlug: string;
  repoUrl: string;
  gitRef: string;
  image: string;
  /** Short-lived token for cloning a private repo (omit for public). */
  cloneToken?: string;
  /** Optional Railpack command overrides (ignored when a Dockerfile is used). */
  installCmd?: string | null;
  buildCmd?: string | null;
  startCmd?: string | null;
};

export async function createBuildJob(input: CreateBuildJobInput) {
  const { batch } = k8sClients();
  const labels = managedLabels({ "korepush.io/build": input.jobName });

  // Native sidecar: buildkitd is an initContainer with restartPolicy=Always, so
  // it is auto-terminated once the build container exits and the Job completes.
  const buildkitd: k8s.V1Container = {
    name: "buildkitd",
    image: BUILDKIT_IMAGE,
    restartPolicy: "Always",
    command: ["buildkitd", "--addr", "unix:///run/buildkit/buildkitd.sock"],
    securityContext: { privileged: true },
    volumeMounts: [{ name: "buildkit", mountPath: "/run/buildkit" }],
    resources: {
      requests: { cpu: "100m", memory: "256Mi" },
      limits: { cpu: "2", memory: "2Gi" },
    },
  };

  await batch.createNamespacedJob({
    namespace: BUILD_NS,
    body: {
      metadata: { name: input.jobName, namespace: BUILD_NS, labels },
      spec: {
        backoffLimit: 0,
        ttlSecondsAfterFinished: 3600,
        template: {
          metadata: { labels },
          spec: {
            restartPolicy: "Never",
            initContainers: [buildkitd],
            containers: [
              {
                name: "build",
                image: BUILDER_IMAGE,
                command: ["sh", "-c", BUILD_SCRIPT],
                env: [
                  { name: "REPO_URL", value: input.repoUrl },
                  { name: "GIT_REF", value: input.gitRef },
                  { name: "IMAGE", value: input.image },
                  ...(input.cloneToken
                    ? [{ name: "GIT_TOKEN", value: input.cloneToken }]
                    : []),
                  // Railpack reads these during `railpack prepare` (no-op for a
                  // Dockerfile build, which doesn't invoke Railpack).
                  ...(input.installCmd
                    ? [{ name: "RAILPACK_INSTALL_CMD", value: input.installCmd }]
                    : []),
                  ...(input.buildCmd
                    ? [{ name: "RAILPACK_BUILD_CMD", value: input.buildCmd }]
                    : []),
                  ...(input.startCmd
                    ? [{ name: "RAILPACK_START_CMD", value: input.startCmd }]
                    : []),
                ],
                volumeMounts: [
                  { name: "buildkit", mountPath: "/run/buildkit" },
                  { name: "workspace", mountPath: "/workspace" },
                ],
                resources: {
                  requests: { cpu: "100m", memory: "256Mi" },
                  limits: { cpu: "2", memory: "2Gi" },
                },
              },
            ],
            volumes: [
              { name: "buildkit", emptyDir: {} },
              { name: "workspace", emptyDir: {} },
            ],
          },
        },
      },
    },
  });
  return input.jobName;
}

export type BuildPhase = "running" | "succeeded" | "failed" | "unknown";

export async function getBuildJobPhase(jobName: string): Promise<BuildPhase> {
  try {
    const job = await k8sClients().batch.readNamespacedJob({
      name: jobName,
      namespace: BUILD_NS,
    });
    if ((job.status?.succeeded ?? 0) > 0) return "succeeded";
    if ((job.status?.failed ?? 0) > 0) return "failed";
    return "running";
  } catch {
    return "unknown";
  }
}

/** Name of the build pod (for streaming logs of the `build` container). */
export async function getBuildPodName(jobName: string): Promise<string | null> {
  const { core } = k8sClients();
  const pods = await core.listNamespacedPod({
    namespace: BUILD_NS,
    labelSelector: `job-name=${jobName}`,
  });
  return pods.items[0]?.metadata?.name ?? null;
}
