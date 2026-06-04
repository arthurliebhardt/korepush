import Link from "next/link";
import { SpaceSwitcher, type SwitcherSpace } from "@/components/space-switcher";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarSearch } from "@/components/sidebar-search";
import { SignOutButton } from "@/components/sign-out-button";
import { GearIcon } from "@/components/ui/icons";

// Space-scoped desktop rail, three stacked zones:
//   1. Space switcher (the active space + a popover to switch/create)
//   2. Contextual nav — the active space's sections, or the spaces list at root
//   3. A pinned-bottom GLOBAL zone (Find/⌘K, cluster health, account, platform
//      settings) — zero data destinations, so it never competes with the space.
export function Sidebar({
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
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-bg-subtle md:flex">
      <div className="flex h-14 items-center border-b border-border px-2">
        <SpaceSwitcher spaces={spaces} activeSlug={space?.slug} />
      </div>

      <SidebarNav space={space} spaces={spaces} />

      <div className="space-y-2.5 border-t border-border p-3">
        <SidebarSearch />
        <ClusterStatus ok={clusterOk} />
        <Link
          href="/settings"
          className="flex items-center gap-2.5 rounded-md px-1 py-1 text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-subtle"
        >
          <span className="text-fg-subtle">
            <GearIcon />
          </span>
          Platform settings
        </Link>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate px-1 text-xs text-muted" title={email}>
            {email}
          </p>
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}

export function ClusterStatus({ ok }: { ok: boolean }) {
  return (
    <span
      className={`flex items-center gap-2.5 px-1 text-xs ${
        ok ? "text-success-fg" : "text-danger-fg"
      }`}
      title={ok ? "Cluster connected" : "Cluster unreachable"}
    >
      <span
        className={`size-1.5 rounded-full bg-current ${ok ? "" : "animate-pulse"}`}
        aria-hidden
      />
      {ok ? "Cluster connected" : "Cluster unreachable"}
    </span>
  );
}
