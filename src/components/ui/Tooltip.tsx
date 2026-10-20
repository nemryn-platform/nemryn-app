"use client";

import { cloneElement, isValidElement, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

/**
 * Tooltip (NP-UI-P1a; WAI-ARIA tooltip pattern). Supplementary text for a control that already has an accessible
 * name: shown on hover AND keyboard focus, hidden on blur / mouse leave / Escape, wired with aria-describedby. Never
 * put essential information or interactive content in a tooltip.
 */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactElement<{ "aria-describedby"?: string }>; side?: "top" | "bottom" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!isValidElement(children)) return children;
  const existing = children.props["aria-describedby"];
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) setOpen(false);
      }}
    >
      {cloneElement(children, { "aria-describedby": [existing, open ? id : undefined].filter(Boolean).join(" ") || undefined })}
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className={cn(
          typography.metadata,
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-sm bg-chrome-background px-2 py-1 text-chrome-text-primary shadow-sm",
          side === "top" ? "bottom-full mb-1" : "top-full mt-1",
        )}
      >
        {content}
      </span>
    </span>
  );
}
