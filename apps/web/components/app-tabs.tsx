import Link from "next/link";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "logs", label: "Logs" },
  { key: "metrics", label: "Metrics" },
  { key: "deployments", label: "Deployments" },
  { key: "settings", label: "Settings" },
];

// URL-driven tab bar for the app-detail page (?tab=…). Overview is the default,
// so it links to the bare path (clean URL).
export function AppTabs({
  basePath,
  active,
}: {
  basePath: string;
  active: string;
}) {
  return (
    <div className="tabbar mb-6 overflow-x-auto">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.key === "overview" ? basePath : `${basePath}?tab=${t.key}`}
          className={`tab whitespace-nowrap ${active === t.key ? "tab-active" : ""}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
