import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";

// Clickable card (like the app cards) → the database detail page, where the
// connection string, console, and delete live.
export function DatabaseCard({
  spaceSlug,
  slug,
  name,
  engine = "postgres",
  status,
  host,
  usedBy = [],
}: {
  spaceSlug: string;
  slug: string;
  name: string;
  engine?: string;
  status: string;
  host: string | null;
  usedBy?: string[];
}) {
  return (
    <Link
      href={`/spaces/${spaceSlug}/databases/${slug}`}
      className="card card-interactive flex items-start justify-between gap-3"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name}</span>
          <span className="text-xs text-muted">{engine}</span>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted">
          {host ?? "Provisioning…"}
        </p>
        <p className="mt-1 text-xs text-fg-subtle">
          {usedBy.length > 0 ? (
            <>
              Used by <span className="text-muted">{usedBy.join(", ")}</span>
            </>
          ) : (
            "Not attached"
          )}
        </p>
      </div>
    </Link>
  );
}
