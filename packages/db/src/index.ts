import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

// Reuse the client/db across hot reloads in dev.
const globalForDb = globalThis as unknown as {
  kubepushDb?: DB;
};

function createDb(): DB {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}

/**
 * Lazy database handle. The connection (and the DATABASE_URL check) is
 * deferred until the first query, so importing this module — e.g. during
 * `next build`'s page-data collection — never requires the env to be present.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const instance = (globalForDb.kubepushDb ??= createDb());
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
