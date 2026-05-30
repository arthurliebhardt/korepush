// Runs once when the control-plane server starts. Ensures every app's Gateway
// HTTPRoute + cert exists (no Deployment churn) so a rollout/upgrade brings all
// apps onto the Gateway API. Best-effort — never blocks startup.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.KUBERNETES_SERVICE_HOST) return; // only in-cluster
  try {
    const { ensureAllAppRoutes, startReconciler } = await import("@korepush/k8s");
    await ensureAllAppRoutes(); // immediate pass on boot
    startReconciler(); // periodic drift correction thereafter
  } catch {
    // ignore — apps also get their routes on next reconcile
  }
}
