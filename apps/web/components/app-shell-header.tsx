import Link from "next/link";

export type Crumb = { label: string; href?: string };

// Slim breadcrumb seam for the content column: a second, always-visible
// "where am I" trail (the sidebar switcher is the primary one). The mobile-nav
// hamburger sits to its left; cluster status now lives in the sidebar.
export function AppShellHeader({
  crumbs = [],
  mobileNav,
}: {
  crumbs?: Crumb[];
  mobileNav?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-bg-subtle/80 px-4 backdrop-blur">
      {mobileNav}
      <nav className="flex min-w-0 items-center gap-2 text-sm">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-2">
            {i > 0 && (
              <span className="text-fg-faint" aria-hidden>
                /
              </span>
            )}
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
    </header>
  );
}
