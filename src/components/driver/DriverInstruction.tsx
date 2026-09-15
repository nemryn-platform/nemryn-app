import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface DriverInstructionProps {
  icon?: ReactNode;
  instruction: string;
  detail?: string;
  className?: string;
}

/** High-emphasis "what to do next" panel — the single clearest thing on an active-trip screen. */
export function DriverInstruction({ icon, instruction, detail, className }: DriverInstructionProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border-l-2 border-l-info-strong bg-brand-calm-mist px-zw-md py-zw-md",
        className,
      )}
    >
      {icon && (
        <div className="mt-0.5 text-info-strong" aria-hidden>
          {icon}
        </div>
      )}
      <div>
        <p className={cn(typography.subsectionHeading, "text-text-primary")}>{instruction}</p>
        {detail && <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{detail}</p>}
      </div>
    </div>
  );
}
