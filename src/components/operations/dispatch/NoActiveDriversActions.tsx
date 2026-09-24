import { LinkButton } from "@/components/ui/LinkButton";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface NoActiveDriversActionsProps {
  /** Organization Admin -- the only role that can invite a Driver or link itself (both pages are admin-guarded server-side). */
  canManageDriverSetup: boolean;
  /** The operator already has an active linked Driver, so "I also drive" would be redundant. */
  hasLinkedDriver: boolean;
}

/**
 * P1-OPS-PROG1 zero-driver guidance. Links to the EXISTING flows only --
 * Drivers (Invite Driver) and Settings -> My Access (the one
 * `link_self_as_driver` self-link path) -- never a second Driver-link
 * implementation. A Dispatcher is not offered actions whose pages would
 * refuse them; hiding a link is presentation, never authorization.
 */
export function NoActiveDriversActions({ canManageDriverSetup, hasLinkedDriver }: NoActiveDriversActionsProps) {
  if (!canManageDriverSetup) {
    return (
      <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="no-drivers-dispatcher-note">
        An organization admin can add drivers.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap justify-center gap-2" data-testid="no-drivers-admin-actions">
      <LinkButton href="/operations/drivers" variant="outline" size="sm">
        Add a driver
      </LinkButton>
      {!hasLinkedDriver && (
        <LinkButton href="/operations/settings/my-access" variant="outline" size="sm">
          I also drive
        </LinkButton>
      )}
    </div>
  );
}
