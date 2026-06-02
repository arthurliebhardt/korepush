/** Lowercase, DNS-1123-safe slug (k8s namespace/name compatible). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * True if `err` is a Postgres unique-violation (SQLSTATE 23505). postgres-js
 * puts the code on `.code`; drizzle wraps it under `.cause`.
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
