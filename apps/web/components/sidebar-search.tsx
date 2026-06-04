"use client";

import { openCommandPalette } from "@/components/ui/command-palette";
import { SearchIcon } from "@/components/ui/icons";

const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// "Find…" box that opens the ⌘K command palette; collapses to an icon button.
export function SidebarSearch({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <button
        onClick={() => openCommandPalette()}
        title="Find… (⌘K)"
        aria-label="Find"
        className={`flex h-8 w-full items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-foreground ${RING}`}
      >
        <SearchIcon />
      </button>
    );
  }
  return (
    <button
      onClick={() => openCommandPalette()}
      className={`flex w-full items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg-subtle transition-colors hover:border-border-strong ${RING}`}
    >
      <SearchIcon />
      Find…
      <span className="ml-auto rounded border border-border px-1 font-mono text-[10px] leading-4">
        ⌘K
      </span>
    </button>
  );
}
