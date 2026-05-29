import type { NextConfig } from "next";
import path from "node:path";

// `next build` / `next dev` run with cwd at this app package (apps/web);
// the monorepo root is two levels up.
const repoRoot = path.join(process.cwd(), "..", "..");

// Single source of truth for env lives at the monorepo root. Load it so the
// dev server / `next start` pick it up (in-cluster, real env vars win and the
// missing file is ignored — loadEnvFile does not override existing vars).
try {
  process.loadEnvFile(path.join(repoRoot, ".env"));
} catch {
  // no root .env (e.g. production container) — env comes from the environment
}

const nextConfig: NextConfig = {
  // Self-contained server bundle for the container image.
  output: "standalone",
  // Trace files from the monorepo root so workspace packages are included.
  outputFileTracingRoot: repoRoot,
  // Transpile the source-only internal TS packages.
  transpilePackages: ["@kubepush/db", "@kubepush/k8s"],
};

export default nextConfig;
