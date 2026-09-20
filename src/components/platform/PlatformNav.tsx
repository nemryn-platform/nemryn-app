"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const ITEMS = [
  { href: "/platform", label: "Overview", exact: true },
  { href: "/platform/organizations", label: "Organizations", exact: false },
  { href: "/platform/activity", label: "Activity", exact: false },
];

export function PlatformNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Platform" className="flex flex-wrap items-center gap-1">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              typography.label,
              "rounded-md px-3 py-1.5 text-chrome-text-secondary hover:bg-chrome-item-hover hover:text-chrome-text-primary",
              active && "bg-chrome-item-active-background text-chrome-item-active-text",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
