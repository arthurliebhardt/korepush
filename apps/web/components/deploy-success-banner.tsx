"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "@/components/ui/toast";
import { CheckIcon } from "@/components/ui/icons";

// The post-deploy "Done" beat: shown on the app page when ?build=<id> resolved
// to a succeeded deployment. Dismissible; drops off on the next navigation.
export function DeploySuccessBanner({
  host,
  attachHref,
}: {
  host: string;
  attachHref?: string;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div
      style={{ animation: "toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1)" }}
      className="mb-6 rounded-lg border border-success/40 bg-success/10 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success-fg text-background">
          <CheckIcon />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Deployed successfully
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <a
              href={`//${host}`}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-xs text-success-fg underline-offset-2 hover:underline"
            >
              {host} ↗
            </a>
            <button
              className="text-xs text-muted transition-colors hover:text-foreground"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`https://${host}`);
                  toast.success("URL copied");
                } catch {
                  toast.error("Couldn't copy");
                }
              }}
            >
              Copy URL
            </button>
            {attachHref && (
              <Link
                href={attachHref}
                className="text-xs text-muted transition-colors hover:text-foreground"
              >
                Add a database →
              </Link>
            )}
          </div>
        </div>
        <button
          onClick={() => setHidden(true)}
          className="shrink-0 text-fg-subtle transition-colors hover:text-foreground"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
