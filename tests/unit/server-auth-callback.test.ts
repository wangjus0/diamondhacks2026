import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopOAuthCallbackUrl } from "../../apps/server/src/http/auth-callback.ts";

test("buildDesktopOAuthCallbackUrl returns null for non-OAuth requests", () => {
  const result = buildDesktopOAuthCallbackUrl(new URL("http://localhost:3000/"));
  assert.equal(result, null);
});

test("buildDesktopOAuthCallbackUrl forwards OAuth code callback", () => {
  const result = buildDesktopOAuthCallbackUrl(new URL("http://localhost:3000/?code=abc123&state=xyz"));
  assert.equal(result, "murmur://auth/callback?code=abc123&state=xyz");
});

test("buildDesktopOAuthCallbackUrl forwards OAuth error callback", () => {
  const result = buildDesktopOAuthCallbackUrl(
    new URL("http://localhost:3000/auth/callback?error=redirect_uri_mismatch&error_description=bad_redirect"),
  );
  assert.equal(result, "murmur://auth/callback?error=redirect_uri_mismatch&error_description=bad_redirect");
});
