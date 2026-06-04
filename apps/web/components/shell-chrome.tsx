"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { AppShellHeader, type Crumb } from "@/components/app-shell-header";
import { PanelLeftIcon } from "@/components/ui/icons";
import type { SwitcherSpace } from "@/components/space-switcher";

// Client shell that owns the sidebar collapse state (icon-rail toggle, like
// shadcn). Initial value comes from the server (cookie) so there's no hydration
// flash; the toggle persists back to the cookie and ⌘B flips it.
export function ShellChrome({
  email,
  spaces,
  space,
  clusterOk,
  crumbs,
  defaultCollapsed,
  children,
}: {
  email: string;
  spaces: SwitcherSpace[];
  space?: { slug: string; name: string };
  clusterOk: boolean;
  crumbs?: Crumb[];
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Persist on change (a side effect, not a synchronous setState in render).
  useEffect(() => {
    try {
      document.cookie = `kp_sidebar=${collapsed ? 1 : 0};path=/;max-age=31536000;samesite=lax`;
    } catch {}
  }, [collapsed]);

  // ⌘B / Ctrl+B toggles the rail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-svh bg-background">
      <Sidebar
        email={email}
        spaces={spaces}
        space={space}
        clusterOk={clusterOk}
        collapsed={collapsed}
      />
      <div className="flex min-w-0 flex-1 flex-col p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg-subtle shadow-md">
          <AppShellHeader
            crumbs={crumbs}
            mobileNav={
              <MobileNav
                email={email}
                spaces={spaces}
                space={space}
                clusterOk={clusterOk}
              />
            }
            leading={
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="hidden size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-subtle md:flex"
                aria-label="Toggle sidebar"
                title="Toggle sidebar (⌘B)"
              >
                <PanelLeftIcon />
              </button>
            }
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
