/**
 * Directions action (P1-E3-S3, work item §14; amended NP-DRIVER-UX-02 under ZD-126 D0). A safe, provider-agnostic
 * external maps URL: Google Maps' public cross-platform URL scheme for DRIVING DIRECTIONS, which requires no API key,
 * no SDK and no dependency, and opens the native app via universal link on iOS/Android (when installed) or the web
 * on desktop. No origin is sent (Google uses the device's own location), so no Driver position leaves Nemryn.
 *
 * Sends only the stop's address text already visible to the Driver on this screen — never a Passenger name, phone, or
 * any other field. Nothing is prefixed or appended to the stop (no facility name, no label): the address goes exactly
 * as dispatch recorded it, trimmed.
 *
 * Previously (ZD-126 as first recorded) this built a map SEARCH URL (`/maps/search/?api=1&query=`), which opened a
 * place search the Driver then had to turn into directions.
 *
 * Provider choice (unchanged): Google Maps, because one URL shape works on every Driver device without user-agent
 * detection. Revisit Apple Maps only on a real product need (decision-register.md).
 */
export const GOOGLE_MAPS_DIRECTIONS_BASE = "https://www.google.com/maps/dir/";

/** The trimmed stop address, or null when there is nothing usable to navigate to. */
export function usableAddress(address: string | null | undefined): string | null {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  return trimmed === "" ? null : trimmed;
}

/** Google Maps driving-directions URL to `destination`, or null when the destination is missing / blank. */
export function directionsUrl(destination: string | null | undefined): string | null {
  const stop = usableAddress(destination);
  if (stop === null) return null;
  return `${GOOGLE_MAPS_DIRECTIONS_BASE}?api=1&destination=${encodeURIComponent(stop)}&travelmode=driving`;
}
