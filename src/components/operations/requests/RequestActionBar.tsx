"use client";

import { useState } from "react";
import { LinkButton } from "@/components/ui/LinkButton";
import { Button } from "@/components/ui/Button";
import { DeclineRequestDialog } from "./DeclineRequestDialog";
import { CancelRequestDialog } from "./CancelRequestDialog";

export interface RequestActionBarProps {
  requestId: string;
  canCreateTrip: boolean;
  canCreateAnotherTrip: boolean;
  canDecline: boolean;
  canCancel: boolean;
  createTripHref: string;
}

/**
 * Request Detail's full action cluster (P1-E1-S2F-B1's Create Trip/
 * Create Another Trip, extended by P1-E1-S2F-B2 with Decline/Cancel).
 * Mirrors `TripDetailActionBar`'s own established convention exactly
 * (the closest existing Nemryn precedent, per §6's own explicit
 * permission to follow it instead of inventing a "More actions"
 * sub-grouping that doesn't exist anywhere else in this codebase): a
 * single flat row, no dropdown/overflow menu, differentiated purely by
 * button variant — Create Trip/Create Another Trip keeps its existing
 * DEFAULT (filled, primary) styling as the one productive action;
 * Decline/Cancel use `variant="outline"` as their TRIGGER buttons
 * (matching Cancel Trip's own trigger button in TripDetailActionBar —
 * secondary weight, never a same-size same-color competitor to the
 * primary CTA), with the actual destructive weight expressed only
 * once each action reaches its own confirmation dialog
 * (`variant="destructive"` on the confirm button inside, exactly like
 * `CancelTripDialog`).
 */
export function RequestActionBar({
  requestId,
  canCreateTrip,
  canCreateAnotherTrip,
  canDecline,
  canCancel,
  createTripHref,
}: RequestActionBarProps) {
  const [activeDialog, setActiveDialog] = useState<"decline" | "cancel" | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {(canCreateTrip || canCreateAnotherTrip) && (
          <LinkButton href={createTripHref}>{canCreateTrip ? "Create Trip" : "Create Another Trip"}</LinkButton>
        )}
        {canDecline && (
          <Button type="button" variant="outline" onClick={() => setActiveDialog("decline")}>
            Decline Request
          </Button>
        )}
        {canCancel && (
          <Button type="button" variant="outline" onClick={() => setActiveDialog("cancel")}>
            Cancel Request
          </Button>
        )}
      </div>

      {activeDialog === "decline" && <DeclineRequestDialog requestId={requestId} onClose={() => setActiveDialog(null)} />}
      {activeDialog === "cancel" && <CancelRequestDialog requestId={requestId} onClose={() => setActiveDialog(null)} />}
    </>
  );
}
