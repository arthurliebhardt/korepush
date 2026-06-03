"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Entry = { kind: string; label: string; sub?: string; href: string };

const STATIC: Entry[] = [
  { kind: "page", label: "Dashboard", href: "/" },
  { kind: "page", label: "Settings", href: "/settings" },
];

// Lets the header hint (or anything) open the palette without prop-drilling.
let setOpenExternal: ((v: boolean) => void) | null = null;
export function openCommandPalette() {
  setOpenExternal?.(true);
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setQuery("");
    setSel(0);
  };

  useEffect(() => {
    setOpenExternal = setOpen;
    return () => {
      setOpenExternal = null;
    };
  }, []);

  // Global ⌘K / Ctrl+K toggle (state changes happen in this event handler, not
  // synchronously inside the effect body).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // On open: focus the input (DOM side-effect) and lazy-load nav targets once
  // (setState only inside the async callback, never synchronously here).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    if (!loaded) {
      fetch("/api/nav")
        .then((r) => (r.ok ? r.json() : { entries: [] }))
        .then((d: { entries?: Entry[] }) => setEntries(d.entries ?? []))
        .catch(() => {})
        .finally(() => setLoaded(true));
    }
    return () => clearTimeout(t);
  }, [open, loaded]);

  const all = useMemo(() => [...STATIC, ...entries], [entries]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) =>
      `${e.label} ${e.sub ?? ""}`.toLowerCase().includes(q),
    );
  }, [all, query]);

  if (!open) return null;

  const go = (entry?: Entry) => {
    const target = entry ?? results[sel];
    if (!target) return;
    close();
    router.push(target.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal
        style={{ animation: "toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1)" }}
        className="surface-overlay relative w-full max-w-lg overflow-hidden"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search spaces, apps…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-fg-subtle"
        />
        <ul className="max-h-80 overflow-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted">
              {loaded ? "No matches" : "Loading…"}
            </li>
          ) : (
            results.map((e, i) => (
              <li key={e.href}>
                <button
                  onClick={() => go(e)}
                  onMouseMove={() => setSel(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                    i === sel ? "bg-surface-2" : ""
                  }`}
                >
                  <span className="w-12 shrink-0 text-xs uppercase text-fg-subtle">
                    {e.kind}
                  </span>
                  <span className="truncate text-foreground">{e.label}</span>
                  {e.sub && (
                    <span className="ml-auto truncate font-mono text-xs text-muted">
                      {e.sub}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-border px-4 py-2 text-xs text-fg-subtle">
          ↑↓ navigate · ↵ open · esc close
        </div>
      </div>
    </div>
  );
}
