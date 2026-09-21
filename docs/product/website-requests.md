# Website Requests (P1-COMM-D1)

Settings → **Website Requests** is the customer-facing home of website intake (it replaces "Integrations", which only ever held website intake; the old route redirects). Organization Admin only. It is one intake engine (`/api/public-intake/website` → `submit_public_transportation_request`) presented as three ways to connect.

## Screens
| Route | Purpose |
|---|---|
| `/operations/settings/website-requests` | Landing: flow strip (Customer → Website → Request Hub), one card per connection (status, requests received, last request, connected-through, services accepted, test guidance, Turn on/off, Change website, collapsed **Technical details**), and the three method cards. |
| `…/form` | **Use a Nemryn form** (Easiest): wording, services, two switches, Draft/Ready, live **safe preview**. |
| `…/existing-form` | **Connect my existing form**: "Who manages your website?" → guidance and a copy-ready package. |
| `…/developer` | **Developer connection**: endpoint, Integration ID, Origin rule, payload, optional acquisition, test steps, copy-ready package. |
`?connection=<handle>` on the sub-pages selects which of THIS organization's connections they describe (unknown or foreign handles fall back to the first).

## Status vs. form state (independent)
* Connection status is derived, never stored: Not connected · Disabled · Ready to test · Connected (`deriveWebsiteIntegrationStatus`).
* Form state: Not configured · Draft · Ready. Changing one never changes the other.

## Connection method / "who manages your website?"
Stored as guidance-only columns on the integration (`connection_method`, `website_manager`, both nullable). They never affect authorization or intake. `NULL` (every connection created before D1, including any manually provisioned one) shows as **Existing connection** and is left untouched — there is no partner-specific code.

## Nemryn form configuration
One row per organization (`website_request_forms`). Copy (title, intro, button, confirmation), an optional **subset** of services, `allow_recurring`, `require_service_choice`, `status`, and `version`. Fields required by the canonical intake contract (pickup, destination, return trip, requester name/relationship/phone) are always present and can't be hidden or removed; there is no free-form schema.
* **Services & Intake stays the source of truth.** The form can only list services the organization currently offers (the database rejects a saved subset containing one it doesn't; at read time the effective list is the intersection, and the editor tells the operator when a saved service is no longer offered). An organization that never configured offerings offers every canonical service, exactly like the intake function.
* `version` increments only when form *content* changes (not on a status-only change or identical save). The S4C `formVersion` is `nemryn-form-v<version>`.
* Saves are audited (`website_request_form_updated`: status + version only) and appear in Activity as "Website request form created/updated".

## Safe preview
Pure presentation of the (possibly unsaved) configuration: no `<form>`, no network call, disabled submit; "Preview confirmation message" only swaps local text.

## Developer package
Copy-ready text: endpoint, Integration ID, approved website / `Origin` requirement (a restriction, not a password), JSON payload, optional acquisition object, idempotency key, example server configuration, test steps. It never contains a service-role key, Supabase details, database ids, internal RPC names or the organization id.

## Not in D1 (handoff to D2)
No public/hosted form, no embed, no acquisition capture script, no binding of a form configuration to a specific integration (the configuration is per organization; D2 decides how a published form is served and stamps `formVersion`). The Nemryn-form page says placement comes next.

## Security
`website_request_forms` is a class-A table (RLS on, no policy, no client/service privilege); `get_website_request_form`, `save_website_request_form`, `set_request_intake_integration_setup` are SECURITY DEFINER RPCs granted to `authenticated` only and authorize Organization Admin of an ACTIVE organization (ZW002 for everyone else, including Platform Admin without Membership). The privilege contract (`supabase/tests/privilege_contract_tests.sql`, 0 violations of 28) was updated in the same phase.
