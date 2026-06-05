"use client";

import { useState } from "react";

export const INSTALL_COMMAND = "curl -sfL https://get.korepush.dev | sudo bash";

export function InstallCommand({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(INSTALL_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <button
      onClick={copy}
      className={`group inline-flex items-center gap-3 rounded-lg border border-border bg-bg-subtle px-4 py-2.5 font-mono text-sm text-foreground transition-colors hover:border-border-strong ${className}`}
      aria-label="Copy install command"
    >
      <span className="select-none text-fg-faint">$</span>
      <span className="truncate">{INSTALL_COMMAND}</span>
      <span
        className={`ml-1 shrink-0 text-xs ${copied ? "text-success-fg" : "text-fg-subtle group-hover:text-muted"}`}
      >
        {copied ? "copied ✓" : "copy"}
      </span>
    </button>
  );
}
