"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectGithubAccountAction } from "@/app/actions";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";

export type GithubAccount = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  htmlUrl: string | null;
  appCount: number;
};

export function GithubAccounts({
  slug,
  appHtmlUrl,
  installUrl,
  accounts,
}: {
  slug: string;
  appHtmlUrl: string | null;
  installUrl: string;
  accounts: GithubAccount[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function disconnect(acct: GithubAccount) {
    const ok = await confirmDialog({
      title: `Disconnect ${acct.accountLogin}?`,
      body:
        `This uninstalls the korepush app from ${acct.accountLogin} on GitHub — its repos can no longer be deployed or auto-built.` +
        (acct.appCount > 0
          ? ` ${acct.appCount} app${acct.appCount === 1 ? "" : "s"} deploy from it; they keep running but lose auto-deploy until you reconnect.`
          : ""),
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await disconnectGithubAccountAction(acct.installationId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${acct.accountLogin} disconnected`);
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">
          App:{" "}
          <a
            href={appHtmlUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-foreground underline"
          >
            {slug}
          </a>
        </p>
        <a className="btn-primary shrink-0" href={installUrl}>
          Add account or organization
        </a>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted">
          No accounts connected yet. Install the app on a GitHub account or org
          to deploy its repos.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {accounts.map((a) => (
            <li
              key={a.installationId}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <a
                  href={a.htmlUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  {a.accountLogin}
                </a>
                <span className="ml-2 text-xs text-muted">
                  {a.accountType === "Organization" ? "org" : "user"}
                  {a.appCount > 0 &&
                    ` · ${a.appCount} app${a.appCount === 1 ? "" : "s"}`}
                </span>
              </div>
              <button
                className="text-xs text-muted hover:text-danger"
                disabled={pending}
                onClick={() => disconnect(a)}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted">
        Pushes to connected repos auto-deploy matching apps. Private repos are
        cloned with a short-lived installation token. Adding an account opens
        GitHub to choose which repos to grant.
      </p>
    </div>
  );
}
