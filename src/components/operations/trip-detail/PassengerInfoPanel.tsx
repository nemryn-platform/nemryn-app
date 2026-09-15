import { Panel } from "@/components/ui/Panel";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface PassengerInfoPanelProps {
  passengerName: string;
  passengerPhone: string | null;
  requesterName: string | null;
  requesterRelationship: string | null;
  assistanceNotes: string | null;
}

/**
 * "Passenger & Trip Information" (docs/design/stitch/references/
 * 02-trip-detail.png) — real fields only. The reference's own "Trip
 * Type" ("One way"), "Reference" ("FAC-23981"), and "Companion" ("None
 * recorded") rows are all fabricated concepts with no backend field
 * (ui-backend-gap-register.md "PRODUCT DECISIONS REQUIRED" — Trip Type/
 * structured fields, human-readable reference codes, and Companion are
 * each their own still-open, un-decided product question) — omitted
 * entirely rather than invented (work item §45/§46/§75).
 *
 * "Requested By" uses the real `transportation_requests` requester
 * snapshot (Requester ≠ Passenger, work item §14) — shown only when the
 * Trip actually has a linked request; an internally-created Trip has
 * none, and the row is omitted rather than shown blank.
 *
 * "Assistance Requirements" is `trips.assistance_notes` — the Trip's own
 * execution-time snapshot, not the Passenger profile's own (separate,
 * potentially-divergent) `assistance_notes` field. See the data map for
 * why only the Trip-level snapshot is shown here.
 */
export function PassengerInfoPanel({
  passengerName,
  passengerPhone,
  requesterName,
  requesterRelationship,
  assistanceNotes,
}: PassengerInfoPanelProps) {
  const items = [
    { label: "Passenger", value: passengerName },
    { label: "Phone", value: passengerPhone ? <a href={`tel:${passengerPhone}`} className="text-text-link hover:underline">{passengerPhone}</a> : "—" },
    ...(requesterName
      ? [{ label: "Requested By", value: requesterRelationship ? `${requesterName} (${requesterRelationship})` : requesterName }]
      : []),
    { label: "Assistance Requirements", value: assistanceNotes ?? "None recorded" },
  ];

  return (
    <Panel>
      <h3 className={cn(typography.subsectionHeading, "border-b border-border-subtle pb-zw-md text-text-primary")}>
        Passenger &amp; Trip Information
      </h3>
      <div className="pt-zw-lg">
        <DefinitionList columns={2} items={items} />
      </div>
    </Panel>
  );
}
