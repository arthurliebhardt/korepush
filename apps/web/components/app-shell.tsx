import { cookies } from "next/headers";
import { listSpacesWithStats, clusterReachable } from "@korepush/k8s";
import { ShellChrome } from "@/components/shell-chrome";
import type { Crumb } from "@/components/app-shell-header";

// Authed page shell. Self-fetches the caller's spaces (for the switcher + root
// nav) and cluster health, reads the persisted sidebar-collapsed cookie so the
// rail renders at the right width on first paint, then hands off to the client
// ShellChrome (which owns the collapse toggle).
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
  const [spaces, clusterOk, cookieStore] = await Promise.all([
    listSpacesWithStats(isAdmin ? undefined : userId),
    clusterReachable().catch(() => false),
    cookies(),
  ]);
  const defaultCollapsed = cookieStore.get("kp_sidebar")?.value === "1";

  return (
    <ShellChrome
      email={email}
      spaces={spaces}
      space={space}
      clusterOk={clusterOk}
      crumbs={crumbs}
      defaultCollapsed={defaultCollapsed}
    >
      {children}
    </ShellChrome>
  );
}
