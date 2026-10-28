import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * NP-PILOT-P2: the quiet "See all setup steps" link for first-use empty states (Vehicles, Drivers, Passengers,
 * Facilities, Trips). Navigation only -- it reads nothing and claims no completion; /operations/getting-started shows
 * the real status.
 */
export function GettingStartedLink() {
  return (
    <Link href="/operations/getting-started" className={cn(typography.bodySmall, "inline-flex items-center gap-1.5 font-medium text-text-link hover:underline")} data-testid="empty-getting-started-link">
      See all setup steps
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}
