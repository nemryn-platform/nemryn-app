"use client";

import { useState } from "react";
import { NotePencil, Plus } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddNoteDialog } from "./AddNoteDialog";
import { formatOperationsTime } from "@/lib/operations/presentation";
import type { TripDetailNote } from "@/lib/operations/trip-detail";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface TripNotesPanelProps {
  tripId: string;
  notes: TripDetailNote[];
  timezone: string;
}

/**
 * "Trip Notes" (docs/design/stitch/references/02-trip-detail.png) — real
 * `trip_notes` rows, both `operations_only` and `driver_visible` (RLS
 * already scopes Operations to see both; no extra filtering needed).
 * Deliberately does NOT attempt to resolve/display the precise human
 * author (name/role) — `user_profiles` has no seed data anywhere in this
 * project and no reliable actor-identity resolution exists yet, the same
 * reasoning Today's Operations' Activity Log already established for the
 * identical gap. The reference's own "Facility coordinator" author label
 * is a Stitch-mockup illustration, not a literal reflection of this
 * schema's author-identity model (a `trip_notes.author_user_id` points
 * at a Zenward staff account, never a requester).
 */
export function TripNotesPanel({ tripId, notes, timezone }: TripNotesPanelProps) {
  const [addNoteOpen, setAddNoteOpen] = useState(false);

  return (
    <Panel elevated>
      <div className="flex items-center gap-2">
        <NotePencil className="size-5 text-text-muted" aria-hidden />
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Trip Notes</h3>
      </div>

      <div className="mt-zw-md">
        {notes.length === 0 ? (
          <EmptyState title="No notes yet" description="Notes added here are visible to Operations, and to the Driver when marked visible." />
        ) : (
          <ul className="flex flex-col gap-zw-sm">
            {notes.map((note) => (
              <li key={note.id} className="border-b border-border-subtle pb-zw-sm last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn(typography.metadata, "text-text-muted")}>{formatOperationsTime(note.createdAt, timezone)}</span>
                  <StatusBadge
                    label={note.visibility === "driver_visible" ? "Visible to Driver" : "Operations only"}
                    category={note.visibility === "driver_visible" ? "active" : "neutral"}
                  />
                </div>
                <p className={cn(typography.bodySmall, "mt-1 text-text-primary")}>{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button
        variant="outline"
        className="mt-zw-md w-full"
        leadingIcon={<Plus className="size-4" aria-hidden />}
        onClick={() => setAddNoteOpen(true)}
      >
        Add Note
      </Button>

      {addNoteOpen && <AddNoteDialog tripId={tripId} onClose={() => setAddNoteOpen(false)} />}
    </Panel>
  );
}
