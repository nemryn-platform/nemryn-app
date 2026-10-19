# Estimates & Quotes production read-only verification

These scripts are **manual and owner-authorized only**. Never run them in CI or wire them to npm scripts.

- `preflight.mjs`: release and database contract (migrations, schema fingerprints, privileges, quote / task RPCs).
- `print-readonly.mjs`: print rendering of every Pilot Simulation quote, the O1 closed notice, ZD-227 wording, access
  refusals, and the PDF text.
- `records-integrity-readonly.mjs`: `snapshot <name>` (B6 before / after integrity snapshot); `check` (B5 records,
  activity, audit, permissions, Core boundary, timelines).

Run: `QUOTES_PROD_READONLY_ACK=read-only node tests/prod-readonly/plus-quotes/<script>.mjs`.

Guards, configuration and safety rules are described in
[`tests/e2e/plus-quotes/README.md`](../../e2e/plus-quotes/README.md#production-read-only-verification).
