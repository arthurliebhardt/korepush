"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayersIcon,
  BoxIcon,
  DatabaseIcon,
  GlobeIcon,
  GearIcon,
} from "@/components/ui/icons";

type NavSpace = { slug: string; name: string; failedApps?: number };

// Zone 2 of the sidebar. With an active space it renders that space's own
// sections (every href a child of /spaces/[slug] — a database can never be
// pointed at outside its space). At the root it doubles as the spaces list.
export function SidebarNav({
  space,
  spaces,
}: {
  space?: { slug: string; name: string };
  spaces: NavSpace[];
}) {
  const path = usePathname() ?? "/";

  if (!space) {
    return (
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
          Spaces
        </p>
        {spaces.length === 0 ? (
          <p className="px-3 py-2 text-xs text-fg-subtle">No spaces yet</p>
        ) : (
          spaces.map((s) => {
            const active = path === `/spaces/${s.slug}`;
            return (
              <Link
                key={s.slug}
                href={`/spaces/${s.slug}`}
                className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-surface text-foreground"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    (s.failedApps ?? 0) > 0 ? "bg-danger-fg" : "bg-success-fg"
                  }`}
                  aria-hidden
                />
                <span className="truncate">{s.name}</span>
              </Link>
            );
          })
        )}
      </nav>
    );
  }

  const base = `/spaces/${space.slug}`;
  const items = [
    { href: base, label: "Overview", icon: LayersIcon, active: path === base },
    {
      href: `${base}/apps`,
      label: "Apps",
      icon: BoxIcon,
      active: path.startsWith(`${base}/apps`) || path === `${base}/new`,
    },
    {
      href: `${base}/databases`,
      label: "Databases",
      icon: DatabaseIcon,
      active: path.startsWith(`${base}/databases`),
    },
    {
      href: `${base}/domains`,
      label: "Domains",
      icon: GlobeIcon,
      active: path.startsWith(`${base}/domains`),
    },
    {
      href: `${base}/settings`,
      label: "Settings",
      icon: GearIcon,
      active: path.startsWith(`${base}/settings`),
    },
  ];

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {items.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          className={`relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
            active
              ? "bg-surface text-foreground"
              : "text-muted hover:bg-surface-2 hover:text-foreground"
          }`}
        >
          {active && (
            <span
              className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-ring"
              aria-hidden
            />
          )}
          <span className={active ? "text-foreground" : "text-fg-subtle"}>
            <Icon />
          </span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
