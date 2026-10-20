"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CaretDown, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { navIcons } from "@/design/icons";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { GROWTH_CHILDREN, GROWTH_ROOT, isGrowthChildActive, isGrowthRoute } from "@/lib/plus/growth-nav-core";

import { navItemActive as itemActive, navItemBase as itemBase, navItemIdle as itemIdle } from "@/components/operations/nav-styles";

/**
 * NP-P2-S2: the Growth group of the EXISTING Operations sidebar (no second sidebar or shell). Rendered only when the
 * server authorized Growth for this person (canAccessGrowth) -- every Growth route and every database call still
 * re-checks access, so expanding the group never exposes anything.
 *
 * Expanded sidebar (labels visible):
 *   - the Growth LABEL is a link to the Dashboard (/operations/growth) and also expands the group;
 *   - the chevron is a separate button that only expands / collapses the children (aria-expanded / aria-controls);
 *   - the group expands automatically whenever a Growth route becomes active (incl. back / forward navigation);
 *   - collapsing never navigates.
 * Icon-only rail (tablet width, or the sidebar collapsed): the Growth icon is a disclosure button that opens a small,
 * fixed-position flyout of the same links (keyboard: Enter / Space opens and focuses the first link, Escape closes and
 * returns focus, Tab out or an outside click closes). Never hover-only, never a dead icon.
 */
export function GrowthNavGroup({ pathname, collapsed }: { pathname: string; collapsed: boolean }) {
  const onGrowth = isGrowthRoute(pathname);
  const [open, setOpen] = useState(onGrowth);
  const [flyout, setFlyout] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const listId = useId();
  const flyoutId = useId();
  const railButton = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  // Auto-expand on any Growth route (navigation, back / forward). A manual collapse holds until the route changes.
  // Adjusted during render on a pathname change (React's "storing information from previous renders" pattern).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (isGrowthRoute(pathname)) setOpen(true);
    setFlyout(false);
  }

  const closeFlyout = useCallback((returnFocus: boolean) => {
    setFlyout(false);
    if (returnFocus) railButton.current?.focus();
  }, []);

  const openFlyout = useCallback(() => {
    const r = railButton.current?.getBoundingClientRect();
    if (r) setFlyoutPos({ top: r.top, left: r.right + 8 });
    setFlyout(true);
  }, []);

  useEffect(() => {
    if (!flyout) return;
    flyoutRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFlyout(true);
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!flyoutRef.current?.contains(t) && !railButton.current?.contains(t)) closeFlyout(false);
    };
    const onMove = () => closeFlyout(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [flyout, closeFlyout]);

  const GrowthIcon = navIcons.growth;

  return (
    <li data-testid="growth-nav-group">
      {/* ---- expanded sidebar (labels visible: lg and up, not collapsed) ---- */}
      <div className={cn("hidden", !collapsed && "lg:block")} data-testid="growth-nav-expanded">
        <div className="flex items-center gap-1">
          <Link
            href={GROWTH_ROOT}
            onClick={() => setOpen(true)}
            className={cn(typography.bodySmall, itemBase, "min-w-0 flex-1", onGrowth ? "text-chrome-text-primary hover:bg-chrome-item-hover" : itemIdle)}
            data-testid="growth-nav-label"
          >
            <GrowthIcon className="size-5 shrink-0" weight={onGrowth ? "fill" : "regular"} aria-hidden />
            <span>Growth</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? "Collapse Growth" : "Expand Growth"}
            title={open ? "Collapse Growth" : "Expand Growth"}
            className="flex size-8 shrink-0 items-center justify-center rounded-sm text-chrome-text-secondary transition-colors duration-base hover:bg-chrome-item-hover hover:text-chrome-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-chrome-text-primary"
            data-testid="growth-nav-toggle"
          >
            {open ? <CaretDown className="size-4" aria-hidden /> : <CaretRight className="size-4" aria-hidden />}
          </button>
        </div>
        <ul id={listId} hidden={!open} className="ml-5 mt-0.5 flex flex-col gap-0.5 border-l border-chrome-border pl-2" data-testid="growth-nav-children">
          {GROWTH_CHILDREN.map((c) => {
            const active = isGrowthChildActive(c.href, pathname);
            return (
              <li key={c.href}>
                <Link
                  href={c.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(typography.bodySmall, itemBase, "py-1.5", active ? itemActive : itemIdle)}
                  data-testid="growth-nav-child"
                >
                  <span>{c.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ---- icon-only rail (below lg, or collapsed): disclosure button + flyout ---- */}
      <div className={cn(collapsed ? "block" : "lg:hidden")} data-testid="growth-nav-rail">
        <button
          ref={railButton}
          type="button"
          onClick={() => (flyout ? closeFlyout(false) : openFlyout())}
          aria-expanded={flyout}
          aria-controls={flyoutId}
          aria-label="Growth"
          data-nav-label="Growth"
          className={cn(typography.bodySmall, itemBase, "w-full justify-center", onGrowth ? itemActive : itemIdle)}
          data-testid="growth-nav-rail-button"
        >
          <GrowthIcon className="size-5 shrink-0" weight={onGrowth ? "fill" : "regular"} aria-hidden />
        </button>
        {flyout && flyoutPos && (
          <div
            ref={flyoutRef}
            id={flyoutId}
            role="group"
            aria-label="Growth"
            style={{ position: "fixed", top: flyoutPos.top, left: flyoutPos.left }}
            className="z-50 min-w-52 rounded-md border border-chrome-border bg-chrome-background p-2 shadow-md"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== railButton.current) closeFlyout(false);
            }}
            data-testid="growth-nav-flyout"
          >
            <p className={cn(typography.metadata, "px-3 pb-1 font-medium text-chrome-text-secondary")}>Growth</p>
            <ul className="flex flex-col gap-1">
              {GROWTH_CHILDREN.map((c) => {
                const active = isGrowthChildActive(c.href, pathname);
                const Icon = navIcons[c.key];
                return (
                  <li key={c.href}>
                    <Link
                      href={c.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setFlyout(false)}
                      className={cn(typography.bodySmall, itemBase, "py-1.5", active ? itemActive : itemIdle)}
                      data-testid="growth-nav-flyout-link"
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span>{c.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}
