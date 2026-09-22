# Nemryn request form: publication, hosted form, embed (P1-COMM-D2)

An Organization Admin configures the Nemryn form (D1), marks it **Ready**, then **Publishes** it. Publishing yields two things and nothing else to manage: a **hosted form** link and one **embed** snippet. The operator never sees an API, key, integration id or CORS setting.

## Three separate concepts
| Concept | Values | Lives in |
|---|---|---|
| Form (authoring) | Not configured · Draft · Ready | `website_request_forms` (D1, unchanged) |
| Publication | Not published · Published · Disabled | `website_request_form_publications` |
| Connection status | Not connected · Disabled · Ready to test · Connected | derived (existing semantics); a published form is **Ready to test** until the first real Request arrives through it — Published never means Connected |

## Architecture
* `website_request_forms` = *what the form contains*. `website_request_form_publications` = *where/how it is public*. One publication per form (one form per organization) for the MVP; ids and composite keys keep multiple forms/brands possible later.
* **Snapshot.** A publish copies the form content + version into the publication. Editing a form never changes what is live; **Publish update** does. A passenger's evidence therefore never lies: the S4C `formVersion` recorded is `nemryn-form-v<N>` of the snapshot they saw. The publication keeps the list of versions ever published, so a passenger still holding the previous published version open is recorded as that version, while a client-claimed version that was never published is replaced by the current one (server-authoritative).
* **Public key.** `form_` + 32 hex characters (128 bits of CSPRNG). An addressing identifier, not a secret; never derived from an organization/form/integration id. Stable across updates and disable/re-enable.
* **Intake binding.** First publish creates a hidden `request_intake_integrations` row of the new type `nemryn_form` (no origins). Requests therefore keep the existing provenance (source web, Request Hub “Website”), idempotency and notification pipeline. Every website path filters `integration_type = 'website'`, so the website-origin endpoint can never reach a form binding, and the operator's connection list never shows it.
* **One Request-creation primitive.** The body of `submit_public_transportation_request` after tenant/Origin resolution was extracted verbatim into the owner-only `_create_public_request`. Website intake (integration + suspension + Origin) and `submit_public_form_request` (publication + suspension + snapshot rules) both call it. No second Request schema; no fabricated Origin.

## Public surface
| Route | Purpose |
|---|---|
| `GET /request/[publicKey]` | Hosted form. Not frameable (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), not indexed. |
| `GET /embed/request/[publicKey]` | The page the loader iframes. Frameable (`frame-ancestors *`) — this route only. |
| `GET /embed/request-form.js` | The loader (public static, 5-minute cache, nosniff). |
| `GET /api/public-forms/[publicKey]` | Passenger-facing config only (org display name, copy, services, flags, version). No ids, no Settings. |
| `POST /api/public-forms/[publicKey]/submit` | The one public write. Closed body schema, durable rate limit (existing limiter, keyed by the public key + one-way client hash), narrow `service_role` RPC. Same-origin only (a cross-site browser `Origin` is refused). Responds `{"ok":true}` or a generic passenger-safe message. |
Unknown, malformed, unpublished, disabled and suspended-organization keys are indistinguishable (identical 404s).

## Embed
```html
<div data-nemryn-request-form="form_…"></div>
<script src="https://app.nemryn.com/embed/request-form.js" async></script>
```
The loader builds an isolated iframe (no CSS leaks either way), auto-resizes it, and passes the page's S4C-safe acquisition context. **postMessage**: the loader trusts only messages from its own iframe window *and* the Nemryn origin, only the documented protocol, only a clamped numeric height; it addresses the iframe with the Nemryn origin, never `*`. Inside the iframe the form trusts a `context` only from `window.parent`, re-sanitises it, and (after the first verified context) posts `resize`/`submitted` only to that verified origin; the initial content-free `ready` hello is the single `*` message. The iframe submits **same-origin** to Nemryn — the loader never handles or sends passenger data.

**Decision — submission path.** The brief preferred iframe → loader → endpoint. The chosen equivalent is iframe → same-origin endpoint with the parent context passed by message: it needs no CORS on the public write endpoint, keeps passenger data out of the tenant page's JavaScript entirely, and preserves every required property (tenant resolved from the key, server revalidation, no client organization id).

**Decision — framing.** `frame-ancestors` cannot be narrowed reliably to the operator's site (staging domains, builder previews), so it is open for the embed route only; the publication state, closed schema and rate limit are the authoritative controls. The hosted form and the rest of the app keep (or gain) no weaker framing. (The pre-existing absence of framing headers on authenticated pages is unchanged and noted as a recommendation.)

## Acquisition (S4C, unchanged schema)
* Hosted: UTM values from the URL, `landingPath`/`submissionPath` = the hosted pathname, `referrerHost` = hostname of `document.referrer` (same-site dropped), `formVersion`. The query string, click ids and full URLs are never stored.
* Embed: the loader reads the **tenant page** (utm_*, pathname, referrer hostname) and keeps the **first observation in the browser session** in `sessionStorage` under `nemryn:request-form:<key>:acquisition` (S4C values only — never passenger data). **The loader only knows pages it ran on**: if it is present only on the request page, that page is the landing path. Nemryn does not claim full-site first-touch attribution; a later site-wide helper could.
* Best-effort: bad/absent acquisition never blocks a Request (the snapshot then holds only the server `formVersion`).
* Reduced cases: builders that run embedded code in their own frame (e.g. Wix) expose only that frame's page; a plain iframe fallback has no loader, so no auto-resize and only `formVersion`.

## Privacy
Passenger input lives in component state only: never localStorage, sessionStorage, IndexedDB, cookies or any cache/service worker. The only browser storage is the acquisition-only key above. Confirmation shows the configured message only (no Request id). A honeypot was considered and rejected (accessibility / autofill false positives); the durable rate limit is the spam control. No CAPTCHA or third-party service.

## Operator experience
Settings → Website Requests → Use a Nemryn form → configure → Ready → **Publish form** → *Hosted form* (Open form, Copy link) and *Website embed* (Copy embed code; collapsed code; “My website removes scripts” iframe fallback; guidance per builder). **Publish update** appears when a saved version is newer than the live one; **Disable public form** (confirm) makes the link/embed unavailable while history stays; **Publish again** re-enables under the same key. Changes are audited (`website_request_form_published` / `_unpublished`) and shown in Activity.

## Where to paste the embed (be precise; none is a native integration)
* **WordPress** — Custom HTML block. Some plans/roles strip scripts → use the iframe version or link to the hosted form.
* **Wix** — Add → Embed Code → Embed HTML (Code). Wix runs it in its own frame: the form works, page-level attribution is limited.
* **Squarespace** — Code Block (Display Source off). Running scripts depends on the plan → iframe version or the hosted link.
* **Webflow** — Embed element, then publish the site.
* **Custom HTML** — paste where the form should appear.
Nothing here is a plugin, marketplace app or extension.

## Security summary
`website_request_form_publications`: class-A table (RLS on, no policy, no privilege for anon/authenticated/service_role). New `authenticated` RPCs (Org Admin of an ACTIVE org only; everyone else ZW002, incl. Platform Admin without Membership): `get_website_request_form_publication`, `publish_website_request_form`, `disable_website_request_form_publication`. New `service_role` RPCs, EXECUTE only: `get_public_request_form`, `submit_public_form_request`. Internal, no grant: `_create_public_request`, `_public_form_service_types`. Privilege contract 0 violations of 28.

## Not in D2
No vanity domain / `request.nemryn.com` (D3), WordPress plugin, Wix/Squarespace app, Facility Portal, broker integration, analytics/growth dashboard, payments, site-wide attribution helper, multiple forms/brands, Zenward changes (Zenward keeps its own branded form).
