import test from "node:test";
import assert from "node:assert/strict";

import {
  getStoredBrowserUseApiKey,
  hydrateBrowserUseApiKeyFromDesktop,
  persistBrowserUseApiKey,
} from "../../apps/client/src/lib/browser-profile.ts";

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key) ?? null : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

test("Browser Use API key hydrates from desktop storage and is readable for session start", async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  const localStorage = new MemoryStorage();

  (globalThis as { localStorage: MemoryStorage }).localStorage = localStorage;
  (globalThis as { window: unknown }).window = {
    desktop: {
      auth: {
        getSessionItem: async () => "bu_ABCDEF123456",
        setSessionItem: async () => undefined,
        removeSessionItem: async () => undefined,
      },
    },
  };

  try {
    const hydrated = await hydrateBrowserUseApiKeyFromDesktop();
    assert.equal(hydrated, "bu_ABCDEF123456");
    assert.equal(getStoredBrowserUseApiKey(), "bu_ABCDEF123456");

    await persistBrowserUseApiKey(null);
    assert.equal(getStoredBrowserUseApiKey(), null);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = originalWindow;
    }

    if (originalStorage === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      (globalThis as { localStorage: unknown }).localStorage = originalStorage;
    }
  }
});
