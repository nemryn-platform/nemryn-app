// Driver lifecycle error copy. Run with:
//
//   node --test src/lib/driver/errors.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { mapDriverActionError, DRIVER_ACTION_ERROR_MESSAGE } = await import("./errors.ts");

test("ZW001 copy names both legitimate causes: reassignment and a completion Operations recorded (P1-PILOT-R2C)", () => {
  assert.equal(mapDriverActionError("ZW001"), "UNAUTHORIZED");
  assert.equal(
    DRIVER_ACTION_ERROR_MESSAGE[mapDriverActionError("ZW001")],
    "This action is no longer available for this trip. It may have been reassigned or completed.",
  );
});
