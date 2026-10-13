"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared open / close behaviour for the Operations header popovers (P1-PILOT-UX1) -- the same rules AccountMenu already
 * follows: toggle on the trigger, close on Escape (focus returns to the trigger) and on an outside click.
 */
export function useHeaderPopover() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return { open, setOpen, close, containerRef, triggerRef };
}

/** Popover panel classes: anchored to the trigger's right edge, never wider than the viewport minus a gutter. */
export const HEADER_POPOVER_PANEL =
  "absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-sm border border-border-subtle bg-surface-elevated shadow-md";
