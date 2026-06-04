import { SpaceSwitcher, type SwitcherSpace } from "@/components/space-switcher";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarSearch } from "@/components/sidebar-search";
import { UserMenu } from "@/components/user-menu";

// Space-scoped desktop rail (shadcn-style): flush on the page background, no
// border. Collapses to an icon-only strip (w-14) when `collapsed`.
export function Sidebar({
  email,
  spaces,
  space,
  clusterOk,
  collapsed,
}: {
  email: string;
  spaces: SwitcherSpace[];
  space?: { slug: string; name: string };
  clusterOk: boolean;
  collapsed: boolean;
}) {
  return (
    <aside
      className={`hidden shrink-0 flex-col bg-background transition-[width] duration-200 ease-out md:flex ${
        collapsed ? "w-14" : "w-60"
      }`}
    >
      <div className="flex h-14 items-center px-2">
        <SpaceSwitcher
          spaces={spaces}
          activeSlug={space?.slug}
          collapsed={collapsed}
        />
      </div>

      <SidebarNav space={space} spaces={spaces} collapsed={collapsed} />

      <div className="flex flex-col gap-1 p-2">
        <SidebarSearch collapsed={collapsed} />
        <ClusterStatus ok={clusterOk} collapsed={collapsed} />
        <UserMenu email={email} collapsed={collapsed} />
      </div>
    </aside>
  );
}

export function ClusterStatus({
  ok,
  collapsed = false,
}: {
  ok: boolean;
  collapsed?: boolean;
}) {
  const dot = (
    <span
      className={`size-1.5 rounded-full bg-current ${ok ? "" : "animate-pulse"}`}
      aria-hidden
    />
  );
  if (collapsed) {
    return (
      <span
        className={`flex justify-center py-1.5 ${ok ? "text-success-fg" : "text-danger-fg"}`}
        title={ok ? "Cluster connected" : "Cluster unreachable"}
      >
        {dot}
      </span>
    );
  }
  return (
    <span
      className={`flex items-center gap-2.5 px-2 py-1 text-xs ${
        ok ? "text-success-fg" : "text-danger-fg"
      }`}
      title={ok ? "Cluster connected" : "Cluster unreachable"}
    >
      {dot}
      {ok ? "Cluster connected" : "Cluster unreachable"}
    </span>
  );
}
