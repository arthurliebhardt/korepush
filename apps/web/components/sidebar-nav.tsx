"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GridIcon,
  BoxIcon,
  DatabaseIcon,
  GlobeIcon,
  GearIcon,
} from "@/components/ui/icons";

const NAV = [
  { href: "/", label: "Spaces", icon: GridIcon, match: (p: string) => p === "/" || p.startsWith("/spaces") },
  { href: "/deployments", label: "Deployments", icon: BoxIcon, match: (p: string) => p.startsWith("/deployments") },
  { href: "/databases", label: "Databases", icon: DatabaseIcon, match: (p: string) => p.startsWith("/databases") },
  { href: "/domains", label: "Domains", icon: GlobeIcon, match: (p: string) => p.startsWith("/domains") },
  { href: "/settings", label: "Settings", icon: GearIcon, match: (p: string) => p.startsWith("/settings") },
];

export function SidebarNav() {
  const path = usePathname() ?? "/";
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const active = match(path);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              active
                ? "bg-surface text-foreground"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <span className={active ? "text-foreground" : "text-fg-subtle"}>
              <Icon />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
