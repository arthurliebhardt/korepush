"use client";

import { useEffect, useState } from "react";

type ConfirmOpts = {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
};

// Promise-based replacement for window.confirm: `if (await confirmDialog({…}))`.
// Resolves false if no <ConfirmRoot/> is mounted (it lives in the root layout).
let opener: ((o: ConfirmOpts) => Promise<boolean>) | null = null;
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return opener ? opener(opts) : Promise.resolve(false);
}

export function ConfirmRoot() {
  const [state, setState] = useState<{
    opts: ConfirmOpts;
    resolve: (b: boolean) => void;
  } | null>(null);

  useEffect(() => {
    opener = (opts) =>
      new Promise<boolean>((resolve) => setState({ opts, resolve }));
    return () => {
      opener = null;
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        state.resolve(false);
        setState(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  if (!state) return null;
  const { opts } = state;
  const close = (v: boolean) => {
    state.resolve(v);
    setState(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => close(false)}
      />
      <div
        role="dialog"
        aria-modal
        style={{ animation: "toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1)" }}
        className="surface-overlay relative w-full max-w-sm p-5"
      >
        <h2 className="text-base font-semibold">{opts.title}</h2>
        {opts.body && <p className="mt-2 text-sm text-muted">{opts.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => close(false)}>
            Cancel
          </button>
          <button
            className={opts.danger ? "btn-danger" : "btn-primary"}
            autoFocus
            onClick={() => close(true)}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
