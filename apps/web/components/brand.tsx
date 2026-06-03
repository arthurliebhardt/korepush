import Link from "next/link";

// Single source of truth for the wordmark. `href={null}` renders it inert
// (e.g. on auth screens); otherwise it links home.
export function Brand({ href = "/" }: { href?: string | null }) {
  const mark = (
    <span className="text-base font-bold tracking-tight text-foreground">
      korepush
    </span>
  );
  return href ? (
    <Link href={href} className="transition-opacity hover:opacity-80">
      {mark}
    </Link>
  ) : (
    mark
  );
}
