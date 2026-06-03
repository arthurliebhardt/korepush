import { Brand } from "@/components/brand";
import { SidebarSearch } from "@/components/sidebar-search";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutButton } from "@/components/sign-out-button";

// Vercel-style desktop left rail: identity header, Find (⌘K), global icon nav,
// account pinned at the bottom. Hidden below md (top-bar nav covers small screens).
export function Sidebar({ email }: { email: string }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-bg-subtle md:flex">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <Brand />
        <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          self-hosted
        </span>
      </div>

      <div className="px-3 pt-3">
        <SidebarSearch />
      </div>

      <SidebarNav />

      <div className="border-t border-border p-3">
        <p className="mb-2 truncate px-1 text-xs text-muted" title={email}>
          {email}
        </p>
        <SignOutButton />
      </div>
    </aside>
  );
}
