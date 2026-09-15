import { NavigationArrow, Phone } from "@phosphor-icons/react/dist/ssr";
import { LinkButton } from "@/components/ui/LinkButton";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { directionsUrl } from "@/lib/driver/maps";
import { currentLeg } from "@/lib/driver/trip-presentation";

export interface DriverActiveTripLegsProps {
  state: string;
  pickupTime: string;
  pickupAddress: string;
  destinationTime?: string;
  destinationAddress: string;
  passengerPhone: string | null;
  className?: string;
}

/**
 * The two-leg pickup/destination display for Active Trip (P1-E3-S3,
 * docs/design/stitch/references/04-driver-active-trip.png). Extends the
 * existing dot-line-dot metaphor (see `DriverRoute`, used on the more
 * compact Driver Today/Trips cards) into a richer, per-leg block with
 * Navigate/Call actions attached to whichever leg is actually "live" right
 * now (`currentLeg()`, src/lib/driver/trip-presentation.ts) — a
 * presentation derivation from canonical state, not a new stored concept.
 *
 * Call Passenger only appears during the pickup leg — once the passenger
 * is onboard they're physically in the vehicle, so calling them no longer
 * makes operational sense (a deliberate design decision this phase, not
 * dictated by the reference, which shows only the pickup-leg state).
 * Navigate follows whichever leg is current. Both are safe external links
 * — no mapping SDK, no analytics, phone via a plain `tel:` link.
 */
export function DriverActiveTripLegs({
  state,
  pickupTime,
  pickupAddress,
  destinationTime,
  destinationAddress,
  passengerPhone,
  className,
}: DriverActiveTripLegsProps) {
  const leg = currentLeg(state);
  const pickupDone = leg === "destination";
  const pickupCurrent = leg === "pickup";

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex gap-3">
        <div className="flex flex-col items-center pt-1">
          <span
            className={cn(
              "size-3 shrink-0 rounded-full border-2",
              pickupCurrent
                ? "border-info-strong bg-surface-elevated"
                : pickupDone
                  ? "border-success-strong bg-success-strong"
                  : "border-border-strong bg-surface-elevated",
            )}
            aria-hidden
          />
          <span className="w-px flex-1 bg-border-strong" aria-hidden />
        </div>
        <div className="flex flex-1 flex-col gap-1 pb-4">
          <div className="flex items-center justify-between gap-2">
            <p className={cn(typography.label, "uppercase tracking-wide text-text-muted")}>Pickup</p>
            <p className={cn(typography.bodySmall, "font-semibold text-text-primary")}>{pickupTime}</p>
          </div>
          <p className={cn(typography.body, "font-medium text-text-primary")}>{pickupAddress}</p>

          {pickupCurrent && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex gap-2">
                <LinkButton
                  href={directionsUrl(pickupAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outline"
                  size="md"
                  leadingIcon={<NavigationArrow className="size-4" aria-hidden />}
                  className="flex-1"
                >
                  Navigate
                </LinkButton>
                {passengerPhone && (
                  <LinkButton
                    href={`tel:${passengerPhone}`}
                    variant="outline"
                    size="md"
                    leadingIcon={<Phone className="size-4" aria-hidden />}
                    className="flex-1"
                  >
                    Call Passenger
                  </LinkButton>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <span
            className={cn(
              "size-3 shrink-0 rounded-sm",
              leg === "destination" ? "bg-brand-care-navy" : "border-2 border-border-strong bg-surface-elevated",
            )}
            aria-hidden
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className={cn(typography.label, "uppercase tracking-wide text-text-muted")}>Drop-off</p>
            {destinationTime && (
              <p className={cn(typography.bodySmall, "font-semibold text-text-primary")}>{destinationTime}</p>
            )}
          </div>
          <p className={cn(typography.body, "font-medium text-text-primary")}>{destinationAddress}</p>

          {leg === "destination" && (
            <div className="mt-2 flex gap-2">
              <LinkButton
                href={directionsUrl(destinationAddress)}
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                size="md"
                leadingIcon={<NavigationArrow className="size-4" aria-hidden />}
                className="flex-1"
              >
                Navigate
              </LinkButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
