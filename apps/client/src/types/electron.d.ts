type DesktopRuntimeInfo = {
  platform: string;
  electron: string;
  chrome: string;
  node: string;
};

type DesktopSupabaseConfig = {
  url: string;
  anonKey: string;
};

type DesktopShortcutApi = {
  closePopover: () => Promise<void>;
};

type DesktopAuthApi = {
  startGoogleOAuth: (authUrl: string) => Promise<void>;
  getSessionItem: (key: string) => Promise<string | null>;
  setSessionItem: (key: string, value: string) => Promise<void>;
  removeSessionItem: (key: string) => Promise<void>;
  consumePendingOAuthCallback: () => Promise<string | null>;
  onOAuthCallback: (listener: (callbackUrl: string) => void) => () => void;
};

type DesktopPermissionsApi = {
  requestMicrophoneAccess: () => Promise<boolean>;
  getMicrophoneAccessStatus: () => Promise<string>;
  openMicrophoneSettings: () => Promise<void>;
};

type DesktopApi = {
  ping: () => string;
  getRuntimeInfo: () => DesktopRuntimeInfo;
  getSupabaseConfig: () => DesktopSupabaseConfig;
  shortcut?: DesktopShortcutApi;
  auth?: DesktopAuthApi;
  permissions?: DesktopPermissionsApi;
};

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export {};
