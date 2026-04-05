const DEFAULT_AUTH_REDIRECT_URL = "murmur://auth/callback";

function isSupportedDesktopRedirectUrl(url: URL): boolean {
  return url.protocol === "murmur:" && url.hostname === "auth" && url.pathname === "/callback";
}

export function resolveAuthRedirectUrl(env: ImportMetaEnv = import.meta.env): string {
  const rawOverride = env.VITE_AUTH_REDIRECT_URL?.trim();
  if (!rawOverride) {
    return DEFAULT_AUTH_REDIRECT_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawOverride);
  } catch {
    return DEFAULT_AUTH_REDIRECT_URL;
  }

  if (!isSupportedDesktopRedirectUrl(parsed)) {
    return DEFAULT_AUTH_REDIRECT_URL;
  }

  return parsed.toString();
}

export function enforceOAuthRedirectTarget(authUrl: string, redirectUrl: string): string {
  try {
    const parsedAuthUrl = new URL(authUrl);
    if (parsedAuthUrl.protocol !== "https:" || parsedAuthUrl.pathname !== "/auth/v1/authorize") {
      return authUrl;
    }

    parsedAuthUrl.searchParams.set("redirect_to", redirectUrl);
    return parsedAuthUrl.toString();
  } catch {
    return authUrl;
  }
}

export function isRedirectConfigurationError(message: string): boolean {
  return /(email_redirect_to|allowlist|allow list|not allowed redirect|redirect url is not allowed|redirect is not allowed)/i.test(message);
}

export function buildRedirectConfigurationError(redirectUrl: string): string {
  return `Auth redirect is not allowlisted. Add ${redirectUrl} to Supabase Auth Redirect URLs.`;
}

export { DEFAULT_AUTH_REDIRECT_URL };
