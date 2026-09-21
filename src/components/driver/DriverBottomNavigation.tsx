"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, ListChecks, ClockCounterClockwise, UserCircle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const NAV_ITEMS = [
  { key: "today", label: "Today", href: "/driver", icon: House },
  { key: "trips", label: "Trips", href: "/driver/trips", icon: ListChecks },
  { key: "history", label: "History", href: "/driver/history", icon: ClockCounterClockwise },
  { key: "profile", label: "Profile", href: "/driver/profile", icon: UserCircle },
] as const;

/**
 * Fixed bottom navigation for the driver PWA. Separate from the operations
 * Sidebar entirely — the driver product does not reuse desktop console chrome.
 */
export function DriverBottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="flex min-h-16 shrink-0 items-stretch border-t border-border-subtle bg-surface-elevated"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === "/driver" ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-16 flex-1 flex-col items-center justify-center gap-1",
              isActive ? "text-info-text" : "text-text-muted",
            )}
          >
            <Icon className="size-6" weight={isActive ? "fill" : "regular"} aria-hidden />
            <span className={typography.metadata}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
