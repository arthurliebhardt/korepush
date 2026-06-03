import Link from "next/link";
import { clusterReachable } from "@korepush/k8s";
import { Brand } from "@/components/brand";
import { CommandHint } from "@/components/ui/command-hint";
import { SignOutButton } from "@/components/sign-out-button";

export type Crumb = { label: string; href?: string };

// Persistent shell header for every authed page: brand + breadcrumb trail on the
// left; cluster status, account + sign-out on the right. Self-fetches cluster
// reachability so pages only pass email + crumbs.
export async function AppShellHeader({
  email,
  crumbs = [],
}: {
  email: string;
  crumbs?: Crumb[];
}) {
  const clusterOk = await clusterReachable().catch(() => false);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-bg-subtle/80 px-5 backdrop-blur">
      <nav className="flex min-w-0 items-center gap-2 text-sm">
        {/* On desktop the sidebar carries the brand; show it here only on mobile. */}
        <span className="md:hidden">
          <Brand />
        </span>
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-2">
            <span className="text-fg-faint" aria-hidden>
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

      <div className="flex shrink-0 items-center gap-3 text-sm">
        <CommandHint />
        <span
          className={`hidden items-center gap-1.5 text-xs sm:inline-flex ${
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
        <span className="hidden text-muted sm:inline">{email}</span>
        <Link
          href="/settings"
          className="text-muted transition-colors hover:text-foreground"
        >
          Settings
        </Link>
        <SignOutButton />
      </div>
    </header>
  );
}
