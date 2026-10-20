"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "@phosphor-icons/react/dist/ssr";
import { IconButton } from "@/components/ui/IconButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { loadRecentNotificationsAction, type RecentNotificationsResult } from "@/app/operations/notifications-actions";
import { deliveryStatusLabel, deliveryStatusTone, notificationEventLabel } from "@/lib/operations/notification-core";
import { formatIntegrationTimestamp } from "@/lib/operations/website-integration-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { HEADER_POPOVER_PANEL, useHeaderPopover } from "./useHeaderPopover";

/**
 * P1-PILOT-UX1 header bell (Organization Admins only -- the existing history is Admin-only in the database). Loads on
 * open (non-blocking), shows the recent notifications Nemryn tried to send with their existing delivery status, and
 * links to the full history. No unread badge: Nemryn has no read / seen model, so none is invented. The existing
 * history carries no entity id, so rows do not link to a specific Request / Trip.
 */
export function NotificationsBell() {
  const { open, setOpen, containerRef, triggerRef, close } = useHeaderPopover();
  const [result, setResult] = useState<RecentNotificationsResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      try {
        setResult(await loadRecentNotificationsAction());
      } catch {
        setResult({ status: "error" });
      }
    });
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        ref={triggerRef}
        label="Notifications"
        title="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="header-notifications"
        icon={<Bell className="size-5" aria-hidden />}
        onClick={() => setOpen((v) => !v)}
        size="sm"
        data-testid="header-notifications-button"
      />
      {open && (
        <div id="header-notifications" role="dialog" aria-label="Notifications" className={HEADER_POPOVER_PANEL} data-testid="header-notifications">
          <p className={cn(typography.label, "border-b border-border-subtle px-3 py-2.5 text-text-primary")}>Notifications</p>
          <div className="max-h-80 overflow-y-auto px-3 py-2" aria-live="polite">
            {pending || result === null ? (
              <p className={cn(typography.bodySmall, "py-2 text-text-muted")}>Loading…</p>
            ) : result.status === "error" || result.status === "not_available" ? (
              <p className={cn(typography.bodySmall, "py-2 text-text-secondary")}>Notifications couldn&apos;t be loaded.</p>
            ) : result.items.length === 0 ? (
              <p className={cn(typography.bodySmall, "py-2 text-text-secondary")}>No recent notifications.</p>
            ) : (
              <ul className="flex flex-col">
                {result.items.map((item, index) => (
                  <li key={`${item.createdAt}-${index}`} className="flex items-start justify-between gap-2 border-t border-border-subtle py-2 first:border-t-0">
                    <div className="min-w-0">
                      <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>{notificationEventLabel(item.event)}</p>
                      <p className={cn(typography.metadata, "text-text-muted")}>{formatIntegrationTimestamp(item.createdAt, result.timezone)}</p>
                    </div>
                    <StatusBadge label={deliveryStatusLabel(item.status)} category={deliveryStatusTone(item.status)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-border-subtle px-3 py-2">
            <Link
              href="/operations/settings/notifications"
              onClick={() => close()}
              className={cn(typography.bodySmall, "text-text-link hover:underline")}
            >
              View notification history
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
