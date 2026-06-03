import { listSpaces, listSpacesForUser } from "@korepush/k8s";
import { Sidebar } from "@/components/sidebar";
import { AppShellHeader, type Crumb } from "@/components/app-shell-header";

// Authed page shell: desktop sidebar (spaces switcher) + a content column with
// the top bar and the page's <main>. Fetches the space list for the sidebar
// (owner-scoped). Pages render <AppShell …><main>…</main></AppShell>.
export async function AppShell({
  email,
  isAdmin,
  userId,
  activeSpaceSlug,
  crumbs,
  children,
}: {
  email: string;
  isAdmin: boolean;
  userId: string;
  activeSpaceSlug?: string;
  crumbs?: Crumb[];
  children: React.ReactNode;
}) {
  const spaceRows = isAdmin
    ? await listSpaces()
    : await listSpacesForUser(userId);
  const spaces = spaceRows.map((s) => ({ slug: s.slug, name: s.name }));

  return (
    <div className="flex min-h-full flex-1">
      <Sidebar spaces={spaces} activeSlug={activeSpaceSlug} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppShellHeader email={email} crumbs={crumbs} />
        {children}
      </div>
    </div>
  );
}
