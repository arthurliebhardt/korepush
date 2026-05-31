const STYLES: Record<string, string> = {
  running: "bg-success/15 text-success",
  succeeded: "bg-success/15 text-success",
  provisioning: "bg-warn/15 text-warn",
  pending: "bg-warn/15 text-warn",
  queued: "bg-warn/15 text-warn",
  building: "bg-warn/15 text-warn",
  deploying: "bg-warn/15 text-warn",
  progressing: "bg-warn/15 text-warn",
  degraded: "bg-warn/15 text-warn",
  failed: "bg-danger/15 text-danger",
  stopped: "bg-zinc-500/15 text-muted",
  canceled: "bg-zinc-500/15 text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? "bg-zinc-500/15 text-muted";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
