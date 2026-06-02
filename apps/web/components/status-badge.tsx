// Canonical status taxonomy: maps raw app/deployment/CR phases to a human label
// + a semantic variant. In-progress states pulse; "degraded" is danger, not warn.
type Variant = "success" | "info" | "warn" | "danger" | "neutral";

const VARIANT: Record<string, Variant> = {
  running: "success",
  succeeded: "success",
  active: "success",
  // actively reconciling/deploying — info + pulsing dot
  provisioning: "info",
  building: "info",
  deploying: "info",
  progressing: "info",
  issuing: "info",
  // waiting to start — amber, no pulse
  pending: "warn",
  queued: "warn",
  // problems
  degraded: "danger",
  failed: "danger",
  error: "danger",
  // inert
  stopped: "neutral",
  canceled: "neutral",
};

const LABEL: Record<string, string> = {
  running: "Live",
  succeeded: "Succeeded",
  active: "Active",
  provisioning: "Provisioning",
  building: "Building",
  deploying: "Deploying",
  progressing: "Deploying",
  issuing: "Issuing",
  pending: "Pending",
  queued: "Queued",
  degraded: "Degraded",
  failed: "Failed",
  error: "Error",
  stopped: "Stopped",
  canceled: "Canceled",
};

const STYLE: Record<Variant, string> = {
  success: "bg-success/15 text-success-fg",
  info: "bg-info/15 text-info-fg",
  warn: "bg-warn/15 text-warn-fg",
  danger: "bg-danger/15 text-danger-fg",
  neutral: "bg-surface-2 text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  const variant = VARIANT[key] ?? "neutral";
  const label = LABEL[key] ?? status;
  return (
    <span className={`badge ${STYLE[variant]}`} title={status}>
      <span
        className={`size-1.5 rounded-full bg-current ${variant === "info" ? "animate-pulse" : ""}`}
        aria-hidden
      />
      {label}
    </span>
  );
}
