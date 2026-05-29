import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  pgEnum,
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
  source: appSource("source").default("image").notNull(),
  // For source=image: the image ref. For git/dockerfile: filled after build.
  image: text("image"),
  repoUrl: text("repo_url"),
  gitRef: text("git_ref").default("main"),
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
});

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
});

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
});

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
