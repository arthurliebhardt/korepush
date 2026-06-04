import { listSpacesWithStats, clusterReachable } from "@korepush/k8s";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { AppShellHeader, type Crumb } from "@/components/app-shell-header";

// Authed page shell: the space-scoped rail + a content column with the slim
// breadcrumb header and the page's <main>. The shell self-fetches the caller's
// spaces (for the switcher + root nav) and cluster health, so pages only pass
// their email, the active space (if any), and breadcrumbs.
export async function AppShell({
  email,
  userId,
  isAdmin,
  space,
  crumbs,
  children,
}: {
  email: string;
  userId: string;
  isAdmin: boolean;
  space?: { slug: string; name: string };
  crumbs?: Crumb[];
  children: React.ReactNode;
}) {
  const [spaces, clusterOk] = await Promise.all([
    listSpacesWithStats(isAdmin ? undefined : userId),
    clusterReachable().catch(() => false),
  ]);

  return (
    <div className="flex h-svh bg-background">
      <Sidebar
        email={email}
        spaces={spaces}
        space={space}
        clusterOk={clusterOk}
      />
      {/* shadcn SidebarInset: the main area is a rounded, bordered panel that
          floats on the page background with a small gap, scrolling internally. */}
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
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
