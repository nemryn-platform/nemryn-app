"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/Button";

export interface CopyValueProps {
  /** The exact text placed on the clipboard. */
  value: string;
  /** Names the thing being copied for assistive tech, e.g. "Integration ID". */
  label: string;
}

/**
 * A small "Copy" control. Uses the async Clipboard API where available and
 * falls back to a hidden textarea + execCommand (non-secure contexts, older
 * browsers). Announces the result politely; never throws.
 */
export function CopyValue({ value, label }: CopyValueProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      try {
        const area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand("copy");
        document.body.removeChild(area);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        aria-label={`Copy ${label}`}
        leadingIcon={copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
      <span className="sr-only" role="status">
        {copied ? `${label} copied` : ""}
      </span>
    </>
  );
}
