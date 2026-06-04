import { SpaceSwitcher, type SwitcherSpace } from "@/components/space-switcher";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarSearch } from "@/components/sidebar-search";
import { UserMenu } from "@/components/user-menu";

// Space-scoped desktop rail (shadcn-style): flush on the page background with no
// border — the rounded inset to its right is the card. Three zones: the space
// switcher, the contextual nav, and a pinned-bottom footer (Find/⌘K, cluster
// health, and the user menu with platform settings + sign out).
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
    <aside className="hidden w-60 shrink-0 flex-col bg-background md:flex">
      <div className="flex h-14 items-center px-2">
        <SpaceSwitcher spaces={spaces} activeSlug={space?.slug} />
      </div>

      <SidebarNav space={space} spaces={spaces} />

      <div className="flex flex-col gap-1 p-2">
        <SidebarSearch />
        <ClusterStatus ok={clusterOk} />
        <UserMenu email={email} />
      </div>
    </aside>
  );
}

export function ClusterStatus({ ok }: { ok: boolean }) {
  return (
    <span
      className={`flex items-center gap-2.5 px-2 py-1 text-xs ${
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
