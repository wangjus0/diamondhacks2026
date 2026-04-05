import assert from "node:assert/strict";
import test from "node:test";

import { buildDomainScopedSecretsForIntegrations } from "../../apps/server/src/tools/browser/adapter.ts";

test("buildDomainScopedSecretsForIntegrations maps known integrations to domains", () => {
  const secrets = buildDomainScopedSecretsForIntegrations({
    Slack: {
      apiKeyValues: {
        api_key: "xoxb-test-slack-token",
      },
    },
    Gmail: {
      apiKeyValues: {
        api_key: "google-token-123",
      },
    },
  });

  assert.equal(secrets["slack.com"]?.api_key, "xoxb-test-slack-token");
  assert.equal(secrets["slack.com"]?.API_KEY, "xoxb-test-slack-token");
  assert.equal(secrets["mail.google.com"]?.api_key, "google-token-123");
  assert.equal(secrets["google.com"]?.api_key, "google-token-123");
});

test("buildDomainScopedSecretsForIntegrations ignores unknown integrations", () => {
  const secrets = buildDomainScopedSecretsForIntegrations({
    "Unknown Tool": {
      apiKeyValues: {
        api_key: "should-not-map",
      },
    },
  });

  assert.deepEqual(secrets, {});
});
