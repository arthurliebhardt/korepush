import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  pgEnum,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* ──────────────────────────────────────────────────────────
 * better-auth tables
 * ────────────────────────────────────────────────────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  // "admin" for the bootstrap user, "user" otherwise.
  role: text("role").default("user").notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

/* ──────────────────────────────────────────────────────────
 * Domain tables
 * ────────────────────────────────────────────────────────── */

export const resourceStatus = pgEnum("resource_status", [
  "pending",
  "provisioning",
  "running",
  "degraded",
  "failed",
  "stopped",
]);

export const appSource = pgEnum("app_source", ["image", "dockerfile", "git"]);

export const deploymentStatus = pgEnum("deployment_status", [
  "queued",
  "building",
  "deploying",
  "succeeded",
  "failed",
  "canceled",
]);

export const spaces = pgTable("spaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // k8s-safe slug, also used as the namespace name.
  slug: text("slug").notNull().unique(),
  namespace: text("namespace").notNull().unique(),
  status: resourceStatus("status").default("pending").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const apps = pgTable("apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  // Environments of one logical app share a projectId; each environment is its
  // own row (own slug/branch/URL/env/db). The DB default makes every existing &
  // new standalone app its own single-environment project.
  projectId: uuid("project_id").defaultRandom().notNull(),
  environment: text("environment").default("prod").notNull(),
  source: appSource("source").default("image").notNull(),
  // For source=image: the image ref. For git/dockerfile: filled after build.
  image: text("image"),
  repoUrl: text("repo_url"),
  gitRef: text("git_ref").default("main"),
  // Optional Railpack build overrides (null = let Railpack auto-detect).
  installCmd: text("install_cmd"),
  buildCmd: text("build_cmd"),
  startCmd: text("start_cmd"),
  rootDir: text("root_dir"),
  port: integer("port").default(3000).notNull(),
  replicas: integer("replicas").default(1).notNull(),
  // Plain (non-secret) env vars, inlined into the Deployment pod spec.
  env: jsonb("env").$type<Record<string, string>>().default({}).notNull(),
  // Names of secret env vars; their VALUES live only in the per-app k8s Secret
  // `<slug>-env` (never in Postgres), injected via envFrom.secretRef.
  secretKeys: jsonb("secret_keys").$type<string[]>().default([]).notNull(),
  status: resourceStatus("status").default("pending").notNull(),
  githubInstallationId: uuid("github_installation_id").references(
    () => githubInstallations.id,
  ),
  // An attached database's connection string is injected as `dbEnvVar`.
  attachedDbId: uuid("attached_db_id").references((): AnyPgColumn => databases.id, {
    onDelete: "set null",
  }),
  dbEnvVar: text("db_env_var").default("DATABASE_URL").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // The slug is the app's k8s identity (KoreApp CR name, `<slug>-env` Secret,
  // routing). Two apps sharing it in one space would collide onto one set of
  // cluster objects, so enforce uniqueness per space.
  uniqueIndex("apps_space_slug_unique").on(t.spaceId, t.slug),
]);

// Custom domains attached to an app (apex or subdomain). `host` is globally
// UNIQUE — two apps claiming the same host would make Traefik route it
// nondeterministically, so Postgres is the source of truth for uniqueness.
export const appDomains = pgTable("app_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: uuid("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  host: text("host").notNull().unique(),
  // k8s TLS Secret + cert-manager Certificate name for this domain.
  secretName: text("secret_name").notNull(),
  useStaging: boolean("use_staging").default(false).notNull(),
  // pending (DNS not pointing here) | issuing | active | error
  status: text("status").default("pending").notNull(),
  statusMessage: text("status_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type AppDomain = typeof appDomains.$inferSelect;

export const databases = pgTable("databases", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  engine: text("engine").default("postgres").notNull(),
  version: text("version").default("16"),
  status: resourceStatus("status").default("pending").notNull(),
  // Name of the k8s secret holding the connection string.
  connectionSecret: text("connection_secret"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // The slug becomes the CNPG cluster name `db-<slug>`; a per-space collision
  // would silently share one Postgres cluster across two database rows.
  uniqueIndex("databases_space_slug_unique").on(t.spaceId, t.slug),
]);

export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: uuid("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  status: deploymentStatus("status").default("queued").notNull(),
  image: text("image"),
  commitSha: text("commit_sha"),
  // Human-readable trigger: "manual", "push", "import".
  trigger: text("trigger").default("manual").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (t) => [
  // deployments is the one unbounded table (a row per build/deploy/rollback) and
  // is always queried by appId ordered by createdAt desc (build history, latest
  // building). Postgres doesn't auto-index FKs, so add the composite explicitly.
  index("deployments_app_created_idx").on(t.appId, t.createdAt.desc()),
]);

// Singleton config for the platform's GitHub App (created via the manifest
// flow). Secret fields are stored encrypted (see apps/web/lib/github/config).
export const githubApp = pgTable("github_app", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull(),
  slug: text("slug").notNull(),
  privateKey: text("private_key").notNull(),
  webhookSecret: text("webhook_secret").notNull(),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  htmlUrl: text("html_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const githubInstallations = pgTable("github_installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  installationId: text("installation_id").notNull().unique(),
  accountLogin: text("account_login").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof user.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type App = typeof apps.$inferSelect;
export type Database = typeof databases.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
