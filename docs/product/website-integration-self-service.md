# Website Integration Self-Service (P1-PILOT-S4B-R4B)

An Organization Admin connects their own website to Nemryn from **Settings → Website Requests** (renamed from Integrations in P1-COMM-D1; `/operations/settings/integrations` redirects) — no SQL, no Dashboard, no service-role script, no Nemryn engineering step.

## Flow

Connect website → Nemryn generates the **Integration ID** (disabled by default) → Activate → the customer's website server posts to the public endpoint → Requests appear in the Request Hub → the connection shows **Connected** → Disable intake is the kill switch.

## Boundaries

- The public path is unchanged: `POST /api/public-intake/website`, its frozen payload, Origin check, durable rate limit, idempotency and the service-role-only `submit_public_transportation_request`. A self-service integration is consumed by it exactly like a hand-provisioned one.
- `request_intake_integrations` stays a **closed table**: no RLS policy, no grant to `anon`/`authenticated`. Everything goes through four SECURITY DEFINER functions, each authorizing the caller as `organization_admin` of the owning organization (`has_org_role`); every other caller, and any foreign or nonexistent integration id, gets the same `ZW002`.
  - `list_request_intake_integrations(org)` — safe columns + derived `request_count` / `last_request_received_at`.
  - `create_request_intake_integration(org, origin)` — server-generated Integration ID, `website`, `is_active=false`, normalized https origin; idempotent per (org, origin); cap of 10 per org.
  - `set_request_intake_integration_active(id, active)` — activate / disable; activation requires a configured origin.
  - `update_request_intake_integration_origin(id, origin)` — Integration ID unchanged; the integration is **always left disabled** (an active one is auto-disabled) so an active public integration is never silently re-pointed.
- `org` is the caller's current workspace resolved server-side (a person may administer several organizations); the database re-authorizes it. The browser never supplies it, nor an id, type, flag or actor.
- Multiple integrations per organization are supported by construction. The only uniqueness rule is one website integration per (organization, normalized origin).

## Integration ID

`web_` + 12 characters from a 32-symbol unambiguous alphabet, drawn from a CSPRNG (60 bits). It encodes nothing about the organization, user or sequence. It is a **public identifier, not a secret** — the UI calls it "Integration ID". The Origin header is a configured website constraint, not authentication.

## Status (derived, never stored)

none → Not configured · inactive → Disabled · active + 0 requests → Ready to test · active + ≥1 real accepted Request → Connected. "Connected" is never inferred from a ping.

## Audit events

`website_integration_created`, `website_integration_activated`, `website_integration_disabled`, `website_integration_origin_updated` (entity `request_intake_integration`; before/after in the standard columns).

## Origin rules

https only; host of ≥2 labels with an alphabetic (or punycode) TLD; optional port; one trailing slash is normalized away; no path, query, fragment, userinfo, wildcard, IP literal, single-label host, other scheme, whitespace or non-ASCII. No localhost exception (local testing uses a synthetic https origin; the Origin header is caller-set on a server-to-server call). Mirrored by `src/lib/operations/website-integration-core.ts` with shared test vectors.

## Not in scope / tracked

Origin *ownership* verification (an origin is a constraint, not proof of control) and a permanent Delete are deliberately not built; cleanup of the temporary manually-provisioned Zenward QA integration happens at the coordinated fresh-Zenward cutover (R4E).

## Acquisition attribution (P1-PILOT-S4C)

The website intake payload accepts ONE optional object, `acquisition`, so a tenant can later see which source, campaign or page produced a Request. Every property — and the object itself — is optional; existing integrations that send nothing behave exactly as before.

```json
"acquisition": {
  "utmSource": "google",
  "utmMedium": "cpc",
  "utmCampaign": "dialysis_transport",
  "landingPath": "/dialysis-transportation",
  "submissionPath": "/request-transportation",
  "referrerHost": "google.com",
  "formVersion": "request-v2"
}
```

Accepted fields and limits: `utmSource` / `utmMedium` ≤ 120, `utmCampaign` / `utmContent` / `utmTerm` ≤ 160 (trimmed, case preserved), `landingPath` / `submissionPath` ≤ 300 (pathname only: leading `/`, no scheme, host, query or fragment), `referrerHost` ≤ 253 (bare hostname, lowercased), `formVersion` ≤ 64 (`[A-Za-z0-9._-]`).

**A valid transportation Request never fails because of attribution.** Missing, malformed or unknown acquisition data is discarded (values individually); if nothing valid remains no attribution is stored and the Request is created normally. Not accepted or stored: IP address, user agent, fingerprints, cookies, session ids, full referrer/landing URLs, query strings, click ids (gclid / fbclid / msclkid), or arbitrary metadata.

Storage: `request_acquisition_attributions` — one immutable snapshot per Request, written in the same transaction as the Request by `submit_public_transportation_request`. An idempotent replay returns the original Request and never adds or rewrites a snapshot. There is no backfill: historical Requests have none, which means "no acquisition information recorded" (not "direct"). It is shown to Organization Admins and Dispatchers only, as **Acquisition** on Request Detail (omitted when absent). It is not exposed to Drivers, notifications, audit events or Platform Admin. Analytics and dashboards are a later phase; classifications such as paid / organic / social / direct are never stored.

Developer notes: don't send sensitive customer answers as attribution; don't send full URLs or query strings; submit the Request even if attribution capture fails.
