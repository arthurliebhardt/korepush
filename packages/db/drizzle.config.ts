import { defineConfig } from "drizzle-kit";

// Built-in .env loader (no dotenv dependency). The single source of truth
// lives at the monorepo root; in-cluster the env comes from real vars instead.
for (const envPath of ["../../.env", ".env"]) {
  try {
    process.loadEnvFile(envPath);
    break;
  } catch {
    // try next candidate
  }
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
