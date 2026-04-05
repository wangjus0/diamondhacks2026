import { contextBridge, ipcRenderer } from "electron";
import { readSupabasePublicConfig } from "./supabaseConfig";

type OAuthCallbackListener = (callbackUrl: string) => void;

const desktopApi = Object.freeze({
  ping: () => "pong",
  getRuntimeInfo: () => ({
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
  getRealtimeWebSocketUrl: () => {
    const explicitUrl = process.env.MURMUR_WS_URL?.trim();
    if (explicitUrl) {
      return explicitUrl;
    }

    const serverPort = process.env.PORT?.trim() || "3000";
    return `ws://127.0.0.1:${serverPort}/ws`;
  },
  getSupabaseConfig: () => Object.freeze(readSupabasePublicConfig()),
  openExternalUrl: (url: string) => ipcRenderer.invoke("system:open-external-url", url),
  shortcut: {
    closePopover: () => ipcRenderer.invoke("shortcut:close-popover"),
    repositionPopover: (position: "center" | "top-right") =>
      ipcRenderer.invoke("shortcut:reposition-popover", position),
    resizePopover: (width: number, height: number) =>
      ipcRenderer.invoke("shortcut:resize-popover", width, height),
  },
  auth: {
    startGoogleOAuth: (authUrl: string) => ipcRenderer.invoke("auth:start-google-oauth", authUrl),
    getSessionItem: (key: string) => ipcRenderer.invoke("auth:get-session-item", key),
    setSessionItem: (key: string, value: string) =>
      ipcRenderer.invoke("auth:set-session-item", key, value),
    removeSessionItem: (key: string) => ipcRenderer.invoke("auth:remove-session-item", key),
    consumePendingOAuthCallback: () => ipcRenderer.invoke("auth:consume-pending-oauth-callback"),
    onOAuthCallback: (listener: OAuthCallbackListener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, callbackUrl: string) => {
        listener(callbackUrl);
      };

      ipcRenderer.on("auth:oauth-callback", wrappedListener);

      return () => {
        ipcRenderer.removeListener("auth:oauth-callback", wrappedListener);
      };
    },
  },
  permissions: {
    requestMicrophoneAccess: () => ipcRenderer.invoke("permissions:request-microphone-access"),
    getMicrophoneAccessStatus: () => ipcRenderer.invoke("permissions:get-microphone-access-status"),
    openMicrophoneSettings: () => ipcRenderer.invoke("permissions:open-microphone-settings"),
  },
  browserUse: {
    startProfileSync: (apiKey: string) =>
      ipcRenderer.invoke("browser-use:start-profile-sync", apiKey),
  },
});

contextBridge.exposeInMainWorld("desktop", desktopApi);
