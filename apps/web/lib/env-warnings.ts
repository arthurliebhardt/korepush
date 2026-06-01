/**
 * Plain (non-secret) env vars whose value is an empty string.
 *
 * An explicit "" is almost always a mistake, and for the app's database env var
 * it's an actively harmful one: the operator injects the attached database's
 * connection string only when the app doesn't already declare that var
 * ("explicit env wins"), so a blank DATABASE_URL silently overrides the injected
 * connection and the app never connects — with no error surfaced. We surface it
 * instead, both in the env editor and on the space overview.
 */
export function blankEnvKeys(
  env: Record<string, string> | null | undefined,
): string[] {
  return Object.entries(env ?? {})
    .filter(([, v]) => v === "")
    .map(([k]) => k);
}

/** Human label for a blank-env warning chip, e.g. "DATABASE_URL blank". */
export function blankEnvLabel(keys: string[], dbEnvVar?: string): string {
  if (keys.length === 0) return "";
  if (dbEnvVar && keys.includes(dbEnvVar)) return `${dbEnvVar} blank`;
  if (keys.length === 1) return `${keys[0]} blank`;
  return `${keys.length} blank env vars`;
}
