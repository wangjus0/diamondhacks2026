import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOnboardingData,
  createPayload,
  deriveCurrentStep,
  mergePersistedOnboardingData,
  validateStep,
} from "../../apps/client/src/features/auth/onboardingSchema.ts";

test("mergePersistedOnboardingData falls back to defaults for invalid payload", () => {
  const result = mergePersistedOnboardingData({ foo: "bar" });

  assert.deepEqual(result, createDefaultOnboardingData());
});

test("mergePersistedOnboardingData restores known fields from persisted payload", () => {
  const result = mergePersistedOnboardingData({
    steps: {
      permissions: { assistantAccess: "granted", microphoneAccess: "granted", screenAccess: "pending" },
      account: { displayName: "Alex", workspaceName: "Murmur" },
      workflow: { primaryGoal: "Automate repetitive tasks", useCases: "Research and drafting" },
      preferences: { shortcutBehavior: "Open near cursor", notes: "none" },
    },
  });

  assert.equal(result.permissions.microphoneAccess, "granted");
  assert.equal(result.account.displayName, "Alex");
  assert.equal(result.workflow.primaryGoal, "Automate repetitive tasks");
  assert.equal(result.preferences.shortcutBehavior, "Open near cursor");
});

test("deriveCurrentStep clamps step index into valid range", () => {
  assert.equal(deriveCurrentStep({ currentStep: -1 }), 0);
  assert.equal(deriveCurrentStep({ currentStep: 100 }), 3);
  assert.equal(deriveCurrentStep({ currentStep: 1.8 }), 1);
  assert.equal(deriveCurrentStep({ schemaVersion: 1, currentStep: 2 }), 3);
});

test("validateStep requires microphone access in permissions step", () => {
  const defaults = createDefaultOnboardingData();
  const errors = validateStep("permissions", defaults);

  assert.equal(errors.microphoneAccess, "Please enable microphone access to continue.");
});

test("validateStep requires placeholder fields for account step", () => {
  const defaults = createDefaultOnboardingData();
  const errors = validateStep("account", defaults);

  assert.equal(errors.displayName, "This field is required.");
  assert.equal(errors.workspaceName, "This field is required.");
});

test("createPayload stores schemaVersion and provided step", () => {
  const defaults = createDefaultOnboardingData();
  const payload = createPayload(1, defaults);

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.currentStep, 1);
  assert.deepEqual(payload.steps, defaults);
});
