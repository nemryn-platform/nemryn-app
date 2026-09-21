/**
 * Reachability probe for the Driver network indicator (P1-PILOT-S5A): an empty,
 * unauthenticated, never-cached 204. It touches no data and no session -- it only
 * answers "can this device reach Nemryn right now", which navigator.onLine cannot.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export function HEAD() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store, max-age=0" } });
}
