import { MapPin } from "@phosphor-icons/react/dist/ssr";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { formatRequestServiceDate } from "@/lib/operations/presentation";
import { RETURN_TRIP_OPTIONS, selectOptionLabel } from "@/lib/operations/log-request-options";

export interface RequestTransportationPanelProps {
  pickupDescription: string;
  destinationDescription: string;
  preferredDate: string | null;
  preferredTime: string | null;
  returnTripNeeded: string;
}

/**
 * P1-E1-S2E §7/§11/§23 — pickup/destination/preferred date+time/return
 * intent, as plain information. Preferred date/time is NOT a hard
 * conversion blocker under current `create_trip` rules, so an absent
 * value here reads as honest, calm information ("No date given"), never
 * as a reason to call the Request "Not ready" — Readiness is derived
 * exclusively from Passenger resolution (request-readiness-core.ts),
 * never from schedule completeness.
 */
export function RequestTransportationPanel({
  pickupDescription,
  destinationDescription,
  preferredDate,
  preferredTime,
  returnTripNeeded,
}: RequestTransportationPanelProps) {
  return (
    <Panel elevated>
      <PanelHeader title="Transportation" icon={<MapPin className="size-5" />} tone="accent" />
      <div className="mt-zw-lg">
        <DefinitionList
          columns={2}
          items={[
            { label: "Pickup", value: pickupDescription },
            { label: "Destination", value: destinationDescription },
            { label: "Preferred Service", value: formatRequestServiceDate(preferredDate, preferredTime) },
            { label: "Return Transportation", value: selectOptionLabel(RETURN_TRIP_OPTIONS, returnTripNeeded) },
          ]}
        />
      </div>
    </Panel>
  );
}
