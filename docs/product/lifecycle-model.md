# Zenward Mobility — Transportation Lifecycle, State & Transition Model

**Work item:** P1-E1-S2 — Transportation Lifecycle, State & Transition Model
**Phase:** P1 — Core Product Architecture
**Status:** Draft, pending review — Lifecycle Security Gate: READY (see end of document)
**Last updated:** 2026-08-30

This document defines lifecycle semantics on top of the entities confirmed in [domain-model.md](./domain-model.md). **No tables, enums, migrations, RLS policies, RPC functions, or state transitions are implemented here.** This is the state model the schema will encode.

---

## A. Lifecycle overview

Zenward does not have one status field. It has **five separate lifecycle concepts**, each owned by a different entity, none of which may be used to stand in for another:

1. **TransportationRequest lifecycle** — has this intent been reviewed and acted on?
2. **Trip lifecycle** — where is this specific movement, operationally, right now?
3. **TripAssignment lifecycle** — who is currently assigned, and what's the history of who was?
4. **TripException lifecycle** — is something outside normal status open or resolved?
5. **TripEvent history** — not a lifecycle with its own states at all; the append-only record of everything the other four did over time.

A great deal of what looks like "status" in the UI references is not a new lifecycle state on any entity — it's a **derived condition**, computed by combining two entities' real state (e.g., "Needs Assignment" is just "Trip is scheduled and no TripAssignment is active," not a value stored anywhere). Section K maps every UI label seen in prior references to exactly one of: TransportationRequest, Trip, TripAssignment, TripException, driver availability (a separate, not-yet-designed concept), or derived presentation — never more than one, and never invented as a new stored field just because a screen needed a word for it.

## B. TransportationRequest state model

**States:** `pending` → `accepted` | `declined` | `cancelled`

| State | Meaning | Terminal? |
|---|---|---|
| `pending` | Submitted (via public intake or internal entry), awaiting the operator's business decision. No distinct "under review" state. | No |
| `accepted` | Operations reviewed it and intends to service it (explicit **Accept Request**, P1-OPS-R1). Says nothing about whether a Passenger is linked or a Trip exists. | No — may still be cancelled while no Trip exists |
| `declined` | Operations reviewed a *new* request and will not service it. Reason required. | Yes |
| `cancelled` | A request that was *accepted* will no longer proceed. Reason required. | Yes |

**P1-OPS-R1 (ZD-204) supersedes the original "accepted = converted" rule.** Decision and operational readiness are separate:

- **Decision (stored `state`)** — changed only by explicit operator actions: `pending → accepted` (Accept), `pending → declined` (Decline), `accepted → cancelled` (Cancel). Linking a Passenger never accepts; accepting never creates a Passenger, Trip, or assignment.
- **Readiness (derived, never stored)** — an accepted request is *ready to schedule* once it has an active linked Passenger (the only requirement `create_trip` enforces). A Trip can be created **only** from an `accepted` request; `create_trip` never changes the request state.
- **A request can create zero, one, or many Trips.** Additional Trips (e.g. a return leg) are created from the same `accepted` request.
- **Request-level Cancel is only available while no Trip exists.** Once any Trip exists, cancellation is managed on each Trip — nothing cascades from the request.
- **Child Trip outcomes never write back onto Request.state.**
- **Terminal states:** `declined` and `cancelled`. No reopen / undo in this release.
- **Legacy data:** requests accepted before P1-OPS-R1 were accepted implicitly by their first Trip (so every one has a Trip); requests cancelled before P1-OPS-R1 were cancelled from `pending`. Both remain valid historical records.
- **Who may transition:** Dispatcher and Organization Admin of an active organization, for all three decisions. Never Driver, never a Platform Admin grant on its own.
- **Can the public requester cancel before review?** Not at MVP. No requester self-service capability is approved (per product-definition.md and the explicit instruction not to build one here). A requester wanting to withdraw a request does so through whatever channel operations currently uses (phone, etc.), and a staff member performs the `cancelled` transition — the request record itself does not grant the original submitter any direct mutation right.

## C. Trip state model

**A Trip can exist with Driver = Unassigned and Vehicle = Unassigned.** Assignment presence is never part of what makes a Trip "exist" or valid — see §D.

**Canonical states (9), unambiguous by construction:**

```
scheduled
  → en_route_to_pickup
    → arrived_at_pickup
      → passenger_onboard
        → en_route_to_destination
          → arrived_at_destination
            → completed

(from most non-terminal states) → cancelled
(from en_route_to_pickup or arrived_at_pickup) → no_show
```

| State | Meaning |
|---|---|
| `scheduled` | Trip exists with the minimum required data (passenger, pickup, destination, scheduled time). Driver/vehicle may or may not be assigned — irrelevant to this state. |
| `en_route_to_pickup` | Driver has started toward the pickup location. Requires an active TripAssignment. |
| `arrived_at_pickup` | Driver is at the pickup location; passenger not yet in the vehicle. |
| `passenger_onboard` | Passenger has been loaded (seatbelt/wheelchair securement, paperwork) but the vehicle has not necessarily started moving yet — a real, distinct operational moment for NEMT, where loading time is often non-trivial. |
| `en_route_to_destination` | Vehicle is actively moving toward the destination with the passenger aboard. |
| `arrived_at_destination` | Driver is at the destination; trip not yet closed out. |
| `completed` | Terminal. Trip finished successfully. |
| `cancelled` | Terminal. Trip called off before completion. |
| `no_show` | Terminal. An attempt was made (driver dispatched, typically arrived) and the passenger did not appear. |

**The "En Route" and "Arrived" ambiguity is resolved by construction, not by convention.** The backend never stores a bare `en_route` or `arrived` value — it is always the pickup-leg or destination-leg variant. The UI is free to display the shorter "En Route" / "Arrived" label (§28), but that is a presentation choice made from a known, unambiguous backend state, never the state itself.

**Completion requires arrival first.** `completed` is only reachable from `arrived_at_destination` — a trip cannot be marked complete while still `en_route_to_destination`. This guarantees every completed trip has an explicit, recorded arrival moment behind it.

## D. Should Trip have Draft? (resolved — no)

**MVP recommendation: A — create a Trip only when the minimum required data is valid.** No `draft` state.

There is no approved "Save Draft Trip" workflow, and introducing one speculatively would add a state with no defined entry/exit rules or approved UI. Current behavior — a Trip is created directly into `scheduled` with driver/vehicle simply absent — already covers "not yet assigned" without needing a separate draft concept; an unassigned `scheduled` Trip *is* the minimal, real, valid form of an incomplete-but-existing trip. If a genuine draft/multi-step trip-creation workflow is approved later, that is a new, deliberate decision, not a default.

## E. Assigned is not a Trip state (confirmed, unchanged from P1-E1-S1)

TripAssignment remains the sole source of truth for who is on a trip (ZD-051). Trip.state never encodes assignment presence. The derivation is:

```
Trip.state = scheduled AND no active TripAssignment  →  UI: "Needs Assignment"
Trip.state = scheduled AND active TripAssignment exists  →  UI: "Assigned"
Trip.state beyond scheduled (en_route_to_pickup, etc.)  →  an active TripAssignment is a precondition, not a displayed status in its own right
```

**Canonical vs. derived, explicitly:**

| Label | Canonical (stored) | Derived (computed) |
|---|---|---|
| Scheduled, En Route (either leg), Arrived (either leg), Passenger Onboard, Completed, Cancelled, No Show | ✅ Trip.state | |
| Needs Assignment | | ✅ Trip.state = scheduled + no active TripAssignment |
| Assigned | | ✅ Trip.state = scheduled + active TripAssignment |
| Running Late | | ✅ see §16/K |

## F. Trip Assignment lifecycle

TripAssignment remains append-only history, unchanged from the confirmed P1-E1-S1 model: active assignment = the row with `ended_at IS NULL`; reassignment closes the current row (`ended_at`, reason) and inserts a new one; history is never rewritten.

**Evaluated additions — recommendation is to add none as enum states:**

- **Assignment created / ended / reassigned** — already fully represented by `assigned_at`/`ended_at`/`end_reason` timestamps and row insertion. No enum needed; timestamps are cleaner (§7 principle: don't add an enum where timestamps/events are cleaner).
- **Driver acknowledgement — genuinely unresolved, flagged rather than guessed.** Recommendation: **useful but deferred, not required MVP behavior.** No approved driver workflow currently requires a driver to explicitly acknowledge an assignment before acting on it (prior "Acknowledged" references were not approved). If adopted later, it should be represented as a nullable `acknowledged_at` timestamp directly on the TripAssignment row — a fact-in-time, not a branching state — never a new enum value. **This needs explicit product confirmation before schema design treats it as required or absent.**
- **Assignment declined by driver — not designed, flagged as open.** No approved capability for a driver to decline an assignment exists. If ever added, the cleanest representation is simply ending the assignment (`ended_at`, `end_reason = 'declined_by_driver'`) rather than a distinct "declined" status — functionally indistinguishable from any other assignment closure except for who initiated it and why, which the existing `end_reason` field already captures. **Whether drivers get this capability at all is an open product question**, not an architecture gap.

## G. Trip Exception lifecycle

**States:** `open` → `resolved`. No third `dismissed` state — a raised-in-error or no-action-needed exception is simply `resolved`, with the resolution note explaining that no action was taken. Adding a distinct state for that would track a distinction the resolution note already carries.

- **Who may create:** Dispatcher, Organization Admin (any exception type). Driver may create one, but only on a trip they are actively, legitimately assigned to (consistent with the driver-assignment-scoped principle established in domain-model.md §H).
- **Who may resolve:** Dispatcher, Organization Admin only. A driver may raise an issue; only operations closes it — matching the same create-only pattern already established for driver-authored TripNotes.
- **Resolution generates an event:** yes — an informational TripEvent recording who resolved it, when, and the resolution note.
- **Does an open exception block Trip transitions?** No, not at MVP. An open exception is an attention flag, not a hard gate — e.g., an open "vehicle issue" exception does not by itself prevent marking `arrived_at_pickup`. Building per-exception-type hard-blocking rules is a real future refinement, not something approved or needed now; documented here so it isn't silently assumed either way.
- **Taxonomy:** not finalized (per instruction). Examples referenced (passenger unavailable, location issue, driver delay, vehicle issue, timing conflict, return-confirmation pending) remain illustrative, not a committed enum.

## H. Trip Event model

TripEvent is the append-only, human-readable operational timeline — not itself a lifecycle with states. Four categories, not one flat list:

| Category | Purpose | Examples (illustrative, not final) |
|---|---|---|
| **State-transition events** | Mirror every Trip.state change 1:1 | `trip_scheduled`, `en_route_to_pickup`, `arrived_at_pickup`, `passenger_onboard`, `en_route_to_destination`, `arrived_at_destination`, `trip_completed`, `trip_cancelled`, `no_show_recorded` |
| **Assignment events** | Human-readable narrative of TripAssignment changes — TripAssignment stays the canonical, queryable source of truth for "who is assigned right now"; these events exist so the timeline reads naturally without a dispatcher needing to separately query TripAssignment | `driver_assigned`, `driver_reassigned`, `assignment_ended` |
| **Informational events** | Occurrences that don't change Trip.state but have operational/audit value | `driver_called_passenger`, `exception_flagged`, `exception_resolved` |
| **System events** | Automated, non-human-triggered occurrences | `request_converted_to_trip` |

**Immutability (confirmed, unchanged from P1-E1-S1):** TripEvent is append-only for ordinary actors — no UPDATE, no DELETE, for Driver or Dispatcher. A needed correction is a new compensating event, never a rewrite of history. No exceptions carved out here.

## I. Cancellation model

| Question | Answer |
|---|---|
| Who may cancel? | Dispatcher, Organization Admin. |
| Public requester? | Not directly — no self-service capability approved. A requester-initiated cancellation goes through operations (phone/existing channel), who perform the actual transition. |
| Driver? | **Cannot execute a cancellation.** A driver may *request* one — by raising a TripException (or a driver-visible-adjacent note) describing why — but only Dispatcher/Organization Admin perform the `→ cancelled` transition. |
| Facility user? | Not applicable — no facility accounts exist (deferred, see domain-model.md §I). |
| Source states | Any non-terminal state (`scheduled` through `arrived_at_destination`). Not from `completed` or `no_show` — already terminal. |
| What happens to the active TripAssignment? | Closed (`ended_at` set, `end_reason = 'trip_cancelled'`) — never deleted, preserved as history like any other assignment closure. |
| What event is recorded? | `trip_cancelled` TripEvent, with actor, timestamp, and the cancellation reason. |
| Reason required? | Yes — mandatory, not optional, given the audit value of knowing why a trip didn't happen. |
| Can a cancelled Trip be reopened? | No, for normal actors — `cancelled` is terminal like `completed`. A cancellation made in error is corrected only through the privileged administrative-correction path (§N/§26), with a mandatory reason and an AuditEvent — never a normal "uncancel" action in ordinary operations UI. |

## J. No-show model

**`no_show` is a Trip terminal state**, deliberately distinct from a `passenger_unavailable` TripException:

- **`passenger_unavailable` (TripException, `open`)** — an in-progress concern raised while still attempting the trip (e.g., driver has arrived and is trying to reach the passenger). This is not yet an outcome — it's a flag that something needs attention.
- **`no_show` (Trip.state, terminal)** — the deliberate, explicit decision that the attempt is over and the passenger did not travel. This is always a human decision (driver or dispatcher), never automatic or time-triggered, because the exact wait-time policy that would justify an automatic call is still unresolved (decision register ZD-020 — wait-time rules UNKNOWN).
- **Recommended flow:** `arrived_at_pickup` (or, less commonly, `en_route_to_pickup` if contact fails before arrival) → optionally an open `passenger_unavailable` exception while attempting contact → an explicit `no_show` transition, which also resolves that exception (its resolution note references the no-show outcome).
- **Source states for `no_show`:** `en_route_to_pickup` or `arrived_at_pickup` only — not `scheduled` (too early; that's a cancellation, not a no-show, since no attempt was made) and not later legs (the passenger is, by definition, already aboard by then).

This distinction matters beyond the state model itself: NEMT operations need `no_show` as an unambiguous, queryable, billing-relevant outcome, separate from an ordinary cancellation — even though billing itself is deferred (domain-model.md §P), the state model should not need to be redesigned when it arrives.

## K. UI label → domain concept map

| UI label | Domain home | Notes |
|---|---|---|
| Requested | TransportationRequest (`pending`) | |
| Scheduled | Trip (`scheduled`) | |
| Needs Assignment | **Derived** | `scheduled` + no active TripAssignment |
| Assigned | **Derived** | `scheduled` + active TripAssignment |
| En Route | Trip, but **ambiguous as written** | Backend is always `en_route_to_pickup` or `en_route_to_destination` — never a bare value |
| Arrived | Trip, but **ambiguous as written** | Backend is always `arrived_at_pickup` or `arrived_at_destination` |
| Passenger Onboard | Trip (`passenger_onboard`) | |
| Completed | Trip (`completed`) | |
| Running Late | **Derived** (§16) | Computed from scheduled time vs. now; escalates to a TripException only if someone needs to act on or record the delay — never a Trip state or stored field |
| Pending Confirmation | TransportationRequest (`pending`) **or** an unfulfilled return leg | Not a Trip state. If used for "return trip not yet arranged," that's simply the absence of a second Trip row against the request — not a state on anything |
| Available / On Trip / Break / Unavailable | **Driver availability — not Trip lifecycle at all** | See §L. A separate, currently undesigned concept |

No label above is allowed to mean two different things depending on screen — each row is a single, fixed home.

## L. Driver availability is not Trip lifecycle

`Available`, `On Trip`, `Break`, `Unavailable` describe a **Driver's own operational availability**, not any Trip's state. They belong nowhere in the Trip, TripAssignment, TransportationRequest, or TripException models defined above, and must never be derived from or stored as a Trip field.

This document does **not** design that concept — a driver scheduling/shift/availability system is out of scope here per the explicit instruction not to fully model it unless required for *lifecycle clarity*, and it is not required for the clarity of the five lifecycles above. Flagged as a deferred concept (§S) for its own future work item.

## M. Request status is not Trip status

Public-facing wording driven by TransportationRequest.state must never imply anything about driver assignment, vehicle confirmation, or a locked ride time — those facts live on Trip/TripAssignment, which the public surface does not expose (domain-model.md §M — Public has no read access to Trip or TripAssignment).

| Request state | Permitted public-facing implication | Forbidden implication |
|---|---|---|
| `pending` | Received / under review | "Confirmed," any driver/vehicle/time detail |
| `accepted` | Accepted for scheduling | A specific driver, vehicle, or locked pickup time — those are Trip/Assignment facts, not Request facts |
| `declined` | Unable to accommodate (exact copy is a content decision, deferred) | — |
| `cancelled` | Cancelled | — |

**"Ride Confirmed" is never permitted copy for a Request state alone**, at any point — that phrase describes a Trip/Assignment fact, and Request never reaches into that layer.

## N. Actor / transition permission matrix

Actors: Public unauthenticated requester, Authenticated requester (future), Organization Admin, Dispatcher, Driver, Platform Admin, System/trusted server.

### TransportationRequest transitions

| Transition | Allowed actor | Notes |
|---|---|---|
| (create) → `pending` | Public (controlled path only), Dispatcher, Org Admin | See domain-model.md §L public-intake boundary |
| `pending` → `accepted` | System | Triggered by Trip creation, not a discretionary action |
| `pending` → `declined` | Dispatcher, Org Admin | |
| `pending` → `cancelled` | Dispatcher, Org Admin | Requester-initiated, but staff-executed (§B) |

### Trip transitions

| Transition | Allowed actor | Required relationship | Required current state | TripEvent? | AuditEvent? | Assignment required? |
|---|---|---|---|---|---|---|
| (create) → `scheduled` | Dispatcher, Org Admin | Membership in target org | — | `trip_scheduled` | No (routine) | No |
| `scheduled` → `en_route_to_pickup` | Driver | Active TripAssignment belongs to this driver | `scheduled` | `en_route_to_pickup` | No | Yes |
| `en_route_to_pickup` → `arrived_at_pickup` | Driver | Same as above | `en_route_to_pickup` | `arrived_at_pickup` | No | Yes |
| `arrived_at_pickup` → `passenger_onboard` | Driver | Same as above | `arrived_at_pickup` | `passenger_onboard` | No | Yes |
| `passenger_onboard` → `en_route_to_destination` | Driver | Same as above | `passenger_onboard` | `en_route_to_destination` | No | Yes |
| `en_route_to_destination` → `arrived_at_destination` | Driver | Same as above | `en_route_to_destination` | `arrived_at_destination` | No | Yes |
| `arrived_at_destination` → `completed` | Driver | Same as above | `arrived_at_destination` | `trip_completed` | No (routine) | Yes |
| any non-terminal → `cancelled` | Dispatcher, Org Admin | Membership in target org | not already terminal | `trip_cancelled` | Yes (mutation of an in-flight trip) | No |
| `en_route_to_pickup` or `arrived_at_pickup` → `no_show` | Dispatcher, Org Admin, or Driver (own assignment) | Membership or active assignment | as listed | `no_show_recorded` | Yes | Yes |
| any terminal → anything | **Nobody**, via normal transition | — | — | — | — | — |
| privileged correction of any state | Platform Admin (verified PlatformAdminGrant) | See §26 | any | compensating event | Yes, mandatory | — |

### TripAssignment transitions

| Transition | Allowed actor | Notes |
|---|---|---|
| (create) — initial assignment | Dispatcher, Org Admin | |
| close current + create new — reassignment | Dispatcher, Org Admin | Atomic: close-then-insert in one transaction |
| close current, no replacement — unassign | Dispatcher, Org Admin | Trip reverts to "Needs Assignment" (derived) |
| Driver: any write | **Never** | Driver has read-only access to their own assignment (domain-model.md §17) |

### TripException transitions

| Transition | Allowed actor | Notes |
|---|---|---|
| (create) → `open` | Dispatcher, Org Admin (any type); Driver (own assigned trip only) | |
| `open` → `resolved` | Dispatcher, Org Admin only | Driver cannot resolve, even their own |

## O. RLS / security transition rules

**The controlled transition boundary (confirmed as the required future mutation pattern — not implemented in this phase):**

```
Driver action
  → controlled transition boundary (future RPC / trusted server function)
  → verify auth user
  → verify active membership
  → verify linked Driver
  → verify active TripAssignment
  → verify organization consistency (Trip.organization_id = Assignment.organization_id = Driver.organization_id)
  → verify current Trip state
  → verify requested transition is allowed from that state
  → update Trip state
  → append TripEvent
  → append AuditEvent where appropriate
  → commit atomically
```

No future Driver client is ever granted a generic `UPDATE trips SET state = <value>` capability. A driver requests a specific, named transition; the boundary validates every precondition above before anything is written. Operations staff go through an equivalent boundary with the actor checks appropriate to their role — operations does not get unlimited lifecycle mutation either (§10): normal lifecycle transitions (schedule, assign, cancel, mark no-show, resolve exception) are available to Dispatcher/Org Admin; **administrative correction** (rewriting a state that was recorded in error) is a categorically different, privileged action requiring elevated verification, a mandatory reason, and an AuditEvent — never available through the same button as a normal transition.

**Driver RLS requirement, stated precisely (per instruction §25):** a Driver may perform a lifecycle transition only when *all* of the following hold simultaneously:
- the authenticated user maps to a Driver record;
- that Driver belongs to the same organization as the Trip;
- the driver's organization Membership is active where membership is otherwise required;
- an active TripAssignment (`ended_at IS NULL`) exists and belongs to that Driver;
- `TripAssignment.organization_id = Trip.organization_id` (composite-FK-backed, per domain-model.md §N);
- the requested transition is a legal edge from the Trip's current state.

**A driver must never gain any right merely from knowing a Trip ID.** Every check above is independent of whether the ID is known — guessing or being told a UUID grants nothing without the relationship chain above holding.

## P. Platform Admin correction principle

Platform Admin lifecycle intervention exists for genuine correction of mistakes, not routine operation. Any privileged correction must:
- verify a valid PlatformAdminGrant (domain-model.md §B entity 4) — never inferred from any other role;
- record a mandatory reason;
- create an AuditEvent;
- preserve prior state history (TripEvent/TripAssignment rows are never deleted or rewritten to make a correction look like it never happened);
- never silently delete operational evidence — a correction is itself a new, visible fact in the record, not an erasure of the old one.

## Q. Atomic mutation requirement

Every state-changing lifecycle mutation — Trip.state update, its corresponding TripEvent insert, and any required AuditEvent — must occur in a single database transaction. The system must never be observed in a state where the Trip moved but no event exists, or an event exists describing a transition that didn't actually apply. The likely future implementation is a PostgreSQL function (Supabase RPC) or an equivalent trusted server-side transaction wrapping all three writes — not implemented in this phase.

## R. Concurrency / idempotency strategy

Recommended, simplest-robust-for-MVP approach — no over-engineering:

| Race condition | Control |
|---|---|
| Dispatcher cancels while driver marks arrival, simultaneously | **Expected-current-state validation** inside the transition function, combined with row-level locking (`SELECT ... FOR UPDATE`) on the Trip row for the duration of the transaction — whichever request's transaction commits first wins; the second is rejected because the Trip is no longer in the state its request assumed |
| Two operations users attempt reassignment simultaneously | The future **partial unique index** (one active TripAssignment per trip, `ended_at IS NULL`) makes a second concurrent "insert new active assignment without closing the current one" fail at the constraint level; the correct atomic operation closes-then-inserts within one locked transaction |
| Driver retries the same transition (poor connectivity) | **Treat "requested transition target already equals current state" as an idempotent no-op success**, not an error — distinct from "invalid transition from the wrong state," which still errors. This covers duplicate submissions and double-taps without needing a client-generated idempotency key |
| Two browser requests submit the same transition | Same no-op handling as above |

**Explicitly not adopted at MVP:** client-supplied idempotency keys (the no-op-on-matching-state rule covers the realistic retry cases without the added protocol complexity) and `updated_at`/version optimistic-concurrency columns (redundant given row-level locking plus expected-current-state validation already prevent lost updates). Both are documented here as the next escalation if the simpler approach proves insufficient in practice — not built preemptively.

## S. Adversarial transition test matrix

Restated as the mandatory future test suite for lifecycle enforcement, alongside the RLS test matrix in domain-model.md §O:

| Test | Scenario | Expected |
|---|---|---|
| A | `scheduled → en_route_to_pickup`, by the assigned Driver | ALLOW |
| B | `scheduled → completed`, by a Driver | DENY |
| C | `en_route_to_pickup → arrived_at_pickup`, by the assigned Driver | ALLOW |
| D | Org A Driver attempts a transition on an Org B Trip | DENY |
| E | Org A Driver attempts a transition on another Org A Driver's Trip | DENY |
| F | Driver attempts a transition after their assignment ended/was reassigned | DENY |
| G | `cancelled → en_route_to_pickup`, by a normal Driver | DENY |
| H | `completed → arrived_at_destination`, by a normal Driver | DENY |
| I | Driver repeats an identical transition already applied (retry) | Idempotent no-op success, not an error |
| J | Operations cancels an active Trip | Controlled transition + `trip_cancelled` event + TripAssignment closed |
| K | Two simultaneous reassignment attempts on the same Trip | At most one active TripAssignment results |
| L | Direct Supabase REST call attempting a state mutation, bypassing the UI | Same authorization result as through the application |
| M | Driver attempts to set an arbitrary/unlisted state value | DENY |
| N | Driver creates an operational event without a corresponding permitted state transition | DENY |
| O | User with an inactive Membership attempts any transition | DENY |

## Deferred lifecycle concepts

- Driver acknowledgement of assignment (recommended: useful-but-deferred; representation if adopted: `acknowledged_at` timestamp) — **needs product confirmation**.
- Driver decline-assignment capability — not designed; **needs product confirmation** whether it exists at all.
- Exact wait-time / no-show timing policy (still ZD-020, UNKNOWN) — doesn't block the state model, but blocks giving drivers/dispatchers a concrete "when are you allowed to mark no-show" rule.
- TripException severity/taxonomy beyond illustrative examples.
- Driver availability/shift system (§L) — a separate future concept, not designed here.
- Requester self-service cancellation or status visibility.
- Exact cancellation-reason taxonomy (free text vs. fixed categories).
- Exact public-facing copy for each Request state (a content decision, not architecture).
- Client-supplied idempotency keys and optimistic-concurrency versioning (§R) — deferred unless the simpler approach proves insufficient.
- Billing-relevant implications of `no_show` vs. `cancelled` (billing itself remains fully deferred per domain-model.md §P).

## Open product questions

1. Is driver acknowledgement of assignment required for MVP, or genuinely deferred? (§F)
2. Do drivers get any assignment-decline capability, ever? (§F)
3. Is a lightweight `leg` label (`outbound` / `return` / `unspecified`) on Trip wanted for return-trip UI grouping, or is shared `request_id` alone sufficient? (§I open item, domain-model.md §20 topic)
4. Exact public-facing copy for each Request state (§M) — a copywriting decision, not blocking architecture.
5. Exact cancellation-reason taxonomy — free text at MVP is assumed sufficient; confirm.

None of the above block the Lifecycle Security Gate below — each is either a UX/copy decision or an additive feature whose absence doesn't weaken enforcement of what's already defined.

## Return transportation model

Outbound and return transportation are **separate Trip rows**, never one Trip that changes direction. Both link back to the same TransportationRequest via `request_id` — no new relational entity is introduced.

- **Grouping:** `WHERE request_id = ?` is sufficient to find every Trip belonging to one request. A lightweight, optional `leg` label (`outbound` | `return` | `unspecified`) on Trip is recommended for display convenience (avoids inferring direction from timing alone) — flagged above as needing confirmation rather than assumed.
- **Independent timing:** the two Trips are not required to share identical lifecycle timing. "Outbound completed, return pickup time unknown" is simply: one Trip row in `completed`, and the return Trip **does not exist yet** — it is created later, as a second, ordinary act of Trip creation against the same request, once return details are confirmed. There is no "pending return" Trip state to design; a not-yet-arranged return is the *absence* of a second Trip row, not a state on anything.
- **"Return: not sure yet" at request time** never causes a placeholder Trip to be created — it's simply information captured on the request (already covered by TransportationRequest fields, domain-model.md §B), resolved later by operations deciding whether/when to create the second Trip.

---

## Security gate

**LIFECYCLE SECURITY GATE — READY**

Every requirement is met: TransportationRequest lifecycle is defined (§B, 4 states); Trip lifecycle is defined (§C, 9 unambiguous states with resolved En Route/Arrived ambiguity); TripAssignment lifecycle is defined (§F, timestamp-based, no enum, with acknowledgement/decline explicitly flagged rather than silently assumed); TripException lifecycle is defined (§G, open/resolved); terminal states are defined for every entity (`accepted`/`declined`/`cancelled` for Request; `completed`/`cancelled`/`no_show` for Trip); actor transition permissions are defined (§N); driver transition constraints are defined precisely enough to implement RLS from directly (§O); UI-derived statuses are fully separated from canonical state (§E/§K — nothing stored merely because a screen needed a label); cancellation behavior is defined (§I); no-show behavior is defined and distinguished from the related exception (§J); the atomic-transition requirement is stated (§Q); a concurrency strategy is recommended without over-engineering (§R); and the adversarial test matrix is defined (§S).

The five open questions are genuinely non-blocking: driver acknowledgement/decline are additive UX decisions whose absence doesn't weaken any enforcement already specified; the `leg` field is a display convenience; cancellation-reason taxonomy and request-state copy are content decisions. None of them prevent secure transition enforcement for the model as defined.
