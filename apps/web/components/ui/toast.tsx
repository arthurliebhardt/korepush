"use client";

import { useEffect, useState } from "react";

type Kind = "success" | "error" | "info";
type Toast = { id: number; kind: Kind; msg: string };

// Tiny dependency-free toast bus: any client component can call toast.success(…)
// and the single <Toaster/> (mounted in the root layout) renders it.
let listeners: ((t: Toast) => void)[] = [];
let counter = 0;
function emit(kind: Kind, msg: string) {
  const t = { id: ++counter, kind, msg };
  listeners.forEach((l) => l(t));
}
export const toast = {
  success: (msg: string) => emit("success", msg),
  error: (msg: string) => emit("error", msg),
  info: (msg: string) => emit("info", msg),
};

const DOT: Record<Kind, string> = {
  success: "bg-success-fg",
  error: "bg-danger-fg",
  info: "bg-info-fg",
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const l = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(
        () => setToasts((prev) => prev.filter((x) => x.id !== t.id)),
        4000,
      );
    };
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{ animation: "toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          className="surface-overlay pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 text-sm text-foreground"
        >
          <span
            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${DOT[t.kind]}`}
            aria-hidden
          />
          <span className="min-w-0 break-words">{t.msg}</span>
          <button
            className="ml-auto shrink-0 text-fg-subtle transition-colors hover:text-foreground"
            aria-label="Dismiss"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
