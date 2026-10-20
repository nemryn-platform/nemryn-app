import { cn } from "@/lib/cn";

export interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  /** NP-UI-P1b: "chrome" for the dark sidebar, where the default graphite fill would disappear into the frame. */
  tone?: "default" | "chrome";
  className?: string;
}

const sizeClasses = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
} as const;

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`;
  return initials.toUpperCase();
}

/** Initials-only avatar — no photo sourcing dependency for the operations console. */
export function Avatar({ name, size = "md", tone = "default", className }: AvatarProps) {
  return (
    <div
      role="img"
      aria-label={name}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        tone === "chrome" ? "bg-chrome-item-active-background text-chrome-text-primary ring-1 ring-chrome-border" : "bg-brand-care-navy text-white",
        sizeClasses[size],
        className,
      )}
    >
      {getInitials(name)}
    </div>
  );
}
