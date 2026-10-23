"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { settingsIcons } from "@/design/icons";
import type { SettingsSection } from "@/lib/operations/settings-sections";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const SETTINGS_ROOT = "/operations/settings";

/**
 * NP-UI-V2-3 / D-13: the Settings sub-navigation frame. Layout only -- it links the EXISTING Settings routes (the same
 * sections, titles and order as the Settings home) and changes no route, guard or permission: every page still runs
 * its own access check. A column beside the page at lg+, a horizontally scrolling row above it below lg. Not shown on
 * the Settings home, whose section cards are already the index. The active section reads by weight, a white segment
 * and a 3px teal marker (Brand Lock v2), never by colour alone; `aria-current="page"` marks it for assistive tech.
 */
export function SettingsSubNav({ sections, children }: { sections: Pick<SettingsSection, "slug" | "title" | "available">[]; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  if (pathname === SETTINGS_ROOT) return <>{children}</>;
  const items = sections.filter((s) => s.available);
  return (
    <div className="grid grid-cols-1 items-start gap-zw-lg lg:grid-cols-[13rem_minmax(0,1fr)]" data-testid="settings-frame">
      <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-0" data-testid="settings-subnav">
        <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          <li className="shrink-0">
            <Link
              href={SETTINGS_ROOT}
              className={cn(typography.bodySmall, "flex items-center gap-2 whitespace-nowrap rounded-sm px-3 py-2 text-text-secondary hover:bg-surface-elevated/70 hover:text-text-primary")}
            >
              All settings
            </Link>
          </li>
          {items.map((s) => {
            const Icon = settingsIcons[s.slug];
            const href = `${SETTINGS_ROOT}/${s.slug}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={s.slug} className="shrink-0">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    typography.bodySmall,
                    "flex items-center gap-2 whitespace-nowrap rounded-sm px-3 py-2 font-medium transition-colors duration-base motion-reduce:transition-none",
                    active
                      ? "bg-surface-elevated font-semibold text-text-link shadow-[inset_3px_0_0_var(--color-text-link)] ring-1 ring-border-subtle"
                      : "text-text-secondary hover:bg-surface-elevated/70 hover:text-text-primary",
                  )}
                >
                  {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
                  {s.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
