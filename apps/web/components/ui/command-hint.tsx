"use client";

import { openCommandPalette } from "@/components/ui/command-palette";

// Clickable ⌘K affordance for the shell header (also makes the palette
// discoverable + reachable without a keyboard).
export function CommandHint() {
  return (
    <button
      onClick={() => openCommandPalette()}
      title="Command palette (⌘K)"
      aria-label="Open command palette"
      className="hidden items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-xs text-fg-subtle transition-colors hover:border-border-strong hover:text-muted sm:inline-flex"
    >
      ⌘K
    </button>
  );
}
