import Link from "next/link";
import { Brand } from "@/components/brand";

type SpaceLink = { slug: string; name: string };

// Desktop-only left rail: brand + a quick switcher over the user's spaces +
// Settings. Hidden below md (the top-bar breadcrumbs cover small screens).
export function Sidebar({
  spaces,
  activeSlug,
}: {
  spaces: SpaceLink[];
  activeSlug?: string;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-bg-subtle md:flex">
      <div className="flex h-14 items-center border-b border-border px-5">
        <Brand />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <SidebarLink href="/" label="All spaces" active={!activeSlug} />
        <div className="mt-4 mb-1 px-3 text-xs font-medium uppercase tracking-wide text-fg-subtle">
          Spaces
        </div>
        {spaces.length === 0 ? (
          <p className="px-3 py-1 text-xs text-fg-subtle">No spaces yet</p>
        ) : (
          spaces.map((s) => (
            <SidebarLink
              key={s.slug}
              href={`/spaces/${s.slug}`}
              label={s.name}
              active={s.slug === activeSlug}
            />
          ))
        )}
      </nav>
      <div className="border-t border-border px-3 py-3">
        <SidebarLink href="/settings" label="Settings" />
      </div>
    </aside>
  );
}

function SidebarLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`relative block truncate rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-surface text-foreground"
          : "text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {active && (
        <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-ring" />
      )}
      {label}
    </Link>
  );
}
