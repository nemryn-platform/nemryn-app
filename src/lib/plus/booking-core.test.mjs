// NP-P2-S4 -- conversion & rebooking pure rules. Run with:
//
//   node --test src/lib/plus/booking-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const b = await import("./booking-core.ts");

const base = {
  requesterRelationship: "self",
  pickupDescription: "  Fictional pickup 12 Elm ",
  destinationDescription: "Fictional dialysis center",
  returnTripNeeded: "no",
  preferredDate: "",
  preferredTime: "",
  assistanceNotes: "",
  additionalNotes: "",
  source: "phone",
};

test("validateBookingForm: Core's required fields, trimmed; optional fields become null", () => {
  const r = b.validateBookingForm(base, { needsSource: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.pickupDescription, "Fictional pickup 12 Elm");
  assert.equal(r.value.preferredDate, null);
  assert.equal(r.value.assistanceNotes, null);
});

test("validateBookingForm: refuses what Core would refuse", () => {
  const bad = (over, opts = { needsSource: false }) => b.validateBookingForm({ ...base, ...over }, opts);
  assert.ok(bad({ pickupDescription: "   " }).errors.pickupDescription);
  assert.ok(bad({ destinationDescription: "" }).errors.destinationDescription);
  assert.ok(bad({ pickupDescription: "x".repeat(2001) }).errors.pickupDescription);
  assert.ok(bad({ requesterRelationship: "neighbour" }).errors.requesterRelationship);
  assert.ok(bad({ returnTripNeeded: "maybe" }).errors.returnTripNeeded);
  assert.ok(bad({ preferredDate: "2026-13-01" }).errors.preferredDate);
  assert.ok(bad({ preferredTime: "25:00" }).errors.preferredTime);
  assert.ok(bad({ assistanceNotes: "x".repeat(4001) }).errors.assistanceNotes);
  assert.ok(bad({ source: "fax" }, { needsSource: true }).errors.source, "rebooking needs a Core source");
  assert.equal(bad({ source: "fax" }, { needsSource: false }).ok, true, "conversion maps the opportunity's own source");
});

test("option sets mirror Core's own CHECKs (log-request-options)", () => {
  const src = readFileSync(new URL("../operations/log-request-options.ts", import.meta.url), "utf8");
  for (const v of [...b.RELATIONSHIP_VALUES, ...b.RETURN_TRIP_VALUES, ...b.CORE_SOURCE_VALUES]) {
    assert.match(src, new RegExp(`value: "${v}"`), v);
  }
});

test("source mapping mirrors the database (_plus_core_request_source)", () => {
  const expect = { phone: "phone", email: "email", facility: "facility", website: "web", web_inquiry: "web", referral: "other", walk_in: "other", event: "other", advertising: "other", other: "other" };
  for (const [from, to] of Object.entries(expect)) assert.equal(b.coreSourceForOpportunity(from), to, from);
  const sql = readFileSync(new URL("../../../supabase/migrations/20261015140000_plus_conversion_rebooking.sql", import.meta.url), "utf8");
  for (const [from, to] of Object.entries(expect)) {
    if (to === "other") continue;
    assert.match(sql, new RegExp(`when '${from}' then '${to}'`), `SQL maps ${from}`);
  }
});

test("idempotency key: same shape as the database (8-200 of [A-Za-z0-9._:-]); a UUID-based key fits", () => {
  assert.equal(b.isIdempotencyKey(`convert-${"4cb65c2d-9e82-461b-a444-d4d991ab930f"}`), true);
  assert.equal(b.isIdempotencyKey("short"), false);
  assert.equal(b.isIdempotencyKey("has spaces in it"), false);
  assert.equal(b.isIdempotencyKey("k".repeat(201)), false);
  assert.equal(b.isIdempotencyKey(undefined), false);
});

test("copy never claims a confirmed ride, driver, payment or completed booking", () => {
  for (const s of [b.BOOKING_SUCCESS_MESSAGE, b.BOOKING_PENDING_NOTE]) {
    assert.doesNotMatch(s, /\b(ride confirmed|driver assigned|payment received|booking complete|booked)\b/i);
  }
  assert.equal(b.BOOKING_SUCCESS_MESSAGE, "Transportation request created. Awaiting Operations review.");
  assert.match(b.BOOKING_PENDING_NOTE, /No ride is confirmed/);
});

test("errors: specific copy per database reason; never SQL text; retry after a timeout is described as safe", () => {
  assert.match(b.bookingErrorMessage("ZW004", "already_converted"), /already been converted/);
  assert.match(b.bookingErrorMessage("ZW004", "linked_request_exists"), /already linked to a transportation request/);
  assert.match(b.bookingErrorMessage("ZW004", "illegal_transition"), /closed/);
  assert.match(b.bookingErrorMessage("ZW006", "contact_phone_required"), /phone number/);
  assert.match(b.bookingErrorMessage("ZW006", "contact_not_active"), /archived/);
  assert.match(b.bookingErrorMessage("ZW003"), /changed since you opened it/);
  assert.match(b.bookingErrorMessage(undefined), /safe to try again/);
  for (const c of ["ZW001", "ZW002", "ZW003", "ZW004", "ZW006", undefined]) assert.doesNotMatch(b.bookingErrorMessage(c, "x"), /ZW\d|sqlstate|exception/i);
  assert.doesNotMatch(readFileSync(new URL("./booking-core.ts", import.meta.url), "utf8"), /^import /m, "runtime-import-free");
});

test("OD-6 do-not-contact notice: flagged -> warning; unflagged -> none; unavailable -> neutral reminder only", () => {
  const flagged = b.doNotContactNotice(true);
  assert.equal(flagged.kind, "do_not_contact");
  assert.equal(flagged.title, "This person asked not to be contacted");
  assert.match(flagged.description, /does not send them a message/);
  assert.equal(b.doNotContactNotice(false), null);
  for (const unknown of [null, undefined]) {
    const r = b.doNotContactNotice(unknown);
    assert.equal(r.kind, "reminder");
    assert.equal(r.description, "Before contacting this person, check their communication preferences. Creating a transportation request does not send a message.");
    // the neutral reminder never asserts a person-specific preference or consent
    assert.doesNotMatch(r.description, /asked not to|opted out|consent|agreed/i);
  }
  // only an explicit boolean true is a preference; truthy look-alikes are not inferred as one
  for (const v of ["true", 1, "yes"]) assert.notEqual(b.doNotContactNotice(v)?.kind, "do_not_contact");
  // never claims anything is sent or blocked
  for (const n of [flagged, b.doNotContactNotice(null)]) assert.doesNotMatch(n.description, /cannot|blocked|refused|we will (send|text|call)/i);
});

test("OD-6: the dialog reads ONLY the contact's stored flag; both pages pass it from the tenant-scoped contact loader", () => {
  const dialog = readFileSync(new URL("../../components/growth/BookingRequestDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /doNotContactNotice\(customer\.doNotContact\)/);
  const contactPage = readFileSync(new URL("../../app/operations/growth/contacts/[contactId]/page.tsx", import.meta.url), "utf8");
  assert.match(contactPage, /doNotContact: contact\.doNotContact/);
  const oppPage = readFileSync(new URL("../../app/operations/growth/pipeline/[opportunityId]/page.tsx", import.meta.url), "utf8");
  assert.match(oppPage, /doNotContact: c\.doNotContact/);
  // the flag never changes eligibility: conversion gating does not mention it
  assert.doesNotMatch(oppPage.match(/const canConvert = .*/)[0], /doNotContact/i);
});

test("NP-P2-S4.1-S2: rebooking passes a validated staff service choice; conversion never takes one from the form", () => {
  assert.equal(b.BOOKING_SERVICE_ERROR, "Choose a service from the list, or leave Service requested as Not specified.");
  const actions = readFileSync(new URL("../../app/operations/growth/booking/actions.ts", import.meta.url), "utf8");
  const rebook = actions.slice(actions.indexOf("export async function rebookContactAction"));
  const convert = actions.slice(actions.indexOf("export async function convertOpportunityAction"), actions.indexOf("export async function rebookContactAction"));
  assert.match(rebook, /parseServiceTypeInput\(formData\.get\("serviceType"\), SERVICE_TYPE_VALUES\)/);
  assert.match(rebook, /errors: \{ serviceType: BOOKING_SERVICE_ERROR \}/);
  assert.match(rebook, /p_service_type: service\.value \?\? undefined/);
  assert.doesNotMatch(convert, /serviceType|p_service_type/, "conversion uses the opportunity's own service in the database; the form cannot override it");
});

test("NP-P2-S4.1-S2: dialog + pages -- rebooking select (configured / all nine / unavailable), conversion review is read-only", () => {
  const dialog = readFileSync(new URL("../../components/growth/BookingRequestDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /label="Service requested \(optional\)"/);
  assert.match(dialog, /mode === "rebook" && \(\s*<Select\s+label="Service requested \(optional\)"/);
  assert.match(dialog, /helpText=\{serviceOptionsUnavailable \? SERVICE_OPTIONS_UNAVAILABLE_NOTE : undefined\}/);
  assert.match(dialog, /mode === "convert"\s*\?\s*\(opportunityServiceLabel \?\? SERVICE_NOT_SPECIFIED_LABEL\)/);
  assert.match(dialog, /doNotContactNotice\(customer\.doNotContact\)/, "OD-6 notice kept");
  assert.match(dialog, /nemryn\.plus\.booking\./, "retry key kept");
  const contactPage = readFileSync(new URL("../../app/operations/growth/contacts/[contactId]/page.tsx", import.meta.url), "utf8");
  assert.match(contactPage, /catch \{\s*configuredServices = null;\s*\}/);
  assert.match(contactPage, /serviceRequestedOptions\(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, configuredServices\)/);
  assert.match(contactPage, /serviceOptionsUnavailable=\{configuredServices === null\}/);
  const oppPage = readFileSync(new URL("../../app/operations/growth/pipeline/[opportunityId]/page.tsx", import.meta.url), "utf8");
  assert.match(oppPage, /opportunityServiceLabel=\{o\.serviceType \? \(SERVICE_TYPE_LABELS\[o\.serviceType as ServiceType\] \?\? null\) : null\}/);
});
