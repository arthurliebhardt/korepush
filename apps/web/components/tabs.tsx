import Link from "next/link";

// Generic URL-driven tab bar (?tab=…). The first tab is the default and links to
// the bare path for a clean URL.
export function Tabs({
  basePath,
  active,
  tabs,
}: {
  basePath: string;
  active: string;
  tabs: { key: string; label: string }[];
}) {
  const first = tabs[0]?.key;
  return (
    <div className="tabbar mb-6 overflow-x-auto">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.key === first ? basePath : `${basePath}?tab=${t.key}`}
          className={`tab whitespace-nowrap ${active === t.key ? "tab-active" : ""}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
