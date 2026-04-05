const DESKTOP_AUTH_CALLBACK_URL = "murmur://auth/callback";

const OAUTH_FORWARD_PARAM_KEYS = [
  "code",
  "error",
  "error_description",
  "state",
  "type",
  "token_hash",
  "access_token",
  "refresh_token",
] as const;

const OAUTH_SIGNAL_PARAM_KEYS = ["code", "error", "token_hash", "access_token", "refresh_token", "type"] as const;

function hasOAuthSignal(searchParams: URLSearchParams): boolean {
  return OAUTH_SIGNAL_PARAM_KEYS.some((key) => {
    const value = searchParams.get(key);
    return typeof value === "string" && value.length > 0;
  });
}

export function buildDesktopOAuthCallbackUrl(requestUrl: URL): string | null {
  if (!hasOAuthSignal(requestUrl.searchParams)) {
    return null;
  }

  const desktopCallbackUrl = new URL(DESKTOP_AUTH_CALLBACK_URL);

  OAUTH_FORWARD_PARAM_KEYS.forEach((key) => {
    const value = requestUrl.searchParams.get(key);
    if (value) {
      desktopCallbackUrl.searchParams.set(key, value);
    }
  });

  return desktopCallbackUrl.toString();
}
