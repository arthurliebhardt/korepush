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
    <div className="flex min-h-full flex-1">
      <Sidebar
        email={email}
        spaces={spaces}
        space={space}
        clusterOk={clusterOk}
      />
      <div className="flex min-w-0 flex-1 flex-col">
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
        {children}
      </div>
    </div>
  );
}
