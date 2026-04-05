export const BROWSER_PROFILE_STORAGE_KEY = "murmur.browserUseProfileId";
export const DESKTOP_BROWSER_PROFILE_SESSION_KEY = "browser_use_profile_id";
export const BROWSER_USE_API_KEY_STORAGE_KEY = "murmur.browserUseApiKey";
export const DESKTOP_BROWSER_USE_API_KEY_SESSION_KEY = "browser_use_api_key";

const PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeBrowserProfileId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!PROFILE_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function normalizeBrowserUseApiKey(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!/^bu_[A-Za-z0-9_-]{8,}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function getStoredBrowserProfileId(): string | null {
  try {
    return normalizeBrowserProfileId(localStorage.getItem(BROWSER_PROFILE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function setStoredBrowserProfileId(profileId: string | null): void {
  try {
    if (!profileId) {
      localStorage.removeItem(BROWSER_PROFILE_STORAGE_KEY);
      return;
    }

    localStorage.setItem(BROWSER_PROFILE_STORAGE_KEY, profileId);
  } catch {
    // no-op
  }
}

export async function persistBrowserProfileId(profileId: string | null): Promise<void> {
  setStoredBrowserProfileId(profileId);

  const authApi = window.desktop?.auth;
  if (!authApi) {
    return;
  }

  try {
    if (profileId) {
      await authApi.setSessionItem(DESKTOP_BROWSER_PROFILE_SESSION_KEY, profileId);
      return;
    }

    await authApi.removeSessionItem(DESKTOP_BROWSER_PROFILE_SESSION_KEY);
  } catch {
    // no-op
  }
}

export async function hydrateBrowserProfileIdFromDesktop(): Promise<string | null> {
  const authApi = window.desktop?.auth;
  if (!authApi) {
    return getStoredBrowserProfileId();
  }

  try {
    const desktopValue = await authApi.getSessionItem(DESKTOP_BROWSER_PROFILE_SESSION_KEY);
    const normalized = normalizeBrowserProfileId(desktopValue);
    if (normalized) {
      setStoredBrowserProfileId(normalized);
      return normalized;
    }
  } catch {
    // no-op
  }

  return getStoredBrowserProfileId();
}

export function getStoredBrowserUseApiKey(): string | null {
  try {
    return normalizeBrowserUseApiKey(localStorage.getItem(BROWSER_USE_API_KEY_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function setStoredBrowserUseApiKey(apiKey: string | null): void {
  try {
    if (!apiKey) {
      localStorage.removeItem(BROWSER_USE_API_KEY_STORAGE_KEY);
      return;
    }

    localStorage.setItem(BROWSER_USE_API_KEY_STORAGE_KEY, apiKey);
  } catch {
    // no-op
  }
}

export async function persistBrowserUseApiKey(apiKey: string | null): Promise<void> {
  setStoredBrowserUseApiKey(apiKey);

  const authApi = window.desktop?.auth;
  if (!authApi) {
    return;
  }

  try {
    if (apiKey) {
      await authApi.setSessionItem(DESKTOP_BROWSER_USE_API_KEY_SESSION_KEY, apiKey);
      return;
    }

    await authApi.removeSessionItem(DESKTOP_BROWSER_USE_API_KEY_SESSION_KEY);
  } catch {
    // no-op
  }
}

export async function hydrateBrowserUseApiKeyFromDesktop(): Promise<string | null> {
  const authApi = window.desktop?.auth;
  if (!authApi) {
    return getStoredBrowserUseApiKey();
  }

  try {
    const desktopValue = await authApi.getSessionItem(DESKTOP_BROWSER_USE_API_KEY_SESSION_KEY);
    const normalized = normalizeBrowserUseApiKey(desktopValue);
    if (normalized) {
      setStoredBrowserUseApiKey(normalized);
      return normalized;
    }
  } catch {
    // no-op
  }

  return getStoredBrowserUseApiKey();
}
