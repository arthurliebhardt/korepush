import Link from "next/link";
import { InstallCommand } from "@/components/landing/install-command";

const GITHUB = "https://github.com/arthurliebhardt/korepush";

export function LandingPage() {
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <ForAgents />
        <Workflow />
        <Ownership />
        <Databases />
        <Stacks />
        <Operate />
        <Activation />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ─────────────────────────── Nav ─────────────────────────── */

function SiteNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-background/80 backdrop-blur">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          korepush
        </Link>
        <div className="hidden items-center gap-7 text-sm text-muted sm:flex">
          <a href="#agents" className="transition-colors hover:text-foreground">
            For agents
          </a>
          <a href="#workflow" className="transition-colors hover:text-foreground">
            Workflow
          </a>
          <a href="#stacks" className="transition-colors hover:text-foreground">
            Stacks
          </a>
          <a href="#get-started" className="transition-colors hover:text-foreground">
            Install
          </a>
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login" className="btn-ghost hidden sm:inline-flex">
            Sign in
          </Link>
          <a href="#get-started" className="btn-primary">
            Get started
          </a>
        </div>
      </nav>
    </header>
  );
}

/* ─────────────────────────── Hero ─────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border-subtle">
      <div className="mx-auto w-full max-w-6xl px-6 pb-20 pt-20 sm:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="badge border border-border bg-surface text-xs text-muted">
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            Open-source · self-hosted · kubectl-native
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
            Self-hosting for an agentic era
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
            A convenient dashboard for you, kubectl for your agents. korepush runs
            your apps, databases, and domains as plain Kubernetes resources on a
            server you own — drive it by click or by command, with no proprietary
            API in between.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#get-started" className="btn-primary px-5 py-2.5">
              Install on your server
            </a>
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost px-5 py-2.5"
            >
              View on GitHub →
            </a>
          </div>
          <div className="mt-5 flex justify-center">
            <InstallCommand className="max-w-full" />
          </div>
        </div>

        <DeployTerminal />
      </div>
    </section>
  );
}

function DeployTerminal() {
  const log = [
    { t: "12:04:03", text: "koreapp.korepush.io/web created" },
    { t: "12:04:05", text: "operator  ⟳ reconciling KoreApp web" },
    { t: "12:04:09", text: "operator  ✓ Deployment web (1/1 ready)" },
    { t: "12:04:12", text: "operator  ✓ Service + HTTPRoute provisioned" },
    { t: "12:04:18", text: "operator  ✓ TLS certificate issued" },
  ];
  return (
    <div className="surface-overlay mx-auto mt-14 max-w-3xl overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="size-3 rounded-full bg-danger/60" />
        <span className="size-3 rounded-full bg-warn/60" />
        <span className="size-3 rounded-full bg-success/60" />
        <span className="ml-2 font-mono text-xs text-fg-subtle">agent — kubectl</span>
      </div>
      <div className="space-y-1.5 px-5 py-5 font-mono text-[13px] leading-relaxed">
        <p className="text-foreground">
          <span className="select-none text-fg-faint">$ </span>
          kubectl apply -f koreapp.yaml
        </p>
        {log.map((l, i) => (
          <p key={i} className="text-muted-2">
            <span className="mr-3 text-fg-faint">{l.t}</span>
            {l.text}
          </p>
        ))}
        <p className="pt-1 text-success-fg">
          ✓ live at https://web.yourdomain.dev
          <span className="text-fg-subtle"> · 3.1s</span>
          <span className="ml-1 inline-block w-2 animate-pulse text-foreground">▍</span>
        </p>
      </div>
    </div>
  );
}

/* ────────────────────── Section primitives ────────────────────── */

function SectionHead({
  id,
  eyebrow,
  heading,
  sub,
}: {
  id?: string;
  eyebrow?: string;
  heading: string;
  sub: string;
}) {
  return (
    <div id={id} className="mx-auto max-w-2xl scroll-mt-20 text-center">
      {eyebrow && (
        <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        {heading}
      </h2>
      <p className="mt-3 text-muted">{sub}</p>
    </div>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card h-full">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/* ─────────────────────────── Sections ─────────────────────────── */

function ForAgents() {
  const items = [
    { title: "No proprietary API — just Kubernetes", body: "Apps, databases, and spaces are real CRDs in the korepush.io group (KoreApp, KoreDatabase, KoreSpace). An agent operates korepush with kubectl and the Kubernetes API it already knows — nothing custom to wrap or learn." },
    { title: "Declarative and idempotent", body: "Describe the desired state; the operator reconciles it. Re-applying the same manifest is a safe no-op, so an agent's retries and loops never double-act." },
    { title: "Inspectable end to end", body: "kubectl get, describe, logs, and events work on everything korepush creates — they're ordinary Kubernetes objects. Agents debug with the same tools they'd use on any cluster, no black box." },
    { title: "Compose as a desired-state artifact", body: "An agent can generate or edit a docker-compose.yml; korepush diffs it against what's live and applies the add / update / remove. One file an agent can produce, re-run, and reason about." },
  ];
  return (
    <section id="agents" className="scroll-mt-14 border-b border-border-subtle py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHead
          eyebrow="Built for agents"
          heading="The platform your agents already know how to drive"
          sub="korepush is plain Kubernetes underneath — a stable, declarative control surface an agent can operate by command while you watch from the dashboard."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((i) => (
            <FeatureCard key={i.title} {...i} />
          ))}
        </div>
        <div className="mx-auto mt-10 max-w-2xl">
          <div className="surface-overlay overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <span className="size-3 rounded-full bg-danger/60" />
              <span className="size-3 rounded-full bg-warn/60" />
              <span className="size-3 rounded-full bg-success/60" />
              <span className="ml-2 font-mono text-xs text-fg-subtle">koreapp.yaml</span>
            </div>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed text-muted-2">
{`apiVersion: korepush.io/v1alpha1
kind: KoreApp
metadata:
  name: web
spec:
  image: ghcr.io/acme/web:latest
  port: 3000
  database: { name: main }     # connection string injected
  domains: [{ host: web.acme.dev }]`}
            </pre>
          </div>
          <p className="mt-3 text-center text-xs text-fg-subtle">
            One resource. The operator turns it into a Deployment, Service,
            HTTPS route, and an injected database URL.
          </p>
        </div>
      </div>
    </section>
  );
}

function Workflow() {
  const items = [
    { title: "Push to deploy", body: "Connect a Git repo and every push to main ships automatically. The build is auto-detected from your Dockerfile or buildpack — no YAML, no pipeline to wire up." },
    { title: "Live build logs", body: "Watch the build stream line by line, then get a per-app subdomain on HTTPS the moment it goes green." },
    { title: "Repo, image, or compose", body: "Prefer a prebuilt container image or a docker-compose.yml? Point korepush at either and it deploys the same way." },
    { title: "One-click rollback", body: "Bad deploy? Roll back to the previous image instantly — no git revert gymnastics, no downtime drama." },
  ];
  return (
    <section className="border-b border-border-subtle py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHead
          id="workflow"
          heading="The workflow you already know"
          sub="korepush mirrors the push-to-deploy loop you reach for on Vercel and Railway — there's nothing new to learn."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((i) => (
            <FeatureCard key={i.title} {...i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Ownership() {
  const items = [
    { title: "One Linux box, one command", body: "Runs on a single server — a cheap Hetzner-class or DIY VM — installed with one command. No control plane to stand up, no Kubernetes to learn." },
    { title: "Your data never leaves", body: "Source, images, databases, secrets, and logs all live on your machine. No third-party tenant, no data egress — it's your box." },
    { title: "A flat bill, not a graph", body: "You pay for the VM, not per seat, per build minute, or per GB served. Add your whole team without a new invoice." },
    { title: "Open source, zero lock-in", body: "Audit it, fork it, run it forever. Underneath it's plain k3s + CRDs and OCI images, so leaving is a kubectl and a docker push away." },
  ];
  return (
    <section className="border-b border-border-subtle py-20 sm:py-24">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Ownership
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            …on infrastructure that&apos;s actually yours
          </h2>
          <p className="mt-3 text-muted">
            Same developer experience — but the box, the data, and the bill are all
            under your control.
          </p>
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost mt-6 inline-flex"
          >
            Read the source →
          </a>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((i) => (
            <FeatureCard key={i.title} {...i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Databases() {
  const items = [
    { title: "Managed Postgres & Redis", body: "Postgres on CloudNativePG and Redis spin up in one click, with the connection string auto-injected into your app as DATABASE_URL / REDIS_URL." },
    { title: "Persistent volumes", body: "Real PVCs for stateful apps that survive restarts and redeploys — no fiddling with Kubernetes storage by hand." },
    { title: "Secrets & registries", body: "Env and secrets management, private registry credentials, resource limits, and health checks are all built into the dashboard." },
    { title: "Custom domains + HTTPS", body: "Bring your own domain and get automatic Let's Encrypt certificates, plus a per-app subdomain out of the box." },
  ];
  return (
    <section className="border-b border-border-subtle py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHead
          heading="Databases and state, provisioned in a click"
          sub="The part most self-hosting setups make painful, done the managed way."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((i) => (
            <FeatureCard key={i.title} {...i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Stacks() {
  const compose = `services:
  web:
    image: nginx:alpine
    ports: ["80"]
  api:
    image: myorg/api:latest
    depends_on: [db]
  db:
    image: postgres:16
  cache:
    image: redis:7
    volumes: ["cachedata:/data"]`;
  const items = [
    { title: "Compose becomes a stack", body: "Services fan out to apps; postgres and redis are recognized and provisioned as managed databases, with env wired for you." },
    { title: "Atomic create & delete", body: "The whole stack stands up together and tears down clean, with one aggregate health view across every service." },
    { title: "Re-import diffing", body: "Paste an updated compose and korepush diffs it against what's live, then applies add / update / remove changes." },
    { title: "A confirm gate before damage", body: "Destructive changes — dropping a service or a volume — sit behind an explicit confirm gate. No silent teardowns." },
  ];
  return (
    <section id="stacks" className="scroll-mt-14 border-b border-border-subtle py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHead
          heading="Paste a compose file, get a running stack"
          sub="Your existing docker-compose.yml becomes a named stack — apps and databases that create, delete, and report health together."
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-2 lg:items-center">
          <div className="surface-overlay overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <span className="size-3 rounded-full bg-danger/60" />
              <span className="size-3 rounded-full bg-warn/60" />
              <span className="size-3 rounded-full bg-success/60" />
              <span className="ml-2 font-mono text-xs text-fg-subtle">
                docker-compose.yml
              </span>
            </div>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed text-muted-2">
              {compose}
            </pre>
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 text-xs">
              <span className="text-fg-subtle">→</span>
              <span className="badge bg-surface-2 text-muted">app web</span>
              <span className="badge bg-surface-2 text-muted">app api</span>
              <span className="badge bg-info/15 text-info-fg">db postgres</span>
              <span className="badge bg-info/15 text-info-fg">db redis</span>
              <span className="badge bg-success/15 text-success-fg">stack live</span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((i) => (
              <FeatureCard key={i.title} {...i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Operate() {
  const items = [
    { title: "Spaces", body: "Isolated environments (real Kubernetes namespaces) per project, team, or staging vs. prod." },
    { title: "Live metrics", body: "CPU, memory, and restart metrics per app, alongside streamed build and runtime logs you can follow and download." },
    { title: "Managed operator", body: "Bundled k3s and an operator continuously reconcile your apps, databases, volumes, and routes to the state you declared — you never write a manifest." },
    { title: "Aggregate health", body: "One health view across a stack so a single bad service is visible at a glance, with one-click rollback to recover." },
  ];
  return (
    <section className="border-b border-border-subtle py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHead
          heading="A real platform, not a pile of kubectl aliases"
          sub="The operational surface you expect from a managed platform — without ever touching Kubernetes."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((i) => (
            <FeatureCard key={i.title} {...i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Activation() {
  const steps = [
    { title: "Run one command", body: "The installer provisions k3s, the operator, ingress, and TLS on a fresh VPS." },
    { title: "Create your admin account", body: "Open the dashboard, set up your account, and you're ready to deploy — no extra tooling." },
    { title: "Connect and push", body: "Connect a repo, paste a compose file, or point at an image. Your first app is live on HTTPS in minutes." },
    { title: "Grow when you need to", body: "Add apps, databases, and spaces from one dashboard. It's plain Kubernetes underneath — portable, not proprietary." },
  ];
  return (
    <section id="get-started" className="scroll-mt-14 border-b border-border-subtle py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHead
          heading="From bare VM to your own PaaS in minutes"
          sub="No control plane to wire up, no Kubernetes to learn — install and start shipping."
        />
        <div className="mt-8 flex justify-center">
          <InstallCommand />
        </div>
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="card h-full">
              <div className="flex size-7 items-center justify-center rounded-full border border-border text-xs font-medium text-muted">
                {i + 1}
              </div>
              <h3 className="mt-3 text-sm font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="py-24">
      <div className="mx-auto w-full max-w-4xl px-6">
        <div className="surface-overlay px-8 py-14 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            Your platform, your server, your rules.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            Run one command and git push your first app in minutes. Keep the
            push-to-deploy workflow you already love — minus the metered bill, minus
            the lock-in.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#get-started" className="btn-primary px-5 py-2.5">
              Install on your server
            </a>
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost px-5 py-2.5"
            >
              Star on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted sm:flex-row">
        <span className="font-semibold tracking-tight text-foreground">korepush</span>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <a href={GITHUB} target="_blank" rel="noreferrer" className="hover:text-foreground">
            GitHub
          </a>
          <a href="#get-started" className="hover:text-foreground">
            Install
          </a>
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
        </div>
        <span className="text-fg-subtle">Open source · run it forever</span>
      </div>
    </footer>
  );
}
