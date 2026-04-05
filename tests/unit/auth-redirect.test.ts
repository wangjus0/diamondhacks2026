import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AUTH_REDIRECT_URL,
  enforceOAuthRedirectTarget,
  resolveAuthRedirectUrl,
} from "../../apps/client/src/features/auth/redirect.ts";

test("resolveAuthRedirectUrl returns default deep link when override is missing", () => {
  const redirectUrl = resolveAuthRedirectUrl({});
  assert.equal(redirectUrl, DEFAULT_AUTH_REDIRECT_URL);
});

test("resolveAuthRedirectUrl returns env override when it matches desktop callback", () => {
  const redirectUrl = resolveAuthRedirectUrl({
    VITE_AUTH_REDIRECT_URL: "murmur://auth/callback?source=invite",
  });

  assert.equal(redirectUrl, "murmur://auth/callback?source=invite");
});

test("resolveAuthRedirectUrl trims override before validating", () => {
  const redirectUrl = resolveAuthRedirectUrl({
    VITE_AUTH_REDIRECT_URL: "  murmur://auth/callback  ",
  });

  assert.equal(redirectUrl, "murmur://auth/callback");
});

test("resolveAuthRedirectUrl falls back to default when override is not a valid absolute URL", () => {
  const redirectUrl = resolveAuthRedirectUrl({ VITE_AUTH_REDIRECT_URL: "not-a-url" });
  assert.equal(redirectUrl, DEFAULT_AUTH_REDIRECT_URL);
});

test("resolveAuthRedirectUrl falls back to default when override is not desktop callback", () => {
  const redirectUrl = resolveAuthRedirectUrl({
    VITE_AUTH_REDIRECT_URL: "https://app.murmur.ai/auth/callback",
  });

  assert.equal(redirectUrl, DEFAULT_AUTH_REDIRECT_URL);
});

test("enforceOAuthRedirectTarget sets redirect_to on Supabase authorize URLs", () => {
  const authUrl =
    "https://widbrlxfiolngkncgbkm.supabase.co/auth/v1/authorize?provider=google";
  const result = enforceOAuthRedirectTarget(authUrl, DEFAULT_AUTH_REDIRECT_URL);
  const parsed = new URL(result);

  assert.equal(parsed.searchParams.get("redirect_to"), DEFAULT_AUTH_REDIRECT_URL);
});

test("enforceOAuthRedirectTarget overwrites existing redirect_to parameter", () => {
  const authUrl =
    "https://widbrlxfiolngkncgbkm.supabase.co/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A5173%2Fauth%2Fcallback";
  const result = enforceOAuthRedirectTarget(authUrl, DEFAULT_AUTH_REDIRECT_URL);
  const parsed = new URL(result);

  assert.equal(parsed.searchParams.get("redirect_to"), DEFAULT_AUTH_REDIRECT_URL);
});

test("enforceOAuthRedirectTarget leaves non-Supabase authorize URLs unchanged", () => {
  const authUrl = "https://example.com/login?provider=google";
  const result = enforceOAuthRedirectTarget(authUrl, DEFAULT_AUTH_REDIRECT_URL);

  assert.equal(result, authUrl);
});
