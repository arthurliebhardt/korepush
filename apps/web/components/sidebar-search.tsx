"use client";

import { openCommandPalette } from "@/components/ui/command-palette";
import { SearchIcon } from "@/components/ui/icons";

// Vercel-style "Find…" box that opens the ⌘K command palette.
export function SidebarSearch() {
  return (
    <button
      onClick={() => openCommandPalette()}
      className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg-subtle transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-subtle"
    >
      <SearchIcon />
      Find…
      <span className="ml-auto rounded border border-border px-1 font-mono text-[10px] leading-4">
        ⌘K
      </span>
    </button>
  );
}
