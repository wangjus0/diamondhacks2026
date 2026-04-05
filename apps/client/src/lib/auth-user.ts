export const AUTH_USER_ID_STORAGE_KEY = "murmur.authUserId";

function normalizeAuthUserId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function getStoredAuthUserId(): string | null {
  try {
    return normalizeAuthUserId(localStorage.getItem(AUTH_USER_ID_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function setStoredAuthUserId(userId: string | null): void {
  try {
    const normalized = normalizeAuthUserId(userId);
    if (!normalized) {
      localStorage.removeItem(AUTH_USER_ID_STORAGE_KEY);
      return;
    }

    localStorage.setItem(AUTH_USER_ID_STORAGE_KEY, normalized);
  } catch {
    // no-op in restricted runtimes
  }
}
