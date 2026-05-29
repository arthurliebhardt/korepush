import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

const migrationsFolder = process.env.MIGRATIONS_DIR ?? "./drizzle";
await migrate(db, { migrationsFolder });
await sql.end();
console.log("[korepush] migrations complete");
