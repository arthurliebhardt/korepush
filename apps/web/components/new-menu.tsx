"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BoxIcon, DatabaseIcon, ChevronDownIcon } from "@/components/ui/icons";

// The single contextual creation entry for a space — replaces the two competing
// white CTAs. Deploy app routes to the full-page wizard; Create database routes
// to the space's Databases section (inline create lives there).
export function NewMenu({ spaceSlug }: { spaceSlug: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        className="btn-primary inline-flex items-center gap-1.5"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        New
        <ChevronDownIcon />
      </button>
      {open && (
        <div
          role="menu"
          style={{ animation: "toast-in 140ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          className="surface-overlay absolute right-0 top-[calc(100%+6px)] z-40 w-52 overflow-hidden p-1"
        >
          <Link
            href={`/spaces/${spaceSlug}/new`}
            onClick={() => setOpen(false)}
            className="flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            <span className="mt-0.5 text-fg-subtle">
              <BoxIcon />
            </span>
            <span>
              <span className="block text-foreground">Deploy app</span>
              <span className="block text-xs text-fg-subtle">
                From a Git repo or image
              </span>
            </span>
          </Link>
          <Link
            href={`/spaces/${spaceSlug}/databases`}
            onClick={() => setOpen(false)}
            className="flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            <span className="mt-0.5 text-fg-subtle">
              <DatabaseIcon />
            </span>
            <span>
              <span className="block text-foreground">Create database</span>
              <span className="block text-xs text-fg-subtle">
                Postgres in this space
              </span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
