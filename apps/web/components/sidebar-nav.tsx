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

const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Zone 2 of the sidebar. With an active space it renders that space's sections
// (every href a child of /spaces/[slug]); at the root it doubles as the spaces
// list. Collapses to icon/avatar-only with native tooltips.
export function SidebarNav({
  space,
  spaces,
  collapsed = false,
}: {
  space?: { slug: string; name: string };
  spaces: NavSpace[];
  collapsed?: boolean;
}) {
  const path = usePathname() ?? "/";

  if (!space) {
    return (
      <nav
        className={`flex-1 space-y-0.5 overflow-y-auto py-3 ${collapsed ? "px-2" : "px-3"}`}
      >
        {!collapsed && (
          <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
            Spaces
          </p>
        )}
        {spaces.length === 0
          ? !collapsed && (
              <p className="px-3 py-2 text-xs text-fg-subtle">No spaces yet</p>
            )
          : spaces.map((s) => {
              const active = path === `/spaces/${s.slug}`;
              if (collapsed) {
                return (
                  <Link
                    key={s.slug}
                    href={`/spaces/${s.slug}`}
                    title={s.name}
                    className={`flex h-9 items-center justify-center rounded-md transition-colors hover:bg-surface-2 ${RING} ${active ? "bg-surface" : ""}`}
                  >
                    <span className="grid size-6 place-items-center rounded-md bg-surface-2 text-[11px] font-semibold text-foreground">
                      {s.name.charAt(0).toUpperCase()}
                    </span>
                  </Link>
                );
              }
              return (
                <Link
                  key={s.slug}
                  href={`/spaces/${s.slug}`}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${RING} ${
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
            })}
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
    <nav
      className={`flex-1 space-y-0.5 overflow-y-auto py-3 ${collapsed ? "px-2" : "px-3"}`}
    >
      {items.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          title={collapsed ? label : undefined}
          className={`relative flex items-center rounded-md text-sm transition-colors ${RING} ${
            collapsed ? "h-9 justify-center" : "gap-2.5 px-3 py-1.5"
          } ${
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
          {!collapsed && label}
        </Link>
      ))}
    </nav>
  );
}
