"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, CheckIcon } from "@/components/ui/icons";

export type CrumbSwitcherItem = {
  label: string;
  href: string;
  active?: boolean;
  sub?: string;
};

// A breadcrumb crumb that doubles as a switcher (the "app ▾" seam): the current
// label + a popover of lateral targets — sibling apps and this project's
// environments — for mouse-free hops the sidebar's space-scoped rail can't do.
export function CrumbSwitcher({
  label,
  items,
  footerHref,
  footerLabel,
}: {
  label: string;
  items: CrumbSwitcherItem[];
  footerHref?: string;
  footerLabel?: string;
}) {
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
        onClick={() => setOpen((o) => !o)}
        className="group flex min-w-0 items-center gap-1 truncate rounded-sm font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-subtle"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-fg-subtle transition-colors group-hover:text-muted">
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{ animation: "toast-in 140ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          className="surface-overlay absolute left-0 top-[calc(100%+6px)] z-40 w-60 overflow-hidden p-1"
        >
          <ul className="max-h-72 overflow-auto">
            {items.map((it) => (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-surface-2 ${
                    it.active
                      ? "bg-surface-2 text-foreground"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.sub && (
                    <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
                      {it.sub}
                    </span>
                  )}
                  {it.active && (
                    <span className="shrink-0 text-fg-subtle">
                      <CheckIcon />
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {footerHref && (
            <div className="mt-1 border-t border-border pt-1">
              <Link
                href={footerHref}
                onClick={() => setOpen(false)}
                className="block rounded-md px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                {footerLabel ?? "View all"}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
