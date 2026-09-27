"use client";

import { useState } from "react";
import { Phone } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { CancelTripDialog } from "./CancelTripDialog";
import { NoShowDialog } from "./NoShowDialog";
import { EditTripDialog, type EditableTrip } from "./EditTripDialog";
import { RecordCompletionDialog } from "./RecordCompletionDialog";
import type { NewTripFacilityOption } from "@/lib/operations/new-trip-options";
import { tripEditFieldLabels } from "@/lib/operations/trip-edit-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface TripDetailActionBarProps {
  tripId: string;
  passengerName: string;
  driverPhone: string | null;
  eligibleForCancel: boolean;
  eligibleForNoShow: boolean;
  /**
   * P1-PILOT-R2B: Edit Trip. `null` = no edit flow (the viewer can't edit, or no detail is editable at this stage --
   * arrived at destination / terminal).
   */
  edit: { trip: EditableTrip; facilities: NewTripFacilityOption[]; organizationTimezone: string } | null;
  /**
   * P1-PILOT-R2C: Record completion -- the exceptional recovery when the Driver can't complete the Trip in Nemryn.
   * `null` unless the Trip is passenger_onboard / en_route_to_destination / arrived_at_destination (this page is
   * Organization Admin / Dispatcher only).
   */
  recordCompletion: { tripState: string; organizationTimezone: string } | null;
}

/**
 * The action cluster from the reference's top-right corner (Edit Trip /
 * More / Contact Driver) — reworked as direct, individually-labeled
 * buttons rather than an overflow "More" menu (ZD-1xx, decision-register.md):
 * no dropdown-menu primitive exists yet in the design system, and hiding
 * a destructive action (Cancel) or a rare one (Report No-Show) behind an
 * unlabeled "More" button is arguably less discoverable/accessible than
 * showing them directly — composition/hierarchy (a small cluster of
 * secondary actions beside the page title) is preserved, only the exact
 * interaction shape differs.
 *
 * "Edit Trip" is rendered, real, and disabled — the New Trip/Edit form is
 * explicitly out of scope this phase (work item §54).
 */
export function TripDetailActionBar({
  tripId,
  passengerName,
  driverPhone,
  eligibleForCancel,
  eligibleForNoShow,
  edit,
  recordCompletion,
}: TripDetailActionBarProps) {
  const [activeDialog, setActiveDialog] = useState<"cancel" | "noshow" | "edit" | "complete" | null>(null);
  const [saved, setSaved] = useState<{ fields: string[]; driverMayBeTravelling: boolean } | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {edit ? (
          <Button variant="outline" onClick={() => setActiveDialog("edit")} data-testid="edit-trip-button">
            Edit Trip
          </Button>
        ) : (
          <Button variant="outline" disabled title="This trip's details can't be changed at its current stage." data-testid="edit-trip-button">
            Edit Trip
          </Button>
        )}
        {eligibleForNoShow && (
          <Button variant="outline" onClick={() => setActiveDialog("noshow")}>
            Record No-Show
          </Button>
        )}
        {eligibleForCancel && (
          <Button variant="outline" onClick={() => setActiveDialog("cancel")}>
            Cancel Trip
          </Button>
        )}
        {recordCompletion && (
          <Button variant="text" onClick={() => setActiveDialog("complete")} data-testid="record-completion-button">
            Record completion
          </Button>
        )}
        {driverPhone && (
          <LinkButton href={`tel:${driverPhone}`} leadingIcon={<Phone className="size-4" aria-hidden />}>
            Contact Driver
          </LinkButton>
        )}
      </div>

      {activeDialog === "cancel" && (
        <CancelTripDialog tripId={tripId} passengerName={passengerName} onClose={() => setActiveDialog(null)} />
      )}
      {saved && (
        <p role="status" data-testid="edit-trip-saved" className={cn(typography.bodySmall, "w-full text-text-secondary")}>
          {saved.driverMayBeTravelling ? "Saved. The driver may already be on the way. Contact them to confirm the change." : "Trip updated."}{" "}
          <span className="text-text-muted">({tripEditFieldLabels(saved.fields).join(", ")})</span>
          {saved.driverMayBeTravelling && driverPhone && (
            <>
              {" "}
              <a href={`tel:${driverPhone}`} className="text-text-link hover:underline">
                Contact Driver
              </a>
            </>
          )}
        </p>
      )}
      {activeDialog === "edit" && edit && (
        <EditTripDialog
          trip={edit.trip}
          facilities={edit.facilities}
          organizationTimezone={edit.organizationTimezone}
          onClose={() => setActiveDialog(null)}
          onSaved={(result) => {
            setSaved({ fields: result.changedFields, driverMayBeTravelling: result.driverMayBeTravelling });
            setActiveDialog(null);
          }}
        />
      )}
      {activeDialog === "complete" && recordCompletion && (
        <RecordCompletionDialog
          tripId={tripId}
          tripState={recordCompletion.tripState}
          organizationTimezone={recordCompletion.organizationTimezone}
          onClose={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === "noshow" && (
        <NoShowDialog tripId={tripId} passengerName={passengerName} onClose={() => setActiveDialog(null)} />
      )}
    </>
  );
}
