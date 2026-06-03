import { Sidebar } from "@/components/sidebar";
import { AppShellHeader, type Crumb } from "@/components/app-shell-header";

// Authed page shell: Vercel-style global-nav sidebar + a content column with the
// top bar and the page's <main>. The sidebar is static global nav (no data), so
// this wrapper just needs the user's email + the page's breadcrumbs.
export function AppShell({
  email,
  crumbs,
  children,
}: {
  email: string;
  crumbs?: Crumb[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar email={email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppShellHeader crumbs={crumbs} />
        {children}
      </div>
    </div>
  );
}
