import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { count } from "drizzle-orm";
import { db, schema } from "@korepush/db";

// Origins better-auth will accept requests from. Starts with the configured
// base URL (the IP right after install) and grows as custom domains are added
// via Settings (KOREPUSH_TRUSTED_ORIGINS, comma-separated) — so adding a domain
// never locks you out of the IP, and vice versa.
function trustedOrigins(): string[] {
  const origins = new Set<string>();
  if (process.env.BETTER_AUTH_URL) origins.add(process.env.BETTER_AUTH_URL);
  for (const o of (process.env.KOREPUSH_TRUSTED_ORIGINS ?? "").split(",")) {
    const trimmed = o.trim();
    if (trimmed) origins.add(trimmed);
  }
  return [...origins];
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: trustedOrigins(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        async before(newUser) {
          // First user created becomes the admin. After that, public
          // self-signup is closed — further users come via admin invite.
          const setup = await isSetupComplete();
          if (!setup) {
            return { data: { ...newUser, role: "admin" } };
          }
          throw new APIError("FORBIDDEN", {
            message: "Registration is closed. Ask an admin for an invite.",
          });
        },
      },
    },
  },
  // nextCookies must be the last plugin so it can flush Set-Cookie headers
  // from server actions.
  plugins: [nextCookies()],
});

/** True once the bootstrap admin user exists. */
export async function isSetupComplete(): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(schema.user);
  return (row?.value ?? 0) > 0;
}
