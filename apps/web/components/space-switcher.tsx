"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSpaceAction } from "@/app/actions";
import { ChevronUpDownIcon, CheckIcon, PlusIcon } from "@/components/ui/icons";

export type SwitcherSpace = {
  slug: string;
  name: string;
  failedApps?: number;
  appCount?: number;
};

// Zone 1 of the sidebar: the active space + a popover to switch / create. The
// active space is derived from the URL (passed as activeSlug), so there's no
// client state to desync — deep links and refreshes always agree.
export function SpaceSwitcher({
  spaces,
  activeSlug,
}: {
  spaces: SwitcherSpace[];
  activeSlug?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = spaces.find((s) => s.slug === activeSlug);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setQ("");
    setCreating(false);
  }

  const filtered = q.trim()
    ? spaces.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()))
    : spaces;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground text-[11px] font-bold text-background"
          aria-hidden
        >
          {(active?.name ?? "k").charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {active ? active.name : "korepush"}
          </span>
          <span className="block truncate text-[11px] text-fg-subtle">
            {active ? "Space" : "self-hosted"}
          </span>
        </span>
        <span className="shrink-0 text-fg-subtle">
          <ChevronUpDownIcon />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{ animation: "toast-in 140ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          className="surface-overlay absolute left-0 right-0 top-[calc(100%+4px)] z-40 overflow-hidden"
        >
          {spaces.length > 4 && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search spaces…"
              className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-fg-subtle"
            />
          )}
          <ul className="max-h-64 overflow-auto py-1">
            <li>
              <Link
                href="/"
                onClick={close}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <span className="grid size-5 place-items-center text-fg-subtle">
                  ⌂
                </span>
                All spaces
              </Link>
            </li>
            {filtered.map((s) => {
              const isActive = s.slug === activeSlug;
              return (
                <li key={s.slug}>
                  <Link
                    href={`/spaces/${s.slug}`}
                    onClick={close}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 ${
                      isActive ? "text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        (s.failedApps ?? 0) > 0 ? "bg-danger-fg" : "bg-success-fg"
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {isActive && (
                      <span className="shrink-0 text-fg-subtle">
                        <CheckIcon />
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-fg-subtle">No matches</li>
            )}
          </ul>
          <div className="border-t border-border p-1">
            {creating ? (
              <CreateSpaceInline
                onDone={() => {
                  close();
                  router.refresh();
                }}
              />
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <PlusIcon />
                New space
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateSpaceInline({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await createSpaceAction(name);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // createSpaceAction revalidates "/"; refresh picks up the new space in the
    // switcher list (it has no slug in its result to navigate to directly).
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-1.5 p-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Space name"
        className="input py-1.5 text-sm"
        required
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        type="submit"
        className="btn-primary w-full py-1.5 text-sm"
        disabled={pending}
      >
        {pending ? "Creating…" : "Create space"}
      </button>
    </form>
  );
}
