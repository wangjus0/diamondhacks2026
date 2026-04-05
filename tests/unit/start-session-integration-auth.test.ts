import assert from "node:assert/strict";
import test from "node:test";

import { parseClientEvent } from "@murmur/shared";

test("parseClientEvent accepts start_session integrationAuth payload", () => {
  const parsed = parseClientEvent({
    type: "start_session",
    profileId: "123e4567-e89b-12d3-a456-426614174000",
    browserUseApiKey: "bu_test_key_123456789",
    integrationAuth: {
      Slack: {
        oauthConnected: true,
        apiKeyValues: {
          api_key: "xoxb-test-token",
        },
      },
    },
  });

  assert.equal(parsed.type, "start_session");
  if (parsed.type !== "start_session") {
    return;
  }

  assert.equal(parsed.integrationAuth?.Slack?.oauthConnected, true);
  assert.equal(parsed.integrationAuth?.Slack?.apiKeyValues?.api_key, "xoxb-test-token");
});
