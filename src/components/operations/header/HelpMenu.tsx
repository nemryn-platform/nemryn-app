"use client";

import Link from "next/link";
import { Question } from "@phosphor-icons/react/dist/ssr";
import { IconButton } from "@/components/ui/IconButton";
import { helpLinksFor, type HelpRole } from "@/lib/operations/header-help-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { HEADER_POPOVER_PANEL, useHeaderPopover } from "./useHeaderPopover";

/** P1-PILOT-UX1 Help & support: role-aware quick paths to existing Operations screens (no articles, no support contact). */
export function HelpMenu({ role }: { role: HelpRole }) {
  const { open, setOpen, containerRef, triggerRef, close } = useHeaderPopover();
  const links = helpLinksFor(role);
  if (links.length === 0) return null;
  return (
    <div ref={containerRef} className="relative">
      <IconButton
        ref={triggerRef}
        label="Help"
        title="Help & support"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="header-help"
        icon={<Question className="size-5" aria-hidden />}
        onClick={() => setOpen((v) => !v)}
        size="sm"
        data-testid="header-help-button"
      />
      {open && (
        <div id="header-help" role="menu" aria-label="Help & support" className={HEADER_POPOVER_PANEL} data-testid="header-help">
          <p className={cn(typography.label, "border-b border-border-subtle px-3 py-2.5 text-text-primary")}>Help &amp; support</p>
          <ul className="py-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  role="menuitem"
                  onClick={() => close()}
                  className="block px-3 py-2 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                >
                  <span className={cn(typography.bodySmall, "block font-medium text-text-primary")}>{link.label}</span>
                  <span className={cn(typography.metadata, "block text-text-muted")}>{link.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
