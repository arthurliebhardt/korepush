import { CreateSpace } from "@/components/create-space";

// First-run getting-started flow, shown on the dashboard while the platform has
// no spaces yet (i.e. right after setup). It self-dismisses once the first space
// exists, so it needs no persisted "seen" flag. Steps reflect live state.
export function Onboarding({
  githubConnected,
  githubSlug,
}: {
  githubConnected: boolean;
  githubSlug: string | null;
}) {
  return (
    <div className="card space-y-6 py-8">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Welcome to korepush 👋</h2>
        <p className="text-sm text-muted">
          You’re the admin. Let’s get your first app deployed.
        </p>
      </div>

      <ol className="space-y-5">
        <Step
          n={1}
          done={githubConnected}
          title="Connect GitHub"
          optional
          desc={
            githubConnected
              ? `Connected${githubSlug ? ` as ${githubSlug}` : ""}. Pushes to connected repos auto-deploy.`
              : "Deploy straight from your repos and auto-deploy on push — one click creates the app, no manual setup."
          }
        >
          {!githubConnected && (
            <a className="btn-ghost w-fit" href="/api/github/manifest">
              Connect GitHub
            </a>
          )}
        </Step>

        <Step
          n={2}
          done={false}
          title="Create your first space"
          desc="A space is an isolated environment — its own namespace, quota and limits — that holds your apps and databases."
        >
          <CreateSpace />
        </Step>

        <Step
          n={3}
          done={false}
          muted
          title="Deploy an app"
          desc="Inside a space, deploy from a container image or a GitHub repo. We’ll take you there once your space exists."
        />
      </ol>
    </div>
  );
}

function Step({
  n,
  done,
  muted = false,
  optional = false,
  title,
  desc,
  children,
}: {
  n: number;
  done: boolean;
  muted?: boolean;
  optional?: boolean;
  title: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <li className={`flex gap-3 ${muted ? "opacity-50" : ""}`}>
      <div
        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
          done
            ? "bg-success/15 text-success"
            : "border border-border text-muted"
        }`}
        aria-hidden
      >
        {done ? "✓" : n}
      </div>
      <div className="flex-1 space-y-2">
        <p className="text-sm font-medium">
          {title}
          {optional && (
            <span className="ml-2 text-xs font-normal text-muted">optional</span>
          )}
        </p>
        <p className="text-xs text-muted">{desc}</p>
        {children}
      </div>
    </li>
  );
}
