// Driver directions URL (NP-DRIVER-UX-02, ZD-126 D0). Run with:
//
//   node --test src/lib/driver/maps.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { directionsUrl, usableAddress, GOOGLE_MAPS_DIRECTIONS_BASE } = await import("./maps.ts");

const params = (url) => new URL(url).searchParams;

test("builds the official Google Maps driving-directions URL (api=1, destination, travelmode=driving)", () => {
  const url = directionsUrl("12 Fictional Lane, Springfield, GA 30000");
  assert.ok(url.startsWith(GOOGLE_MAPS_DIRECTIONS_BASE + "?"));
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://www.google.com/maps/dir/");
  assert.equal(params(url).get("api"), "1");
  assert.equal(params(url).get("destination"), "12 Fictional Lane, Springfield, GA 30000");
  assert.equal(params(url).get("travelmode"), "driving");
  assert.equal(params(url).has("query"), false, "never the old map-search parameter");
  assert.equal(params(url).has("origin"), false, "no origin: the device uses its own location");
  assert.deepEqual([...params(url).keys()], ["api", "destination", "travelmode"]);
});

test("no longer uses the map SEARCH endpoint", () => {
  const url = directionsUrl("Fictional Dialysis Center");
  assert.ok(!url.includes("/maps/search/"));
  assert.ok(url.includes("/maps/dir/"));
});

test("encodes reserved and non-ASCII characters so the destination round-trips exactly", () => {
  for (const address of [
    "5 Oak & Elm, Apt #3, Fictional City",
    "100 Main St, Suite 200 / Entrance B",
    "Calle Ficticia 7, Peñaflor",
    "1 Plus+Road; Unit=4?",
    "Line one\nLine two",
  ]) {
    const url = directionsUrl(address);
    assert.equal(params(url).get("destination"), address.trim());
    assert.ok(!/[ #&?;\n]/.test(url.split("destination=")[1].split("&travelmode")[0]), `raw reserved char leaked: ${url}`);
  }
});

test("sends the stop exactly as recorded, trimmed: nothing prefixed or appended", () => {
  assert.equal(params(directionsUrl("   7 Fictional Way   ")).get("destination"), "7 Fictional Way");
  const recorded = "Fictional Clinic, 9 Test Rd, Fictional City, GA 30001";
  assert.equal(params(directionsUrl(recorded)).get("destination"), recorded);
});

test("missing or blank destination -> null (no Navigate link is ever built from nothing)", () => {
  for (const missing of [null, undefined, "", "   ", "\n\t"]) {
    assert.equal(directionsUrl(missing), null);
    assert.equal(usableAddress(missing), null);
  }
  assert.equal(usableAddress(42), null);
});

test("never builds a link from placeholder copy (the caller passes the recorded value, not display text)", () => {
  // The page used to substitute "Pickup location not available" before building the link; the builder itself has no
  // knowledge of placeholders, so the guarantee lives in the caller passing null. This documents the contract.
  assert.equal(directionsUrl(null), null);
});
