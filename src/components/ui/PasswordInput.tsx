"use client";

import { forwardRef, useId, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  label: string;
  helpText?: string;
  error?: string;
  size?: "md" | "lg";
}

/**
 * A password `<input>` with a Show/Hide visibility toggle (P0-S2B-UX1) —
 * otherwise identical to `Input` (same label/help/error chrome, same
 * typography, same border/focus styling), forked rather than added onto
 * `Input` itself because the toggle button needs to sit inside the
 * input's own box (a `relative`/`absolute` wrapper `Input` has no
 * reason to carry for its many non-password call sites).
 *
 * The toggle is purely a display concern: it flips this component's own
 * local `visible` state between `type="password"`/`type="text"` on the
 * SAME `<input>` element (same `name`, same value, same DOM node) — it
 * never touches form state, never submits, never fires a request, and
 * the two password fields on the reset-password form (`New password`/
 * `Confirm new password`) each get their own independent instance of
 * this component, so revealing one never reveals the other.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    { label, helpText, error, required, disabled, size = "md", id, className, autoComplete, ...props },
    ref,
  ) => {
    const [visible, setVisible] = useState(false);
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const helpId = helpText ? `${inputId}-help` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const buttonSize = size === "lg" ? "w-12" : "w-10";
    const rightPadding = size === "lg" ? "pr-12" : "pr-10";

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className={cn(typography.label, "text-text-primary")}>
          {label}
          {required && (
            <span className="text-critical-text" aria-hidden>
              {" "}
              *
            </span>
          )}
        </label>
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            autoComplete={autoComplete}
            required={required}
            disabled={disabled}
            aria-describedby={cn(helpId, errorId) || undefined}
            aria-invalid={Boolean(error) || undefined}
            className={cn(
              typography.body,
              "w-full rounded-sm border bg-surface-elevated text-text-primary placeholder:text-text-disabled disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-text-disabled",
              size === "lg" ? "h-12 pl-4" : "h-10 pl-3",
              rightPadding,
              error ? "border-critical-strong" : "border-border-strong",
              className,
            )}
            {...props}
          />
          <button
            type="button"
            disabled={disabled}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            className={cn(
              "absolute inset-y-0 right-0 flex items-center justify-center text-text-muted transition-colors duration-base ease-standard hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50",
              buttonSize,
            )}
          >
            {visible ? <EyeSlash className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        </div>
        {helpText && !error && (
          <p id={helpId} className={cn(typography.metadata, "text-text-muted")}>
            {helpText}
          </p>
        )}
        {error && (
          <p id={errorId} className={cn(typography.metadata, "text-critical-text")}>
            {error}
          </p>
        )}
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
