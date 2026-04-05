import path from "node:path";
import fs from "node:fs";
import { app, BrowserWindow, globalShortcut, ipcMain, session, shell, safeStorage, systemPreferences } from "electron";
import { readSupabasePublicConfig, type SupabasePublicConfig } from "./supabaseConfig";
import { createMainWindow, getMainWindow } from "./windows/mainWindow";
import { createVoicePopoverWindow } from "./windows/voicePopoverWindow";
import { BACKGROUND_BLUR_GRACE_PERIOD_MS, shouldHideVoicePopoverOnBlur } from "./voicePopoverBehavior";
import { isMicrophonePermission, isTrustedMicrophoneRequest } from "./permissions/mediaPermissions";

let appReady = false;
let pendingOAuthCallbackUrl: string | null = null;
let volatileSessionStore: SessionStoreData = {};
let voicePopoverWindow: BrowserWindow | null = null;
let voicePopoverOpenedAtMs: number | null = null;
let voicePopoverOpenedFromBackground = false;
let pendingVoicePopoverBlurHideTimer: NodeJS.Timeout | null = null;

const GLOBAL_SHORTCUT = "CommandOrControl+Shift+Space";
const DASHBOARD_SHORTCUT = "CommandOrControl+Shift+M";

const APP_PROTOCOL = "murmur";
const OAUTH_CALLBACK_EVENT = "auth:oauth-callback";
const AUTH_STORE_FILENAME = "auth-session-store.bin";

function registerMediaPermissionHandlers(): void {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (!isMicrophonePermission(permission)) {
      return false;
    }

    return isTrustedMicrophoneRequest({
      requestingUrl: details?.requestingUrl,
      requestingOrigin,
      webContentsUrl: wc?.getURL(),
    });
  });

  defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!isMicrophonePermission(permission)) {
      callback(false);
      return;
    }

    callback(
      isTrustedMicrophoneRequest({
        requestingUrl: details?.requestingUrl,
        webContentsUrl: wc?.getURL(),
      })
    );
  });
}

type SessionStoreData = Readonly<Record<string, string>>;

function getSessionStorePath(): string {
  return path.join(app.getPath("userData"), AUTH_STORE_FILENAME);
}

function encodeSessionStore(store: SessionStoreData): Buffer {
  const payload = JSON.stringify(store);
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(payload);
  }

  return Buffer.from(payload, "utf8");
}

function decodeSessionStore(buffer: Buffer): SessionStoreData {
  try {
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buffer)
      : buffer.toString("utf8");
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce<SessionStoreData>((acc, [key, value]) => {
      if (typeof value !== "string") {
        return acc;
      }

      return {
        ...acc,
        [key]: value,
      };
    }, {});
  } catch {
    return {};
  }
}

function readSessionStore(): SessionStoreData {
  if (!safeStorage.isEncryptionAvailable()) {
    return volatileSessionStore;
  }

  const filePath = getSessionStorePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const payload = fs.readFileSync(filePath);
    return decodeSessionStore(payload);
  } catch {
    return {};
  }
}

function writeSessionStore(store: SessionStoreData): void {
  if (!safeStorage.isEncryptionAvailable()) {
    volatileSessionStore = store;
    return;
  }

  const filePath = getSessionStorePath();
  const payload = encodeSessionStore(store);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, payload);
}

function normalizeOAuthCallbackUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const isCallback =
      parsed.protocol === `${APP_PROTOCOL}:` &&
      parsed.hostname === "auth" &&
      parsed.pathname === "/callback";
    if (!isCallback) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function dispatchOAuthCallback(rawUrl: string): void {
  const callbackUrl = normalizeOAuthCallbackUrl(rawUrl);
  if (!callbackUrl) {
    return;
  }

  pendingOAuthCallbackUrl = callbackUrl;
  emitPendingOAuthCallback();
}

function emitPendingOAuthCallback(): void {
  if (!pendingOAuthCallbackUrl || !app.isReady()) {
    return;
  }

  const win = getMainWindow() ?? createMainWindow();
  win.webContents.send(OAUTH_CALLBACK_EVENT, pendingOAuthCallbackUrl);
  win.show();
  win.focus();
}

function registerAuthIpcHandlers(config: SupabasePublicConfig): void {
  const supabaseOrigin = new URL(config.url).origin;

  const assertValidStoreKey = (key: string): void => {
    if (!key || key.length > 200) {
      throw new Error("Invalid auth storage key.");
    }

    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new Error("Reserved auth storage key.");
    }
  };

  ipcMain.handle("auth:start-google-oauth", async (_event, authUrl: string) => {
    const parsed = new URL(authUrl);
    const isAllowedUrl =
      parsed.protocol === "https:" &&
      parsed.origin === supabaseOrigin &&
      parsed.pathname === "/auth/v1/authorize" &&
      parsed.searchParams.get("provider") === "google";
    if (!isAllowedUrl) {
      throw new Error("OAuth URL is not allowlisted.");
    }

    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle("auth:get-session-item", (_event, key: string) => {
    assertValidStoreKey(key);
    const store = readSessionStore();
    return store[key] ?? null;
  });

  ipcMain.handle("auth:set-session-item", (_event, key: string, value: string) => {
    assertValidStoreKey(key);
    const store = readSessionStore();
    const nextStore: SessionStoreData = {
      ...store,
      [key]: value,
    };
    writeSessionStore(nextStore);
  });

  ipcMain.handle("auth:remove-session-item", (_event, key: string) => {
    assertValidStoreKey(key);
    const store = readSessionStore();
    const nextStore = Object.entries(store).reduce<SessionStoreData>((acc, [storeKey, value]) => {
      if (storeKey === key) {
        return acc;
      }

      return {
        ...acc,
        [storeKey]: value,
      };
    }, {});
    writeSessionStore(nextStore);
  });

  ipcMain.handle("auth:consume-pending-oauth-callback", () => {
    const callbackUrl = pendingOAuthCallbackUrl;
    pendingOAuthCallbackUrl = null;
    return callbackUrl;
  });

  ipcMain.handle("permissions:request-microphone-access", async () => {
    if (typeof systemPreferences.askForMediaAccess !== "function") {
      return true;
    }

    try {
      return await systemPreferences.askForMediaAccess("microphone");
    } catch {
      return false;
    }
  });

  ipcMain.handle("permissions:get-microphone-access-status", () => {
    if (typeof systemPreferences.getMediaAccessStatus !== "function") {
      return "unsupported";
    }

    try {
      return systemPreferences.getMediaAccessStatus("microphone");
    } catch {
      return "unknown";
    }
  });

  ipcMain.handle("permissions:open-microphone-settings", async () => {
    if (process.platform === "darwin") {
      await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
      return;
    }

    if (process.platform === "win32") {
      await shell.openExternal("ms-settings:privacy-microphone");
    }
  });
}

function registerProtocolHandlers(): void {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    dispatchOAuthCallback(url);
  });

  app.on("second-instance", (_event, argv) => {
    const callbackArg = argv.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`));
    if (callbackArg) {
      dispatchOAuthCallback(callbackArg);
      return;
    }

    const win = getMainWindow() ?? createMainWindow();
    win.show();
    win.focus();
  });
}

function getOrCreateVoicePopover(): BrowserWindow {
  if (voicePopoverWindow && !voicePopoverWindow.isDestroyed()) {
    return voicePopoverWindow;
  }

  voicePopoverWindow = createVoicePopoverWindow();
  voicePopoverWindow.on("blur", () => {
    if (!voicePopoverWindow || voicePopoverWindow.isDestroyed() || !voicePopoverWindow.isVisible()) {
      return;
    }

    const millisecondsSinceShow = voicePopoverOpenedAtMs === null ? Number.POSITIVE_INFINITY : Date.now() - voicePopoverOpenedAtMs;
    const shouldHide = shouldHideVoicePopoverOnBlur({
      openedFromBackground: voicePopoverOpenedFromBackground,
      millisecondsSinceShow,
    });

    if (shouldHide) {
      hideVoicePopover();
      return;
    }

    if (pendingVoicePopoverBlurHideTimer !== null) {
      clearTimeout(pendingVoicePopoverBlurHideTimer);
    }

    const remainingGraceMs = Math.max(0, BACKGROUND_BLUR_GRACE_PERIOD_MS - millisecondsSinceShow);
    pendingVoicePopoverBlurHideTimer = setTimeout(() => {
      pendingVoicePopoverBlurHideTimer = null;

      if (!voicePopoverWindow || voicePopoverWindow.isDestroyed() || !voicePopoverWindow.isVisible()) {
        return;
      }

      if (!voicePopoverWindow.isFocused()) {
        hideVoicePopover();
      }
    }, remainingGraceMs);
  });
  voicePopoverWindow.on("closed", () => {
    if (pendingVoicePopoverBlurHideTimer !== null) {
      clearTimeout(pendingVoicePopoverBlurHideTimer);
      pendingVoicePopoverBlurHideTimer = null;
    }

    voicePopoverOpenedAtMs = null;
    voicePopoverOpenedFromBackground = false;
    voicePopoverWindow = null;
  });

  return voicePopoverWindow;
}

function toggleVoicePopover(): void {
  const win = getOrCreateVoicePopover();

  if (win.isVisible()) {
    hideVoicePopover();
  } else {
    if (pendingVoicePopoverBlurHideTimer !== null) {
      clearTimeout(pendingVoicePopoverBlurHideTimer);
      pendingVoicePopoverBlurHideTimer = null;
    }

    voicePopoverOpenedAtMs = Date.now();
    voicePopoverOpenedFromBackground = BrowserWindow.getFocusedWindow() === null;
    win.show();
    win.focus();
  }
}

function toggleMainWindow(): void {
  const existingWindow = getMainWindow();
  if (existingWindow) {
    if (existingWindow.isVisible()) {
      existingWindow.hide();
      return;
    }

    existingWindow.show();
    existingWindow.focus();
    return;
  }

  const win = createMainWindow();
  win.show();
  win.focus();
}

function hideVoicePopover(): void {
  if (pendingVoicePopoverBlurHideTimer !== null) {
    clearTimeout(pendingVoicePopoverBlurHideTimer);
    pendingVoicePopoverBlurHideTimer = null;
  }

  voicePopoverOpenedAtMs = null;
  voicePopoverOpenedFromBackground = false;

  if (voicePopoverWindow && !voicePopoverWindow.isDestroyed() && voicePopoverWindow.isVisible()) {
    voicePopoverWindow.hide();
  }
}

function registerShortcutIpcHandlers(): void {
  ipcMain.handle("shortcut:close-popover", () => {
    hideVoicePopover();
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function bootstrap(): Promise<void> {
  if (appReady) {
    return;
  }

  appReady = true;

  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
    return;
  }

  const supabaseConfig = readSupabasePublicConfig();
  registerProtocolHandlers();
  await app.whenReady();
  app.setAsDefaultProtocolClient(APP_PROTOCOL);

  registerAuthIpcHandlers(supabaseConfig);
  registerShortcutIpcHandlers();
  registerMediaPermissionHandlers();
  createMainWindow();
  emitPendingOAuthCallback();

  const registeredVoiceShortcut = globalShortcut.register(GLOBAL_SHORTCUT, toggleVoicePopover);
  if (!registeredVoiceShortcut || !globalShortcut.isRegistered(GLOBAL_SHORTCUT)) {
    console.error("[electron] Failed to register global shortcut:", GLOBAL_SHORTCUT);
  }

  const registeredDashboardShortcut = globalShortcut.register(DASHBOARD_SHORTCUT, toggleMainWindow);
  if (!registeredDashboardShortcut || !globalShortcut.isRegistered(DASHBOARD_SHORTCUT)) {
    console.error("[electron] Failed to register global shortcut:", DASHBOARD_SHORTCUT);
  }

  app.on("activate", () => {
    if (appReady && app.isReady() && process.platform === "darwin") {
      createMainWindow();
    }
  });
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", async () => {
  await wait(1);
});

void bootstrap();
