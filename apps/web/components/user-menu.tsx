"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { GearIcon, ChevronUpDownIcon } from "@/components/ui/icons";

// shadcn-style sidebar footer: a rounded user button (avatar + name/email +
// chevron) that opens an upward popover with account actions.
export function UserMenu({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = email.split("@")[0];

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
        className="flex w-full items-center gap-2 rounded-md p-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-2 text-xs font-semibold text-foreground"
          aria-hidden
        >
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {name}
          </span>
          <span className="block truncate text-xs text-fg-subtle">{email}</span>
        </span>
        <span className="shrink-0 text-fg-subtle">
          <ChevronUpDownIcon />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{ animation: "toast-in 140ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          className="surface-overlay absolute bottom-[calc(100%+6px)] left-0 right-0 z-40 overflow-hidden p-1"
        >
          <div className="border-b border-border px-2 py-1.5">
            <p className="truncate text-xs text-fg-subtle">{email}</p>
          </div>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <span className="text-fg-subtle">
              <GearIcon />
            </span>
            Platform settings
          </Link>
          <button
            onClick={async () => {
              setOpen(false);
              await signOut();
              router.push("/login");
              router.refresh();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
