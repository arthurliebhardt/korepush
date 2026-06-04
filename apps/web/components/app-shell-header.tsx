import Link from "next/link";
import {
  CrumbSwitcher,
  type CrumbSwitcherItem,
} from "@/components/crumb-switcher";

export type Crumb = {
  label: string;
  href?: string;
  // When present, this crumb renders as a switcher popover (e.g. the app ▾).
  switcher?: CrumbSwitcherItem[];
  switcherFooterHref?: string;
  switcherFooterLabel?: string;
};

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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
      {mobileNav}
      <nav className="flex min-w-0 items-center gap-2 text-sm">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-2">
            {i > 0 && (
              <span className="text-fg-faint" aria-hidden>
                /
              </span>
            )}
            {c.switcher ? (
              <CrumbSwitcher
                label={c.label}
                items={c.switcher}
                footerHref={c.switcherFooterHref}
                footerLabel={c.switcherFooterLabel}
              />
            ) : c.href ? (
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
