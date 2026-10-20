"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { firstEnabled, nextIndex, typeaheadIndex } from "@/lib/ui/ui-core";

function useDismiss(open: boolean, close: (returnFocus: boolean) => void, root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, close, root]);
}

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  destructive?: boolean;
  icon?: ReactNode;
}

/**
 * Menu button (NP-UI-P1a; WAI-ARIA menu-button pattern). The trigger has aria-haspopup / aria-expanded; the menu is
 * role=menu with role=menuitem entries (links or actions). Enter / Space / ArrowDown open on the first item, ArrowUp
 * on the last; arrows / Home / End / typeahead move; Escape closes and returns focus to the trigger; Tab or an outside
 * click closes. Selecting an item closes the menu.
 */
export function Menu({ label, trigger, items, align = "end", className }: { label: string; trigger: ReactNode; items: MenuItem[]; align?: "start" | "end"; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const disabled = items.map((i) => Boolean(i.disabled));
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };
  useDismiss(open, (rf) => close(rf), root);
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);
  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAt(firstEnabled(disabled));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openAt(nextIndex("End", 0, disabled) ?? 0);
    }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      close(false);
      return;
    }
    const n = nextIndex(e.key, active, disabled, "vertical") ?? (e.key.length === 1 ? typeaheadIndex(e.key, active, items.map((i) => i.label), disabled) : null);
    if (n !== null) {
      e.preventDefault();
      setActive(n);
    }
  };
  const run = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect?.();
  };
  return (
    <div ref={root} className={cn("relative inline-block", className)}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : openAt(firstEnabled(disabled)))}
        onKeyDown={onTriggerKey}
        className="inline-flex"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cn("absolute z-50 mt-1 min-w-48 rounded-md border border-border-subtle bg-surface-elevated py-1 shadow-md", align === "end" ? "right-0" : "left-0")}
        >
          {items.map((item, i) => {
            const common = {
              ref: (el: HTMLElement | null) => {
                itemRefs.current[i] = el;
              },
              role: "menuitem" as const,
              tabIndex: i === active ? 0 : -1,
              "aria-disabled": item.disabled || undefined,
              className: cn(
                typography.bodySmall,
                "flex w-full items-center gap-2 px-3 py-2 text-left outline-offset-[-2px] hover:bg-surface-hover focus:bg-surface-hover",
                item.destructive ? "text-critical-text" : "text-text-primary",
                item.disabled && "cursor-not-allowed text-text-disabled hover:bg-transparent",
              ),
            };
            return item.href && !item.disabled ? (
              <Link key={item.label} href={item.href} {...common} onClick={() => close(false)}>
                {item.icon}
                {item.label}
              </Link>
            ) : (
              <button key={item.label} type="button" {...common} onClick={() => run(item)}>
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Non-modal popover / disclosure (NP-UI-P1a): a trigger with aria-expanded / aria-controls and a panel of arbitrary
 * content (filters, details). Escape closes and returns focus to the trigger; an outside click closes. Focus is not
 * trapped (it isn't a dialog) -- use Dialog for modal tasks.
 */
export function Popover({ label, trigger, children, align = "start", className }: { label: string; trigger: ReactNode; children: ReactNode; align?: "start" | "end"; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };
  useDismiss(open, (rf) => close(rf), root);
  return (
    <div
      ref={root}
      className={cn("relative inline-block", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          close(true);
        }
      }}
    >
      <button ref={button} type="button" aria-expanded={open} aria-controls={`${id}-popover`} onClick={() => setOpen((o) => !o)} className="inline-flex">
        {trigger}
      </button>
      <div
        id={`${id}-popover`}
        role="group"
        aria-label={label}
        hidden={!open}
        className={cn("absolute z-50 mt-1 min-w-64 rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-md", align === "end" ? "right-0" : "left-0")}
      >
        {children}
      </div>
    </div>
  );
}
