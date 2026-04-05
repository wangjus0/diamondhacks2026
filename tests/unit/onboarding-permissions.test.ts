import assert from "node:assert/strict";
import test from "node:test";
import {
  isMicrophoneAccessSatisfied,
  normalizeMicrophoneAccessStatus,
} from "../../apps/client/src/features/auth/microphonePermission.ts";

test("normalizeMicrophoneAccessStatus maps known status values", () => {
  assert.equal(normalizeMicrophoneAccessStatus("granted"), "granted");
  assert.equal(normalizeMicrophoneAccessStatus("denied"), "denied");
  assert.equal(normalizeMicrophoneAccessStatus("restricted"), "restricted");
  assert.equal(normalizeMicrophoneAccessStatus("not-determined"), "not-determined");
  assert.equal(normalizeMicrophoneAccessStatus("prompt"), "not-determined");
  assert.equal(normalizeMicrophoneAccessStatus("unsupported"), "unsupported");
  assert.equal(normalizeMicrophoneAccessStatus("random-value"), "unknown");
});

test("isMicrophoneAccessSatisfied allows granted and unsupported", () => {
  assert.equal(isMicrophoneAccessSatisfied("granted"), true);
  assert.equal(isMicrophoneAccessSatisfied("unsupported"), true);
  assert.equal(isMicrophoneAccessSatisfied("denied"), false);
  assert.equal(isMicrophoneAccessSatisfied("not-determined"), false);
});
