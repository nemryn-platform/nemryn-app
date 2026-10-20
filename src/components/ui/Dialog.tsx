"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /**
   * NP-UI-P1a (U2): where focus goes when the dialog closes. Defaults to the element that had focus when the dialog
   * opened (the invoking control). Pass this when that control may no longer exist after the dialog's action (for
   * example a button that disappears once the action succeeds).
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * NP-UI-P1b SidePanel foundation: "side" docks the same native modal to the right edge, full height, with a
   * scrolling body -- for long or contextual editing. Focus trap, Escape, backdrop close and the U2 focus return are
   * identical (one implementation). No existing dialog is migrated in P1b; adoption is decided per screen.
   */
  placement?: "center" | "side";
}

/**
 * A minimal, accessible modal built on the native `<dialog>` element
 * rather than a new UI library (work item §53 — "do not introduce a
 * heavyweight UI library solely for one modal"; no Dialog/Modal primitive
 * existed in the design system before this). `showModal()` gives real
 * focus trapping and top-layer stacking for free; the native `close`
 * event (fired by ESC and by `<form method="dialog">`, if ever used)
 * drives `onClose` so React state and DOM state can't drift apart.
 * Clicking the backdrop (a click whose target is the `<dialog>` element
 * itself, not its content) also closes — the same convention most modal
 * libraries use. Backdrop styling lives in globals.css (`dialog::backdrop`)
 * since Tailwind v4's own `backdrop:` variant support isn't relied on.
 *
 * Focus return (NP-UI-P1a, U2 / WCAG 2.4.3): the invoking element is recorded when the dialog opens and focus is
 * restored to it on EVERY close path -- Escape / `close()`, `open` turning false, and the dialog being unmounted by
 * its parent (Cancel, Close X, backdrop, a successful action). The browser only restores focus itself on a native
 * `close()`; most callers unmount the dialog instead, which used to leave focus on <body>. Focus is never sent to an
 * element that has left the document: it falls back to `returnFocusRef`, then does nothing.
 */
export function Dialog({ open, onClose, title, description, children, className, returnFocusRef, placement = "center" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  // the control that opened the dialog (recorded before showModal moves focus inside it)
  const invoker = useRef<HTMLElement | null>(null);
  const fallbackRef = useRef(returnFocusRef);
  useEffect(() => {
    fallbackRef.current = returnFocusRef;
  }, [returnFocusRef]);

  const restoreFocus = useCallback(() => {
    const recorded = invoker.current;
    invoker.current = null;
    const fallback = fallbackRef.current?.current ?? null;
    const target = recorded?.isConnected ? recorded : fallback?.isConnected ? fallback : null;
    if (!target || target === document.activeElement) return;
    // after the current task, so a parent re-render (or the native close) has settled; skip if something else
    // deliberately took focus in the meantime (anything other than <body> or the closing dialog's content)
    window.setTimeout(() => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected || active.closest("dialog:not([open])") !== null;
      if (lost && target.isConnected) target.focus({ preventScroll: true });
    }, 0);
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const active = document.activeElement;
      invoker.current = active instanceof HTMLElement && active !== document.body ? active : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      restoreFocus();
    }
  }, [open, restoreFocus]);

  // unmounted by the parent while open (Cancel, Close X, backdrop, a successful action): the native dialog never
  // runs close(), so restore focus here
  useEffect(() => () => restoreFocus(), [restoreFocus]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      restoreFocus();
      onClose();
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose, restoreFocus]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      onCancel={(event) => {
        // Native ESC handling — let the dialog's own `close` event (above)
        // drive React state instead of duplicating the call here.
        event.preventDefault();
        ref.current?.close();
      }}
      data-placement={placement}
      className={cn(
        placement === "side"
          ? "my-0 ml-auto mr-0 h-dvh max-h-dvh w-full max-w-lg flex-col rounded-l-md border-y-0 border-l border-r-0 border-border-subtle bg-surface-elevated p-0 shadow-lg open:flex"
          : "m-auto w-full max-w-md rounded-md border border-border-subtle bg-surface-elevated p-0 shadow-lg",
        className,
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle p-zw-lg">
        <div>
          <h2 id={titleId} className={cn(typography.subsectionHeading, "text-text-primary")}>
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
              {description}
            </p>
          )}
        </div>
        <IconButton label="Close" icon={<X className="size-4" aria-hidden />} onClick={onClose} />
      </div>
      <div className={cn("p-zw-lg", placement === "side" && "min-h-0 flex-1 overflow-y-auto")}>{children}</div>
    </dialog>
  );
}

/** NP-UI-P1b: the right-docked variant of Dialog (same focus / Escape / backdrop / focus-return behaviour). */
export function SidePanel(props: Omit<DialogProps, "placement">) {
  return <Dialog {...props} placement="side" />;
}
