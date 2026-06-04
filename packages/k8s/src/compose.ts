import { parse } from "yaml";
import { slugify } from "./util";

// Pure docker-compose → korepush "import plan" mapper. NO side effects — it just
// describes the apps + databases an import WOULD create, plus per-service
// warnings for everything korepush can't (yet) represent. The import action
// re-runs this server-side and never trusts a client-sent plan.

export type ComposeEnvRow = { key: string; value: string; secret: boolean };

export type ComposeAppPlan = {
  service: string; // original compose service name
  slug: string;
  image: string;
  port: number;
  env: ComposeEnvRow[];
  replicas?: number;
  cpuLimit?: string;
  memoryLimit?: string;
  command?: string[];
  args?: string[];
  healthcheck?: {
    test: string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    startPeriod?: number;
  };
  attachDatabaseService?: string; // compose name of the postgres it should use
  warnings: string[];
};

export type ComposeDatabasePlan = {
  service: string;
  slug: string;
  name: string;
};

export type ComposeSkip = { service: string; reason: string };

export type ComposePlan = {
  ok: boolean;
  error?: string;
  apps: ComposeAppPlan[];
  databases: ComposeDatabasePlan[];
  skipped: ComposeSkip[];
  warnings: string[]; // stack-level
};

const SECRET_RE = /(pass|secret|token|key|cred|private)/i;
const POSTGRES_RE = /^(docker\.io\/)?(library\/)?(postgres|postgis|.*\/postgres(ql)?)(:|$|@)/i;
const STATEFUL_RE = /^(docker\.io\/)?(library\/)?(redis|mysql|mariadb|mongo|rabbitmq|memcached|elasticsearch|.*\/(redis|mysql|mariadb|mongo|rabbitmq))(:|$|@)/i;

function isSecretKey(k: string): boolean {
  return SECRET_RE.test(k);
}

// compose `environment` can be a map or a list of "KEY=VAL" / "KEY".
function normalizeEnv(raw: unknown): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const eq = item.indexOf("=");
      if (eq === -1) out.push({ key: item.trim(), value: "" });
      else out.push({ key: item.slice(0, eq).trim(), value: item.slice(eq + 1) });
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out.push({ key: k.trim(), value: v == null ? "" : String(v) });
    }
  }
  return out.filter((e) => e.key);
}

// compose `ports` entries: "8080", "80:8080", "127.0.0.1:80:8080", "53:53/udp".
// We want the CONTAINER-side port (the last numeric segment before any /proto).
function containerPort(entry: unknown): number | null {
  let s: string | null = null;
  if (typeof entry === "number") return entry;
  if (typeof entry === "string") s = entry;
  else if (entry && typeof entry === "object") {
    const t = (entry as { target?: unknown }).target;
    if (typeof t === "number") return t;
    if (typeof t === "string") s = t;
  }
  if (!s) return null;
  const noProto = s.split("/")[0];
  const segs = noProto.split(":");
  const last = segs[segs.length - 1];
  const n = Number(last);
  return Number.isFinite(n) ? n : null;
}

// compose command/entrypoint: array → exec form (as-is); string → shell form.
function toCmd(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const a = raw.filter((x) => typeof x === "string");
    return a.length ? a : undefined;
  }
  if (typeof raw === "string" && raw.trim()) return ["sh", "-c", raw];
  return undefined;
}

// compose healthcheck.test → an exec command. ["CMD", ...] → the rest;
// ["CMD-SHELL", s] / string → ["sh","-c",s]; ["NONE"] → disabled sentinel.
function toHealthTest(raw: unknown): string[] | undefined {
  if (typeof raw === "string" && raw.trim()) return ["sh", "-c", raw];
  if (Array.isArray(raw)) {
    const a = raw.filter((x) => typeof x === "string");
    if (!a.length) return undefined;
    if (a[0] === "NONE") return ["NONE"];
    if (a[0] === "CMD") return a.slice(1);
    if (a[0] === "CMD-SHELL") return ["sh", "-c", a.slice(1).join(" ")];
    return a;
  }
  return undefined;
}

// compose duration ("30s", "1m30s", "100ms") → whole seconds (min 1).
function durationSec(raw: unknown): number | undefined {
  if (typeof raw === "number") return Math.max(1, Math.round(raw));
  if (typeof raw !== "string") return undefined;
  let total = 0;
  let matched = false;
  for (const m of raw.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s|ms|us|ns)/g)) {
    matched = true;
    const n = Number(m[1]);
    const unit = m[2];
    total +=
      unit === "h" ? n * 3600 : unit === "m" ? n * 60 : unit === "s" ? n : n / 1000;
  }
  if (!matched) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(1, Math.round(n)) : undefined;
  }
  return Math.max(1, Math.round(total));
}

function dependsList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  if (raw && typeof raw === "object") return Object.keys(raw as object);
  return [];
}

export function parseComposePlan(yamlText: string): ComposePlan {
  const empty: ComposePlan = {
    ok: false,
    apps: [],
    databases: [],
    skipped: [],
    warnings: [],
  };
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (err) {
    return { ...empty, error: `Invalid YAML: ${err instanceof Error ? err.message : "parse error"}` };
  }
  const services = (doc as { services?: Record<string, unknown> })?.services;
  if (!services || typeof services !== "object") {
    return { ...empty, error: "No `services:` found — is this a docker-compose file?" };
  }

  const warnings: string[] = [];
  if ((doc as { volumes?: unknown }).volumes) {
    warnings.push("Top-level `volumes` are ignored — korepush has no persistent storage yet (except managed Postgres).");
  }
  if ((doc as { configs?: unknown }).configs || (doc as { secrets?: unknown }).secrets) {
    warnings.push("File-mounted `configs`/`secrets` are not supported; use environment variables.");
  }

  const names = Object.keys(services);
  const slugFor = (n: string) => slugify(n);

  // First pass: classify each service as a Postgres database or an app.
  const dbServices = new Set<string>();
  for (const name of names) {
    const svc = services[name] as Record<string, unknown>;
    const image = typeof svc?.image === "string" ? svc.image : "";
    if (image && POSTGRES_RE.test(image)) dbServices.add(name);
  }

  const databases: ComposeDatabasePlan[] = [];
  const apps: ComposeAppPlan[] = [];
  const skipped: ComposeSkip[] = [];

  for (const name of names) {
    const svc = (services[name] ?? {}) as Record<string, unknown>;
    const slug = slugFor(name);
    const image = typeof svc.image === "string" ? svc.image : "";

    if (dbServices.has(name)) {
      databases.push({ service: name, slug, name: slug });
      continue;
    }

    if (svc.build && !image) {
      skipped.push({
        service: name,
        reason: "Builds from a local context aren't supported — create this app from its Git repo afterward.",
      });
      continue;
    }
    if (!image) {
      skipped.push({ service: name, reason: "No `image:` — nothing to deploy." });
      continue;
    }

    const w: string[] = [];

    // Port
    const portList = Array.isArray(svc.ports)
      ? svc.ports
      : Array.isArray(svc.expose)
        ? svc.expose
        : [];
    const ports = portList.map(containerPort).filter((p): p is number => p != null);
    const port = ports[0] ?? 80;
    if (ports.length > 1) w.push(`Only one port is supported — using ${port}, ignoring ${ports.slice(1).join(", ")}.`);

    // Env (mark secrets heuristically)
    let env: ComposeEnvRow[] = normalizeEnv(svc.environment).map((e) => ({
      key: e.key,
      value: e.value,
      secret: isSecretKey(e.key),
    }));
    if (svc.env_file) w.push("`env_file` isn't read at deploy time — inline those vars or add them after import.");

    // Database attach: depends_on a postgres service, or an env value that
    // references one by host.
    const deps = dependsList(svc.depends_on);
    let attachDatabaseService = deps.find((d) => dbServices.has(d));
    if (!attachDatabaseService) {
      for (const e of env) {
        const ref = [...dbServices].find((db) =>
          new RegExp(`(@|//|=|host=)${db}(:|/|$)`, "i").test(e.value) || e.value === db,
        );
        if (ref) {
          attachDatabaseService = ref;
          break;
        }
      }
    }

    // korepush injects DATABASE_URL for the attached db, so drop the compose
    // connection string to avoid a conflicting duplicate.
    if (attachDatabaseService) {
      const dbName = attachDatabaseService;
      const dropped: string[] = [];
      env = env.filter((e) => {
        const isConn =
          e.key.toUpperCase() === "DATABASE_URL" ||
          (/:\/\//.test(e.value) &&
            new RegExp(`@?${dbName}(:|/)`, "i").test(e.value));
        if (isConn) {
          dropped.push(e.key);
          return false;
        }
        return true;
      });
      if (dropped.length) {
        w.push(`Dropped ${dropped.join(", ")} — korepush injects DATABASE_URL for the "${slugFor(dbName)}" database.`);
      }
    }

    // Sibling host rewrite: an env value whose host is another (non-db) service
    // → rewrite to that service's slug on port 80 (the korepush Service port).
    for (const e of env) {
      for (const other of names) {
        if (other === name || dbServices.has(other)) continue;
        const re = new RegExp(`(//|@|host=)${other}(:\\d+)?(/|$)`, "ig");
        if (re.test(e.value)) {
          const before = e.value;
          e.value = e.value.replace(
            new RegExp(`(//|@|host=)${other}(:\\d+)?`, "ig"),
            (_m, p1) => `${p1}${slugFor(other)}:80`,
          );
          if (e.value !== before) {
            w.push(`Rewrote ${e.key} to reach "${slugFor(other)}" on port 80 (korepush services listen on 80).`);
          }
        }
      }
    }

    if (svc.volumes) w.push("`volumes` are ignored — this app's storage is ephemeral (lost on restart).");
    const command = toCmd(svc.entrypoint); // ENTRYPOINT override
    const args = toCmd(svc.command); // CMD override
    let healthcheck: ComposeAppPlan["healthcheck"];
    const hcRaw = (svc.healthcheck ?? {}) as Record<string, unknown>;
    const hcTest = toHealthTest(hcRaw.test);
    if (hcTest && hcTest[0] !== "NONE") {
      healthcheck = {
        test: hcTest,
        interval: durationSec(hcRaw.interval),
        timeout: durationSec(hcRaw.timeout),
        retries: typeof hcRaw.retries === "number" ? hcRaw.retries : undefined,
        startPeriod: durationSec(hcRaw.start_period),
      };
    }
    const deploy = (svc.deploy ?? {}) as Record<string, unknown>;
    const limits = ((deploy.resources as Record<string, unknown>)?.limits ??
      {}) as Record<string, unknown>;
    const cpuLimit = limits.cpus != null ? String(limits.cpus) : undefined;
    const memoryLimit = limits.memory != null ? String(limits.memory) : undefined;
    if (
      (deploy.resources as Record<string, unknown>)?.reservations &&
      !cpuLimit &&
      !memoryLimit
    ) {
      w.push("`deploy.resources.reservations` (requests) aren't applied — set resource limits instead.");
    }
    if (STATEFUL_RE.test(image)) w.push("No managed engine for this datastore — it runs ephemerally with no persistence or backups.");

    const replicas =
      typeof deploy.replicas === "number" ? deploy.replicas : undefined;

    apps.push({
      service: name,
      slug,
      image,
      port,
      env,
      replicas,
      cpuLimit,
      memoryLimit,
      command,
      args,
      healthcheck,
      attachDatabaseService,
      warnings: w,
    });
  }

  // In-batch slug collisions.
  const bySlug = new Map<string, string[]>();
  for (const a of [...apps, ...databases]) {
    const arr = bySlug.get(a.slug) ?? [];
    arr.push(a.service);
    bySlug.set(a.slug, arr);
  }
  for (const [slug, svcs] of bySlug) {
    if (svcs.length > 1)
      warnings.push(`Services ${svcs.join(", ")} all map to the slug "${slug}" — rename to avoid a collision.`);
  }

  if (apps.length === 0 && databases.length === 0) {
    return { ...empty, error: "Nothing importable — every service was skipped (builds/no image)." , skipped };
  }

  return { ok: true, apps, databases, skipped, warnings };
}
