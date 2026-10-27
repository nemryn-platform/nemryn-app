# Nemryn pilot demo — runbook (fictional data, isolated stack)

A 15–20 minute walkthrough for a small NEMT agency. It follows one private-pay customer from a website inquiry to a
paid invoice. Everything is **fictional** and runs on the **isolated local stack**, never on production:
- **No real patients:** every name and number is fictional.
- **No production writes:** nothing is created in production.
- **No public inquiry form:** none is enabled for real visitors.

## Before the call (5 minutes)

1. Start the isolated stack and the app (see `tests/e2e/fixtures/README.md` §1). Use
   `source ~/NemrynS1Iso/.env.isolated.local && npx next start -p 3100` with `PLUS_INQUIRY_SUBMISSIONS` unset.
2. Stage the story:

   ```bash
   node tests/e2e/demo/pilot-demo.mjs prepare --confirm-isolated=NemrynS1Iso
   ```

   This is idempotent: it resets first. It leaves Fictional Org A with:
   - **Nemryn Plus** switched on, so Growth is visible.
   - **Business phone and address**, so they print on the quote and invoice.
   - **A returning rider,** "DEMO Rose Fictional", who uses a walker.
   - **A website inquiry** from her daughter, "DEMO Dana Fictional".
   - **A contact and opportunity** converted from that inquiry.
   - **An accepted round-trip dialysis quote.**
3. Sign in at `http://localhost:3100` as `org-a-admin@example.test` (fictional seed password). Keep a second private
   window signed in as `org-a-driver-a@example.test` for the driver part.
4. Run `node tests/e2e/demo/pilot-demo.mjs status` to check the staged state. "public access" must be 0.

## The story

| # | Show | Where | Talking point |
|---|------|-------|---------------|
| 1 | **Getting started** | Sidebar → Getting started (or the Brief banner) | Every step is marked complete only from real data, and admin-only steps are labelled. This is setup guidance, not a compliance certification. |
| 2 | **Inquiry** | Growth → Inquiries → "DEMO Dana Fictional" | The website inquiry recorded consent, what was asked and who is asking (a family member). |
| 3 | **Opportunity + quote** | Growth → Pipeline → "DEMO Dana — dialysis rides…" | Contact, consent, accepted round-trip quote. Print the quote: your business phone and address are on it. |
| 4 | **Booking handoff** | Same opportunity → **Create transportation request** | "Family member" and "Return trip: Yes" are suggested from the inquiry and quote. **Who will ride?** lists "DEMO Rose Fictional — same phone as the contact" first, but nothing is pre-selected. Choose her, confirm "I've checked…", then enter the pickup and destination ("Not stored in Growth"). Review, then Confirm. |
| 5 | **Core takes over** | Open the request in Operations | Pending: the passenger is linked and the Growth link is shown. Operations decides: **Accept Request**. |
| 6 | **Schedule + dispatch** | Request → create the trip → Dispatch | Assign "Fictional Driver A1" and "Fictional Van A1". |
| 7 | **Driver app** | Second window (driver) → Driver | Start → arrive → onboard → arrive → complete. Proof of service is captured. |
| 8 | **Invoice** | Trip Detail → Billing → Create invoice | The originating quote is offered for import, and its lines and number are kept. Issue it, then print or save it as a PDF. |
| 9 | **Payment** | Invoice → Record payment | Record a check payment. The invoice shows paid, and you can print a receipt. |

Alternative for step 4: leave "Who will ride?" on "Decide on the request page", or type a **new rider's name**. The
request then shows "Requested passenger" with **Add New Passenger** prefilled. Passengers are always created in
Operations, never in Growth.

## After the call

```bash
node tests/e2e/demo/pilot-demo.mjs reset --confirm-isolated=NemrynS1Iso
```

This removes every DEMO row:
- **Billing:** the demo's issued invoice and payment are removed together, so nothing is orphaned.
- **Restored:** Org A goes back to Core-only and its business details are cleared, but only if the demo set them.
- **Other data:** fixtures from other suites are not touched.

Run `prepare` again for the next demo.

## Guard rails

The demo script fails closed (`tests/e2e/demo/isolation-guard.mjs`). Before any database statement runs, it proves all
of these:
- **No remote destination:** no `DATABASE_URL`, `SUPABASE_URL`, `PGHOST` or similar variable points anywhere other than
  `localhost`, `127.0.0.1` or `::1`.
- **The right container:** exactly `supabase_db_NemrynS1Iso`, running, with the Supabase CLI project label
  `NemrynS1Iso`. No container override or "other local stack" flag is accepted.
- **Local Docker:** Docker is the local unix socket, and `DOCKER_HOST` is not set.
- **The right project:** `~/NemrynS1Iso/supabase/config.toml` has `project_id = "NemrynS1Iso"`, and its database port
  matches the container's published port.
- **Loopback:** a database answers on `127.0.0.1` at that port.
- **Fictional data:** the database carries the fictional seed fingerprint. Both seed organizations and the seed admin
  are present, and the production Pilot Simulation organization is absent.

If any check fails, it prints "REFUSED … Nothing was changed." and exits with code 2.

Further safeguards:
- **Confirmation:** `prepare` and `reset` change data, so they require `--confirm-isolated=NemrynS1Iso`. `status` only
  reads.
- **Re-check inside the database:** every statement batch first re-checks the fingerprint inside the database session.
  This covers the local database name and the local socket. If the check fails, the batch stops before anything else
  runs.
- **Billing ledger:** the reset step that bypasses the append-only ledger therefore cannot run on any other database.
- **No production access:** the script only uses `docker exec` on the local container, never the Supabase CLI's linked
  production project.
- **Inquiry intake:** it is enabled for one submission inside the isolated database and removed straight away. The app's
  public submission switch stays off.
- **Not the Pilot Simulation tenant:** do not use the production "Nemryn Pilot Simulation" tenant for this story. It has
  no open opportunity and no inquiry form, and running the story there would create production records.
