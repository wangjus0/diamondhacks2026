import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { app, BrowserWindow, globalShortcut, ipcMain, session, shell, safeStorage, systemPreferences } from "electron";
import { readSupabasePublicConfig, type SupabasePublicConfig } from "./supabaseConfig";
import { createMainWindow, getMainWindow } from "./windows/mainWindow";
import { createVoicePopoverWindow } from "./windows/voicePopoverWindow";
import { BACKGROUND_BLUR_GRACE_PERIOD_MS, shouldHideVoicePopoverOnBlur } from "./voicePopoverBehavior";
import { isMicrophonePermission, isTrustedMicrophoneRequest } from "./permissions/mediaPermissions";
import { PendingOAuthCallbackStore } from "./oauthCallback";

let appReady = false;
const pendingOAuthCallbackStore = new PendingOAuthCallbackStore();
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
const PROFILE_SYNC_COMMAND = "curl -fsSL https://browser-use.com/profile.sh | sh";
const PROFILE_SYNC_TIMEOUT_MS = 10 * 60 * 1000;

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

function dispatchOAuthCallback(rawUrl: string): void {
  const callbackUrl = pendingOAuthCallbackStore.setFromRaw(rawUrl);
  if (!callbackUrl) {
    return;
  }

  emitPendingOAuthCallback();
}

function getOAuthCallbackFromArgv(argv: string[]): string | null {
  const callbackArg = argv.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`));
  return callbackArg ?? null;
}

function registerAsDefaultProtocolClient(): void {
  const processArguments = process.argv[1] ? [path.resolve(process.argv[1])] : [];
  const registered = process.defaultApp
    ? app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, processArguments)
    : app.setAsDefaultProtocolClient(APP_PROTOCOL);

  if (!registered) {
    console.error(`[electron] Failed to register protocol handler for ${APP_PROTOCOL}://`);
  }
}

function emitPendingOAuthCallback(): void {
  const pendingCallbackUrl = pendingOAuthCallbackStore.peek();
  if (!pendingCallbackUrl || !app.isReady()) {
    return;
  }

  const win = getMainWindow() ?? createMainWindow();
  win.webContents.send(OAUTH_CALLBACK_EVENT, pendingCallbackUrl);
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

  ipcMain.handle("system:open-external-url", async (_event, rawUrl: string) => {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only http(s) URLs are allowed.");
    }

    await shell.openExternal(parsed.toString());
  });

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
    return pendingOAuthCallbackStore.consume();
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

  ipcMain.handle("browser-use:start-profile-sync", async (_event, rawApiKey: string) => {
    const apiKey = normalizeBrowserUseApiKey(rawApiKey);
    if (!apiKey) {
      throw new Error("Invalid Browser Use API key format.");
    }

    if (process.platform !== "darwin" && process.platform !== "linux") {
      throw new Error("Automatic profile sync is currently supported on macOS and Linux.");
    }

    const runResult = await runProfileSyncCommand(apiKey);
    const combinedOutput = [runResult.stdout, runResult.stderr].filter(Boolean).join("\n");
    const profileId = extractProfileIdFromOutput(combinedOutput);

    return {
      success: runResult.exitCode === 0,
      profileId,
      message:
        runResult.exitCode === 0
          ? profileId
            ? "Profile sync completed."
            : "Profile sync completed. Copy the generated profile ID and paste it into onboarding."
          : "Profile sync failed. Review the output and retry.",
      output: combinedOutput.trim() || null,
    };
  });
}

type ProfileSyncRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runProfileSyncCommand(apiKey: string): Promise<ProfileSyncRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(PROFILE_SYNC_COMMAND, {
      shell: true,
      env: {
        ...process.env,
        BROWSER_USE_API_KEY: apiKey,
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Profile sync timed out. Please try again."));
    }, PROFILE_SYNC_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function normalizeBrowserUseApiKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^bu_[A-Za-z0-9_-]{8,}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function extractProfileIdFromOutput(output: string): string | null {
  const uuidMatches =
    output.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi
    ) ?? [];
  if (uuidMatches.length > 0) {
    return uuidMatches[uuidMatches.length - 1] ?? null;
  }

  const prefixedMatches = output.match(/profile_[A-Za-z0-9_-]{6,}/gi) ?? [];
  if (prefixedMatches.length > 0) {
    return prefixedMatches[prefixedMatches.length - 1] ?? null;
  }

  return null;
}

function registerProtocolHandlers(): void {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    dispatchOAuthCallback(url);
  });

  app.on("second-instance", (_event, argv) => {
    const callbackArg = getOAuthCallbackFromArgv(argv);
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

    if (voicePopoverOpenedFromBackground) {
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
  const initialOAuthCallback = getOAuthCallbackFromArgv(process.argv);
  if (initialOAuthCallback) {
    dispatchOAuthCallback(initialOAuthCallback);
  }
  await app.whenReady();
  registerAsDefaultProtocolClient();

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
