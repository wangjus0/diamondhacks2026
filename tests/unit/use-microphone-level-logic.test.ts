import assert from "node:assert/strict";
import test from "node:test";
import {
  getSilentCaptureErrorMessage,
  MICROPHONE_FRAME_WATCHDOG_MS,
  shouldTreatCaptureAsSilent,
} from "../../apps/client/src/features/voice/microphoneCaptureHealth.ts";

test("shouldTreatCaptureAsSilent is false before watchdog timeout", () => {
  const result = shouldTreatCaptureAsSilent({
    elapsedMs: MICROPHONE_FRAME_WATCHDOG_MS - 1,
    hasReceivedAudioFrame: false,
  });

  assert.equal(result, false);
});

test("shouldTreatCaptureAsSilent is true when no frames arrive by watchdog timeout", () => {
  const result = shouldTreatCaptureAsSilent({
    elapsedMs: MICROPHONE_FRAME_WATCHDOG_MS,
    hasReceivedAudioFrame: false,
  });

  assert.equal(result, true);
});

test("shouldTreatCaptureAsSilent is false when audio frames are received", () => {
  const result = shouldTreatCaptureAsSilent({
    elapsedMs: MICROPHONE_FRAME_WATCHDOG_MS + 500,
    hasReceivedAudioFrame: true,
  });

  assert.equal(result, false);
});

test("silent capture error message guides users to input settings", () => {
  const message = getSilentCaptureErrorMessage();

  assert.match(message, /input device/i);
  assert.match(message, /mic settings/i);
});
