"use client";

import { useState } from "react";
import { SpaceSwitcher, type SwitcherSpace } from "@/components/space-switcher";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarSearch } from "@/components/sidebar-search";
import { UserMenu } from "@/components/user-menu";
import { MenuIcon } from "@/components/ui/icons";

// Below md the rail is hidden; this hamburger opens the same three zones as a
// full-height slide-over drawer. Closes itself whenever the route changes.
export function MobileNav({
  email,
  spaces,
  space,
  clusterOk,
}: {
  email: string;
  spaces: SwitcherSpace[];
  space?: { slug: string; name: string };
  clusterOk: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        className="flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-subtle"
        aria-label="Open navigation"
      >
        <MenuIcon />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside
            className="relative flex w-72 max-w-[85vw] flex-col border-r border-border bg-bg-subtle"
            onClick={(e) => {
              // Close the drawer once a nav link is followed.
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            <div className="flex h-14 items-center px-2">
              <SpaceSwitcher spaces={spaces} activeSlug={space?.slug} />
            </div>
            <SidebarNav space={space} spaces={spaces} />
            <div className="flex flex-col gap-1 p-2">
              <SidebarSearch />
              <span
                className={`flex items-center gap-2.5 px-2 py-1 text-xs ${
                  clusterOk ? "text-success-fg" : "text-danger-fg"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full bg-current ${clusterOk ? "" : "animate-pulse"}`}
                  aria-hidden
                />
                {clusterOk ? "Cluster connected" : "Cluster unreachable"}
              </span>
              <UserMenu email={email} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
