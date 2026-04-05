import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_BLUR_GRACE_PERIOD_MS,
  shouldHideVoicePopoverOnBlur,
} from "../../electron/voicePopoverBehavior.ts";

test("blur hides popover immediately when opened from focused app", () => {
  const result = shouldHideVoicePopoverOnBlur({
    openedFromBackground: false,
    millisecondsSinceShow: 1,
  });

  assert.equal(result, true);
});

test("blur does not hide popover during initial background grace period", () => {
  const result = shouldHideVoicePopoverOnBlur({
    openedFromBackground: true,
    millisecondsSinceShow: BACKGROUND_BLUR_GRACE_PERIOD_MS - 1,
  });

  assert.equal(result, false);
});

test("blur hides popover after background grace period elapses", () => {
  const result = shouldHideVoicePopoverOnBlur({
    openedFromBackground: true,
    millisecondsSinceShow: BACKGROUND_BLUR_GRACE_PERIOD_MS,
  });

  assert.equal(result, true);
});
