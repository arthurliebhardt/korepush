// Runs once when the control-plane server starts. One-time, idempotent backfill
// that adopts every existing app into a KoreApp CR so the operator reconciles
// it (a metadata-only ownerReference stamp — no pod churn). The operator owns
// continuous reconcile/drift-healing thereafter. Best-effort — never blocks startup.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.KUBERNETES_SERVICE_HOST) return; // only in-cluster
  try {
    const { backfillKoreApps } = await import("@korepush/k8s");
    await backfillKoreApps();
  } catch {
    // ignore — the operator's resync also adopts CRs once they exist
  }
}
