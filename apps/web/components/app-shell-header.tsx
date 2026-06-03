import Link from "next/link";
import { clusterReachable } from "@korepush/k8s";
import { Brand } from "@/components/brand";

export type Crumb = { label: string; href?: string };

// Top bar for the content column: breadcrumb trail (left) + cluster status
// (right). Brand/account/search live in the sidebar on desktop; the brand shows
// here only on mobile (where the sidebar is hidden).
export async function AppShellHeader({ crumbs = [] }: { crumbs?: Crumb[] }) {
  const clusterOk = await clusterReachable().catch(() => false);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-bg-subtle/80 px-5 backdrop-blur">
      <nav className="flex min-w-0 items-center gap-2 text-sm">
        <span className="md:hidden">
          <Brand />
        </span>
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-2">
            <span
              className={`text-fg-faint ${i === 0 ? "md:hidden" : ""}`}
              aria-hidden
            >
              /
            </span>
            {c.href ? (
              <Link
                href={c.href}
                className="truncate text-muted transition-colors hover:text-foreground"
              >
                {c.label}
              </Link>
            ) : (
              <span className="truncate font-medium text-foreground">
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <span
        className={`hidden shrink-0 items-center gap-1.5 text-xs sm:inline-flex ${
          clusterOk ? "text-success-fg" : "text-danger-fg"
        }`}
        title={clusterOk ? "Cluster connected" : "Cluster unreachable"}
      >
        <span
          className={`size-1.5 rounded-full bg-current ${clusterOk ? "" : "animate-pulse"}`}
          aria-hidden
        />
        {clusterOk ? "connected" : "unreachable"}
      </span>
    </header>
  );
}
