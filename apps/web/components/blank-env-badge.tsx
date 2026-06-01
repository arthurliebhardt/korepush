import { blankEnvLabel } from "@/lib/env-warnings";

/**
 * Amber chip flagging an app whose env has blank (empty-string) values — shown
 * on the space overview. A blank database env var is called out specifically
 * because it suppresses the connection string injected on attach.
 */
export function BlankEnvBadge({
  keys,
  dbEnvVar,
}: {
  keys: string[];
  dbEnvVar?: string;
}) {
  if (keys.length === 0) return null;
  const dbBlank = !!dbEnvVar && keys.includes(dbEnvVar);
  const title = dbBlank
    ? `${dbEnvVar} is set to an empty value. It overrides the connection string injected when a database is attached, so the app can't connect. Open the app and remove the empty ${dbEnvVar} variable.`
    : `Empty env value${keys.length > 1 ? "s" : ""}: ${keys.join(", ")}. An explicit empty value is usually a mistake.`;
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-0.5 text-xs font-medium text-warn"
    >
      <span className="size-1.5 rounded-full bg-current" />
      {blankEnvLabel(keys, dbEnvVar)}
    </span>
  );
}
