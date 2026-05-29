import { fetchRepoFile, detectPort } from "./app";

export type ProjectDetection = {
  framework: string; // human label, e.g. "Next.js", "Dockerfile", "Node"
  builder: "dockerfile" | "railpack";
  detectedPort: number | null;
  scripts: { install?: string; build?: string; start?: string };
  envKeys: string[]; // from .env.example (names only, never values)
  hasCommittedConfig: boolean; // Dockerfile or railpack.json present
  packageManager?: "pnpm" | "yarn" | "npm" | "bun";
};

// First match wins. Each entry: dependency name → framework label.
const FRAMEWORKS: [string, string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@remix-run/react", "Remix"],
  ["@sveltejs/kit", "SvelteKit"],
  ["astro", "Astro"],
  ["@nestjs/core", "NestJS"],
  ["@angular/core", "Angular"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["koa", "Koa"],
  ["vue", "Vue"],
  ["vite", "Vite"],
];

function parseEnvKeys(text: string): string[] {
  const keys: string[] = [];
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.push(key);
  }
  return [...new Set(keys)];
}

/**
 * Best-effort guess at a repo's stack for the guided import. Never throws —
 * returns a "railpack / Unknown" default so detection is a convenience, never a
 * gate. korepush injects PORT=<port> regardless, so the port is advisory.
 */
export async function detectProject(
  repoUrl: string,
  ref = "main",
): Promise<ProjectDetection> {
  const [dockerfile, pkgRaw, railpackJson, envExample, envSample, port] =
    await Promise.all([
      fetchRepoFile(repoUrl, ref, "Dockerfile"),
      fetchRepoFile(repoUrl, ref, "package.json"),
      fetchRepoFile(repoUrl, ref, "railpack.json"),
      fetchRepoFile(repoUrl, ref, ".env.example"),
      fetchRepoFile(repoUrl, ref, ".env.sample"),
      detectPort(repoUrl, ref).catch(() => null),
    ]);

  const envKeys = parseEnvKeys(envExample ?? envSample ?? "");

  let framework = "Unknown";
  const scripts: ProjectDetection["scripts"] = {};
  let packageManager: ProjectDetection["packageManager"];

  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        packageManager?: string;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      framework = FRAMEWORKS.find(([d]) => d in deps)?.[1] ?? "Node";
      scripts.install = undefined;
      scripts.build = pkg.scripts?.build;
      scripts.start = pkg.scripts?.start;
      if (pkg.packageManager?.startsWith("pnpm")) packageManager = "pnpm";
      else if (pkg.packageManager?.startsWith("yarn")) packageManager = "yarn";
      else if (pkg.packageManager?.startsWith("bun")) packageManager = "bun";
    } catch {
      framework = "Node";
    }
  }

  // Lockfile → package manager (when not declared via packageManager field).
  if (!packageManager && pkgRaw) {
    const [pnpm, yarn, bun] = await Promise.all([
      fetchRepoFile(repoUrl, ref, "pnpm-lock.yaml"),
      fetchRepoFile(repoUrl, ref, "yarn.lock"),
      fetchRepoFile(repoUrl, ref, "bun.lockb"),
    ]);
    packageManager = pnpm ? "pnpm" : yarn ? "yarn" : bun ? "bun" : "npm";
  }

  // Non-Node languages (only when there's no package.json).
  if (!pkgRaw) {
    const [py, pyproj, gomod, gemfile, cargo] = await Promise.all([
      fetchRepoFile(repoUrl, ref, "requirements.txt"),
      fetchRepoFile(repoUrl, ref, "pyproject.toml"),
      fetchRepoFile(repoUrl, ref, "go.mod"),
      fetchRepoFile(repoUrl, ref, "Gemfile"),
      fetchRepoFile(repoUrl, ref, "Cargo.toml"),
    ]);
    if (py || pyproj) framework = "Python";
    else if (gomod) framework = "Go";
    else if (gemfile) framework = "Ruby";
    else if (cargo) framework = "Rust";
  }

  const builder: "dockerfile" | "railpack" = dockerfile
    ? "dockerfile"
    : "railpack";
  if (dockerfile) framework = framework === "Unknown" ? "Dockerfile" : framework;

  return {
    framework,
    builder,
    detectedPort: port,
    scripts,
    envKeys,
    hasCommittedConfig: !!dockerfile || !!railpackJson,
    packageManager,
  };
}
