import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { desc } from "drizzle-orm";
import { db, schema } from "@korepush/db";

// AES-256-GCM at rest for the GitHub App private key + secrets, keyed off the
// platform's auth secret. (TODO: rotate / move to a dedicated KMS in prod.)
const KEY = scryptSync(
  process.env.BETTER_AUTH_SECRET ?? "korepush-dev-secret",
  "korepush-github",
  32,
);

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decrypt(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const dec = createDecipheriv("aes-256-gcm", KEY, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(buf.subarray(28)), dec.final()]).toString(
    "utf8",
  );
}

export type GithubAppConfig = {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
  clientId: string | null;
  clientSecret: string | null;
  htmlUrl: string | null;
};

/** The platform's GitHub App config (singleton), or null if not connected. */
export async function getAppConfig(): Promise<GithubAppConfig | null> {
  const [row] = await db
    .select()
    .from(schema.githubApp)
    .orderBy(desc(schema.githubApp.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    appId: row.appId,
    slug: row.slug,
    privateKey: decrypt(row.privateKey),
    webhookSecret: decrypt(row.webhookSecret),
    clientId: row.clientId,
    clientSecret: row.clientSecret ? decrypt(row.clientSecret) : null,
    htmlUrl: row.htmlUrl,
  };
}

export async function saveAppConfig(c: {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
  clientId?: string | null;
  clientSecret?: string | null;
  htmlUrl?: string | null;
}): Promise<void> {
  // Singleton: a fresh connection replaces any prior app.
  await db.delete(schema.githubApp);
  await db.insert(schema.githubApp).values({
    appId: c.appId,
    slug: c.slug,
    privateKey: encrypt(c.privateKey),
    webhookSecret: encrypt(c.webhookSecret),
    clientId: c.clientId ?? null,
    clientSecret: c.clientSecret ? encrypt(c.clientSecret) : null,
    htmlUrl: c.htmlUrl ?? null,
  });
}
