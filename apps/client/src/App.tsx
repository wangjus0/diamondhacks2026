import { useEffect, useMemo, useState } from "react";
import { useSession } from "./hooks/useSession";
import { useAudioPlayer } from "./features/narration/useAudioPlayer";
import { ConversationTimeline } from "./features/conversation/ConversationTimeline";
import { useAuth } from "./features/auth/AuthProvider";
import { getSupabaseClient } from "./lib/supabase";
import {
  createDefaultOnboardingData,
  createPayload,
  deriveCurrentStep,
  mergePersistedOnboardingData,
  type MicrophoneAccessStatus,
  type OnboardingFormData,
} from "./features/auth/onboardingSchema";
import { normalizeMicrophoneAccessStatus } from "./features/auth/microphonePermission";
import {
  BROWSER_USE_INTEGRATIONS,
  BROWSER_USE_TOTAL_INTEGRATIONS,
} from "./data/browserUseIntegrations";
import { INTEGRATION_CONNECTION_STATE_STORAGE_KEY } from "./lib/integration-auth";
import {
  getAuthModeLabel,
  getIntegrationAuthDescriptor,
  type IntegrationAuthDescriptor,
} from "./data/integrationAuthMatrix";

type WorkspaceView = "home" | "integrations" | "settings";

const DEFAULT_SHORTCUT = "Cmd+Shift+Space";
const SHORTCUT_MODIFIER_KEYS = new Set(["Shift", "Control", "Meta", "Alt", "AltGraph"]);
const SHORTCUT_KEY_LABELS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
};

const MICROPHONE_STATUS_LABELS: Record<OnboardingFormData["permissions"]["microphoneAccess"], string> = {
  granted: "Granted",
  denied: "Denied",
  restricted: "Restricted",
  "not-determined": "Not requested",
  unknown: "Unknown",
  unsupported: "Unsupported",
};

function formatShortcutParts(shortcut: string): string[] {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

type ShortcutInputEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

type IntegrationConnectionState = {
  oauthConnected: boolean;
  apiKeyValues: Record<string, string>;
  updatedAt: number;
};

function createEmptyIntegrationConnectionState(): IntegrationConnectionState {
  return {
    oauthConnected: false,
    apiKeyValues: {},
    updatedAt: Date.now(),
  };
}

function readStoredIntegrationConnectionState(): Record<string, IntegrationConnectionState> {
  try {
    const raw = localStorage.getItem(INTEGRATION_CONNECTION_STATE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<
      string,
      {
        oauthConnected?: unknown;
        apiKeyValues?: unknown;
        updatedAt?: unknown;
      }
    >;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const nextEntries: Array<[string, IntegrationConnectionState]> = [];
    for (const [integrationName, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const oauthConnected = entry.oauthConnected === true;
      const apiKeyValues =
        entry.apiKeyValues && typeof entry.apiKeyValues === "object"
          ? Object.fromEntries(
              Object.entries(entry.apiKeyValues as Record<string, unknown>).filter(
                ([fieldId, value]) => typeof fieldId === "string" && typeof value === "string",
              ) as Array<[string, string]>,
            )
          : {};
      const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now();

      nextEntries.push([
        integrationName,
        {
          oauthConnected,
          apiKeyValues,
          updatedAt,
        },
      ]);
    }

    return Object.fromEntries(nextEntries);
  } catch {
    return {};
  }
}

function writeStoredIntegrationConnectionState(
  state: Record<string, IntegrationConnectionState>,
): void {
  try {
    localStorage.setItem(INTEGRATION_CONNECTION_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // no-op in restricted runtimes
  }
}

function areRequiredApiKeyFieldsConnected(
  descriptor: IntegrationAuthDescriptor,
  connection: IntegrationConnectionState,
): boolean {
  const requiredFields = descriptor.apiKeyFields ?? [];
  if (requiredFields.length === 0) {
    return true;
  }

  return requiredFields.every((field) => {
    const value = connection.apiKeyValues[field.id];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function isIntegrationConnected(
  descriptor: IntegrationAuthDescriptor,
  connection: IntegrationConnectionState,
): boolean {
  if (descriptor.authMode === "oauth") {
    return connection.oauthConnected;
  }

  if (descriptor.authMode === "api_key") {
    return areRequiredApiKeyFieldsConnected(descriptor, connection);
  }

  return connection.oauthConnected && areRequiredApiKeyFieldsConnected(descriptor, connection);
}

function formatShortcutFromKeyDown(event: ShortcutInputEvent): string | null {
  const key = event.key;
  if (!key || key === "Dead" || SHORTCUT_MODIFIER_KEYS.has(key)) {
    return null;
  }

  const modifiers: string[] = [];
  if (event.metaKey) {
    modifiers.push("Cmd");
  }
  if (event.ctrlKey) {
    modifiers.push("Ctrl");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }

  let normalizedKey = SHORTCUT_KEY_LABELS[key] ?? key;
  if (normalizedKey.length === 1) {
    normalizedKey = normalizedKey.toUpperCase();
  } else if (!SHORTCUT_KEY_LABELS[key]) {
    normalizedKey = normalizedKey.charAt(0).toUpperCase() + normalizedKey.slice(1);
  }

  return [...modifiers, normalizedKey].join("+");
}

export function App() {
  const { user, signOut, authError, clearAuthError } = useAuth();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const audioPlayer = useAudioPlayer();
  useSession(audioPlayer);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("home");
  const [settingsData, setSettingsData] = useState<OnboardingFormData | null>(null);
  const [settingsStepIndex, setSettingsStepIndex] = useState(1);
  const [isLoadingSettingsData, setIsLoadingSettingsData] = useState(false);
  const [isSavingSettingsData, setIsSavingSettingsData] = useState(false);
  const [isCheckingMicrophonePermission, setIsCheckingMicrophonePermission] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsStatusMessage, setSettingsStatusMessage] = useState<string | null>(null);
  const [isCapturingSettingsShortcut, setIsCapturingSettingsShortcut] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [integrationCatalogQuery, setIntegrationCatalogQuery] = useState("");
  const [selectedIntegrationName, setSelectedIntegrationName] = useState<string>(
    BROWSER_USE_INTEGRATIONS[0] ?? "Gmail",
  );
  const [integrationConnections, setIntegrationConnections] = useState<
    Record<string, IntegrationConnectionState>
  >({});
  const [integrationCredentialDrafts, setIntegrationCredentialDrafts] = useState<
    Record<string, Record<string, string>>
  >({});
  const [integrationAuthError, setIntegrationAuthError] = useState<string | null>(null);
  const [integrationAuthStatusMessage, setIntegrationAuthStatusMessage] = useState<string | null>(null);

  const shortcutParts = useMemo(
    () => formatShortcutParts(settingsData?.preferences.shortcutBehavior ?? DEFAULT_SHORTCUT),
    [settingsData?.preferences.shortcutBehavior],
  );
  const isNameDirty = settingsData
    ? displayNameDraft.trim() !== settingsData.account.displayName.trim()
    : false;
  const filteredIntegrationCatalog = useMemo(() => {
    const query = integrationCatalogQuery.trim().toLowerCase();
    const matching = query
      ? BROWSER_USE_INTEGRATIONS.filter((name) => name.toLowerCase().includes(query))
      : BROWSER_USE_INTEGRATIONS;

    return [...matching].sort((a, b) => a.localeCompare(b));
  }, [integrationCatalogQuery]);
  const selectedIntegrationDescriptor = useMemo(
    () => getIntegrationAuthDescriptor(selectedIntegrationName),
    [selectedIntegrationName],
  );
  const selectedIntegrationConnection = useMemo(() => {
    return (
      integrationConnections[selectedIntegrationName] ??
      createEmptyIntegrationConnectionState()
    );
  }, [integrationConnections, selectedIntegrationName]);
  const selectedIntegrationDraftValues = useMemo(() => {
    const existingDraft = integrationCredentialDrafts[selectedIntegrationName];
    if (existingDraft) {
      return existingDraft;
    }

    return selectedIntegrationConnection.apiKeyValues;
  }, [
    integrationCredentialDrafts,
    selectedIntegrationConnection.apiKeyValues,
    selectedIntegrationName,
  ]);
  const selectedIntegrationIsConnected = useMemo(
    () =>
      isIntegrationConnected(selectedIntegrationDescriptor, selectedIntegrationConnection),
    [selectedIntegrationConnection, selectedIntegrationDescriptor],
  );
  const setupIntegrations = useMemo(
    () =>
      filteredIntegrationCatalog.filter((integrationName) => {
        const descriptor = getIntegrationAuthDescriptor(integrationName);
        const connection =
          integrationConnections[integrationName] ??
          createEmptyIntegrationConnectionState();
        return isIntegrationConnected(descriptor, connection);
      }),
    [filteredIntegrationCatalog, integrationConnections],
  );
  const needsSetupIntegrations = useMemo(
    () =>
      filteredIntegrationCatalog.filter((integrationName) => {
        const descriptor = getIntegrationAuthDescriptor(integrationName);
        const connection =
          integrationConnections[integrationName] ??
          createEmptyIntegrationConnectionState();
        return !isIntegrationConnected(descriptor, connection);
      }),
    [filteredIntegrationCatalog, integrationConnections],
  );

  const titlebarSubtitle =
    activeView === "home"
      ? "Session event stream"
      : activeView === "integrations"
        ? "Integration setup"
      : activeView === "settings"
        ? "Workspace settings"
        : "Voice assistant workspace";

  const handleSignOut = async () => {
    clearAuthError();
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  const persistSettingsData = async (nextData: OnboardingFormData) => {
    if (!user) {
      throw new Error("You must be signed in to update settings.");
    }

    setIsSavingSettingsData(true);
    const payload = createPayload(settingsStepIndex, nextData);
    const { error: upsertError } = await supabase.from("onboarding_responses").upsert(
      {
        user_id: user.id,
        responses: payload,
        completed: true,
      },
      { onConflict: "user_id" },
    );
    setIsSavingSettingsData(false);

    if (upsertError) {
      throw new Error(upsertError.message);
    }
  };

  const updateShortcutBehavior = async (shortcut: string) => {
    if (!settingsData) {
      return;
    }

    const nextData: OnboardingFormData = {
      ...settingsData,
      preferences: {
        ...settingsData.preferences,
        shortcutBehavior: shortcut,
      },
    };

    setSettingsData(nextData);
    if (shortcut.trim().length === 0) {
      return;
    }

    setSettingsError(null);
    try {
      await persistSettingsData(nextData);
      setSettingsStatusMessage("Keybind updated.");
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : "Failed to save keybind.");
    }
  };

  const saveDisplayName = async () => {
    if (!settingsData) {
      return;
    }

    const nextName = displayNameDraft.trim();
    if (nextName.length === 0) {
      setSettingsError("Name is required.");
      return;
    }

    const nextData: OnboardingFormData = {
      ...settingsData,
      account: {
        ...settingsData.account,
        displayName: nextName,
      },
    };

    setSettingsData(nextData);
    setSettingsError(null);
    setSettingsStatusMessage(null);

    try {
      await persistSettingsData(nextData);
      setSettingsStatusMessage("Name updated.");
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : "Failed to save name.");
    }
  };

  const checkMicrophoneStatus = async () => {
    if (!settingsData) {
      return;
    }

    setIsCheckingMicrophonePermission(true);
    setSettingsError(null);
    setSettingsStatusMessage(null);

    let nextStatus: MicrophoneAccessStatus = "not-determined";
    try {
      if (window.desktop?.permissions?.getMicrophoneAccessStatus) {
        const status = await window.desktop.permissions.getMicrophoneAccessStatus();
        nextStatus = normalizeMicrophoneAccessStatus(status);
      } else if (!navigator.mediaDevices?.getUserMedia) {
        nextStatus = "unsupported";
      }

      const nextData: OnboardingFormData = {
        ...settingsData,
        permissions: {
          ...settingsData.permissions,
          microphoneAccess: nextStatus,
        },
      };

      setSettingsData(nextData);
      await persistSettingsData(nextData);
      setSettingsStatusMessage("Microphone status refreshed.");
    } catch (statusError) {
      setSettingsError(statusError instanceof Error ? statusError.message : "Failed to check microphone status.");
    } finally {
      setIsCheckingMicrophonePermission(false);
    }
  };

  const requestMicrophoneAccess = async () => {
    if (!settingsData) {
      return;
    }

    setSettingsError(null);
    setSettingsStatusMessage(null);

    try {
      let nextStatus: MicrophoneAccessStatus;
      let nextMessage = "Microphone access granted.";

      if (window.desktop?.permissions?.requestMicrophoneAccess) {
        const granted = await window.desktop.permissions.requestMicrophoneAccess();
        nextStatus = granted ? "granted" : "denied";
        if (!granted) {
          nextMessage = "Microphone access denied. Open settings to enable.";
        }
      } else if (!navigator.mediaDevices?.getUserMedia) {
        nextStatus = "unsupported";
        nextMessage = "Microphone permission is not supported in this runtime.";
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        nextStatus = "granted";
      }

      const nextData: OnboardingFormData = {
        ...settingsData,
        permissions: {
          ...settingsData.permissions,
          microphoneAccess: nextStatus,
        },
      };

      setSettingsData(nextData);
      await persistSettingsData(nextData);
      setSettingsStatusMessage(nextMessage);
    } catch {
      setSettingsError("Microphone access was denied. You can retry or open system settings.");
    }
  };

  const openMicrophoneSettings = async () => {
    if (window.desktop?.permissions?.openMicrophoneSettings) {
      await window.desktop.permissions.openMicrophoneSettings();
      return;
    }

    setSettingsStatusMessage("Open your browser or system privacy settings to enable microphone access.");
  };

  const updateIntegrationConnectionState = (
    integrationName: string,
    updater: (previous: IntegrationConnectionState) => IntegrationConnectionState,
  ) => {
    setIntegrationConnections((previous) => {
      const previousConnection =
        previous[integrationName] ?? createEmptyIntegrationConnectionState();
      const nextConnection = updater(previousConnection);
      const nextState = {
        ...previous,
        [integrationName]: nextConnection,
      };
      writeStoredIntegrationConnectionState(nextState);
      return nextState;
    });
  };

  const openOAuthForSelectedIntegration = async () => {
    setIntegrationAuthError(null);
    setIntegrationAuthStatusMessage(null);
    const encodedName = encodeURIComponent(selectedIntegrationName);
    const integrationUrl = `https://cloud.browser-use.com/integrations?integration=${encodedName}`;

    if (window.desktop?.openExternalUrl) {
      await window.desktop.openExternalUrl(integrationUrl);
    } else {
      window.open(integrationUrl, "_blank", "noopener,noreferrer");
    }
  };

  const markSelectedIntegrationOAuthConnection = (connected: boolean) => {
    updateIntegrationConnectionState(selectedIntegrationName, (previous) => ({
      ...previous,
      oauthConnected: connected,
      updatedAt: Date.now(),
    }));
    setIntegrationAuthError(null);
    setIntegrationAuthStatusMessage(
      connected
        ? `${selectedIntegrationName} OAuth marked connected.`
        : `${selectedIntegrationName} OAuth marked disconnected.`,
    );
  };

  const updateSelectedIntegrationApiKeyDraft = (fieldId: string, value: string) => {
    setIntegrationCredentialDrafts((previous) => ({
      ...previous,
      [selectedIntegrationName]: {
        ...(previous[selectedIntegrationName] ?? selectedIntegrationConnection.apiKeyValues),
        [fieldId]: value,
      },
    }));
  };

  const saveSelectedIntegrationApiKeys = () => {
    setIntegrationAuthError(null);
    setIntegrationAuthStatusMessage(null);
    const requiredFields = selectedIntegrationDescriptor.apiKeyFields ?? [];
    const draftValues = selectedIntegrationDraftValues;

    for (const field of requiredFields) {
      const value = draftValues[field.id];
      if (!value || value.trim().length === 0) {
        setIntegrationAuthError(`${field.label} is required.`);
        return;
      }
    }

    updateIntegrationConnectionState(selectedIntegrationName, (previous) => ({
      ...previous,
      apiKeyValues: requiredFields.reduce<Record<string, string>>((accumulator, field) => {
        accumulator[field.id] = (draftValues[field.id] ?? "").trim();
        return accumulator;
      }, {}),
      updatedAt: Date.now(),
    }));
    setIntegrationAuthStatusMessage(`${selectedIntegrationName} API credentials saved.`);
  };

  const resetSelectedIntegrationConnection = () => {
    updateIntegrationConnectionState(selectedIntegrationName, () => ({
      oauthConnected: false,
      apiKeyValues: {},
      updatedAt: Date.now(),
    }));
    setIntegrationCredentialDrafts((previous) => ({
      ...previous,
      [selectedIntegrationName]: {},
    }));
    setIntegrationAuthError(null);
    setIntegrationAuthStatusMessage(`${selectedIntegrationName} connection reset.`);
  };

  useEffect(() => {
    setIntegrationConnections(readStoredIntegrationConnectionState());
  }, []);

  useEffect(() => {
    if (activeView !== "settings" || !user) {
      return;
    }

    let active = true;
    const loadSettingsData = async () => {
      setIsLoadingSettingsData(true);
      setSettingsError(null);
      setSettingsStatusMessage(null);

      const { data, error: selectError } = await supabase
        .from("onboarding_responses")
        .select("responses")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!active) {
        return;
      }

      if (selectError) {
        setSettingsError(selectError.message);
        setIsLoadingSettingsData(false);
        return;
      }

      const merged = mergePersistedOnboardingData(data?.responses ?? null);
      setSettingsData(merged);
      setDisplayNameDraft(merged.account.displayName);
      setSettingsStepIndex(deriveCurrentStep(data?.responses ?? null));
      setIsLoadingSettingsData(false);
    };

    void loadSettingsData();

    return () => {
      active = false;
    };
  }, [activeView, supabase, user]);

  useEffect(() => {
    if (activeView !== "settings" || !isCapturingSettingsShortcut) {
      return;
    }

    const handleShortcutKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setIsCapturingSettingsShortcut(false);
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "Backspace") {
        void updateShortcutBehavior("");
        setIsCapturingSettingsShortcut(false);
        return;
      }

      const shortcut = formatShortcutFromKeyDown(event);
      if (!shortcut) {
        return;
      }

      void updateShortcutBehavior(shortcut);
      setIsCapturingSettingsShortcut(false);
    };

    window.addEventListener("keydown", handleShortcutKeyDown);
    return () => {
      window.removeEventListener("keydown", handleShortcutKeyDown);
    };
  }, [activeView, isCapturingSettingsShortcut, settingsData]);

  return (
    <div className="screen app-screen">
      <div className="app-frame">
        <div className="app-window-drag-handle" aria-hidden="true" />
        <aside className="app-rail" aria-label="Primary navigation">
          <div className="rail-logo" aria-hidden="true">Murmur</div>
          <button
            className={`rail-item${activeView === "home" ? " rail-item-active" : ""}`}
            aria-label="Home"
            type="button"
            onClick={() => {
              setActiveView("home");
            }}
          >
            Home
          </button>
          <button
            className={`rail-item${activeView === "integrations" ? " rail-item-active" : ""}`}
            aria-label="Integrations"
            type="button"
            onClick={() => {
              setActiveView("integrations");
            }}
          >
            Integrations
          </button>
          <button
            className={`rail-item${activeView === "settings" ? " rail-item-active" : ""}`}
            aria-label="Settings"
            type="button"
            onClick={() => {
              setActiveView("settings");
            }}
          >
            Settings
          </button>
          <button
            className="rail-item rail-item-signout"
            aria-label="Sign out"
            type="button"
            onClick={() => {
              void handleSignOut();
            }}
            disabled={isSigningOut}
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </button>
        </aside>

        <div className="app-workspace">
          <header className={`app-topbar${activeView === "home" ? " app-topbar-home" : ""}`}>
            <div className="app-title-group">
              <p className="app-titlebar-label">Murmur</p>
              <p className="app-titlebar-subtitle">{titlebarSubtitle}</p>
            </div>

            {activeView === "home" && (
              <div className="app-topbar-home-spacer" aria-hidden="true" />
            )}
          </header>

          {activeView === "home" && (
            <div className="app-dashboard app-dashboard-timeline">
              {authError && <div className="alert alert-danger">{authError}</div>}
              <ConversationTimeline />
            </div>
          )}

          {activeView === "integrations" && (
            <div className="app-dashboard app-dashboard-integrations">
              <section className="panel stack-panel integrations-panel">
                <section className="integrations-catalog" aria-label="Supported integrations catalog">
                  <div className="integrations-catalog-header">
                    <h4 className="panel-heading">Supported integrations</h4>
                    <span className="integrations-catalog-meta">
                      Loaded {BROWSER_USE_INTEGRATIONS.length} of {BROWSER_USE_TOTAL_INTEGRATIONS}
                    </span>
                  </div>

                  <div className="field">
                    <span className="field-label">Search</span>
                    <input
                      type="search"
                      value={integrationCatalogQuery}
                      onChange={(event) => {
                        setIntegrationCatalogQuery(event.target.value);
                      }}
                      placeholder="Search supported integrations..."
                      aria-label="Search supported integrations"
                    />
                  </div>

                  <div className="integrations-auth-workspace">
                    <article className="integration-auth-card">
                      <div className="integration-auth-card-header">
                        <h5 className="integration-auth-card-title">{selectedIntegrationName}</h5>
                        <span
                          className={`integration-connection-state ${selectedIntegrationIsConnected ? "integration-connection-state-connected" : "integration-connection-state-disconnected"}`}
                        >
                          {selectedIntegrationIsConnected ? "Connected" : "Needs setup"}
                        </span>
                      </div>

                      <p className="status-note">
                        Auth mode: <strong>{getAuthModeLabel(selectedIntegrationDescriptor.authMode)}</strong>
                      </p>

                      {integrationAuthError && <div className="alert alert-danger">{integrationAuthError}</div>}
                      {integrationAuthStatusMessage && (
                        <div className="alert alert-info">{integrationAuthStatusMessage}</div>
                      )}

                      {(selectedIntegrationDescriptor.authMode === "oauth" ||
                        selectedIntegrationDescriptor.authMode === "oauth_and_api_key") && (
                        <div className="integrations-auth-section">
                          <p className="integration-auth-section-title">OAuth</p>
                          <p className="status-note">
                            Connect via {selectedIntegrationDescriptor.oauthProvider ?? selectedIntegrationName}.
                          </p>
                          <div className="integrations-actions">
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => {
                                void openOAuthForSelectedIntegration();
                              }}
                            >
                              Open OAuth
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => {
                                markSelectedIntegrationOAuthConnection(
                                  !selectedIntegrationConnection.oauthConnected,
                                );
                              }}
                            >
                              {selectedIntegrationConnection.oauthConnected
                                ? "Mark OAuth disconnected"
                                : "Mark OAuth connected"}
                            </button>
                            {selectedIntegrationDescriptor.authMode === "oauth" && (
                              <button
                                type="button"
                                className="button button-secondary"
                                onClick={resetSelectedIntegrationConnection}
                              >
                                Reset connection
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {(selectedIntegrationDescriptor.authMode === "api_key" ||
                        selectedIntegrationDescriptor.authMode === "oauth_and_api_key") && (
                        <div className="integrations-auth-section">
                          <p className="integration-auth-section-title">API credentials</p>
                          <div className="onboarding-fields">
                            {(selectedIntegrationDescriptor.apiKeyFields ?? []).map((field) => (
                              <label key={field.id} className="field">
                                <span className="field-label">{field.label}</span>
                                <input
                                  type={field.secret ? "password" : "text"}
                                  value={selectedIntegrationDraftValues[field.id] ?? ""}
                                  onChange={(event) => {
                                    updateSelectedIntegrationApiKeyDraft(
                                      field.id,
                                      event.target.value,
                                    );
                                  }}
                                  placeholder={field.placeholder}
                                />
                              </label>
                            ))}
                          </div>
                          <div className="integrations-actions">
                            <button
                              type="button"
                              className="button button-primary"
                              onClick={saveSelectedIntegrationApiKeys}
                            >
                              Save API credentials
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={resetSelectedIntegrationConnection}
                            >
                              Reset connection
                            </button>
                          </div>
                        </div>
                      )}
                    </article>

                    {filteredIntegrationCatalog.length === 0 ? (
                      <p className="timeline-empty">No integrations match your search.</p>
                    ) : (
                      <div className="integrations-catalog-cells">
                        <article className="integrations-catalog-cell" aria-label="Set up integrations">
                          <div className="integrations-catalog-cell-header">
                            <h5 className="integration-auth-card-title">Set up</h5>
                            <span className="integrations-catalog-meta">
                              {setupIntegrations.length}
                            </span>
                          </div>
                          <div className="integrations-catalog-cell-body">
                            {setupIntegrations.length === 0 ? (
                              <p className="timeline-empty">No integrations are set up yet.</p>
                            ) : (
                              <div className="integrations-catalog-grid">
                                {setupIntegrations.map((integrationName) => {
                                  const descriptor = getIntegrationAuthDescriptor(integrationName);
                                  const connection =
                                    integrationConnections[integrationName] ??
                                    createEmptyIntegrationConnectionState();
                                  const connected = isIntegrationConnected(descriptor, connection);

                                  return (
                                    <button
                                      key={integrationName}
                                      type="button"
                                      className={`integration-catalog-item ${integrationName === selectedIntegrationName ? "integration-catalog-item-selected" : ""}`}
                                      onClick={() => {
                                        setSelectedIntegrationName(integrationName);
                                        setIntegrationAuthError(null);
                                        setIntegrationAuthStatusMessage(null);
                                      }}
                                    >
                                      <span>{integrationName}</span>
                                      <span className="integration-catalog-item-meta">
                                        <span className="integration-catalog-mode">
                                          {getAuthModeLabel(descriptor.authMode)}
                                        </span>
                                        <span
                                          className={`integration-catalog-status ${connected ? "integration-catalog-status-connected" : ""}`}
                                        >
                                          {connected ? "Connected" : "Setup"}
                                        </span>
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </article>

                        <article className="integrations-catalog-cell" aria-label="Integrations that need setup">
                          <div className="integrations-catalog-cell-header">
                            <h5 className="integration-auth-card-title">Needs setup</h5>
                            <span className="integrations-catalog-meta">
                              {needsSetupIntegrations.length}
                            </span>
                          </div>
                          <div className="integrations-catalog-cell-body">
                            {needsSetupIntegrations.length === 0 ? (
                              <p className="timeline-empty">All matching integrations are set up.</p>
                            ) : (
                              <div className="integrations-catalog-grid">
                                {needsSetupIntegrations.map((integrationName) => {
                                  const descriptor = getIntegrationAuthDescriptor(integrationName);
                                  const connection =
                                    integrationConnections[integrationName] ??
                                    createEmptyIntegrationConnectionState();
                                  const connected = isIntegrationConnected(descriptor, connection);

                                  return (
                                    <button
                                      key={integrationName}
                                      type="button"
                                      className={`integration-catalog-item ${integrationName === selectedIntegrationName ? "integration-catalog-item-selected" : ""}`}
                                      onClick={() => {
                                        setSelectedIntegrationName(integrationName);
                                        setIntegrationAuthError(null);
                                        setIntegrationAuthStatusMessage(null);
                                      }}
                                    >
                                      <span>{integrationName}</span>
                                      <span className="integration-catalog-item-meta">
                                        <span className="integration-catalog-mode">
                                          {getAuthModeLabel(descriptor.authMode)}
                                        </span>
                                        <span
                                          className={`integration-catalog-status ${connected ? "integration-catalog-status-connected" : ""}`}
                                        >
                                          {connected ? "Connected" : "Setup"}
                                        </span>
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </article>
                      </div>
                    )}
                  </div>
                </section>
              </section>
            </div>
          )}

          {activeView === "settings" && (
            <div className="app-dashboard app-dashboard-settings">
              <section className="panel stack-panel settings-panel">
                <h3 className="panel-heading">Settings</h3>

                {settingsError && <div className="alert alert-danger">{settingsError}</div>}
                {settingsStatusMessage && <div className="alert alert-info">{settingsStatusMessage}</div>}

                <div className="settings-step-list">
                  <article className="section-card settings-step-card">
                    <h4 className="settings-step-title">Profile</h4>
                    <div className="field settings-name-field">
                      <span className="field-label">Name</span>
                      <div className="settings-name-row">
                        <input
                          type="text"
                          value={displayNameDraft}
                          onChange={(event) => {
                            setDisplayNameDraft(event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") {
                              return;
                            }
                            event.preventDefault();
                            void saveDisplayName();
                          }}
                          placeholder="Your name"
                        />
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            void saveDisplayName();
                          }}
                          disabled={!isNameDirty || isSavingSettingsData}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </article>

                  <article className="section-card settings-step-card">
                    <h4 className="settings-step-title">Frequent Info</h4>
                    <p style={{ fontSize: "0.85rem", opacity: 0.7, margin: "0 0 0.75rem" }}>
                      Commonly-used personal data that helps Murmur auto-fill forms.
                    </p>

                    <div className="field">
                      <span className="field-label">Phone number</span>
                      <input
                        type="tel"
                        value={settingsData?.frequentInfo?.phone ?? ""}
                        onChange={(event) => {
                          if (!settingsData) return;
                          setSettingsData({
                            ...settingsData,
                            frequentInfo: { ...settingsData.frequentInfo, phone: event.target.value },
                          });
                        }}
                        placeholder="(123) 456-7890"
                      />
                    </div>

                    <div className="field">
                      <span className="field-label">Student ID / PID</span>
                      <input
                        type="text"
                        value={settingsData?.frequentInfo?.pid ?? ""}
                        onChange={(event) => {
                          if (!settingsData) return;
                          setSettingsData({
                            ...settingsData,
                            frequentInfo: { ...settingsData.frequentInfo, pid: event.target.value },
                          });
                        }}
                        placeholder="e.g. A12345678"
                      />
                    </div>

                    <div className="field">
                      <span className="field-label">Year in school</span>
                      <select
                        value={settingsData?.frequentInfo?.yearInSchool ?? ""}
                        onChange={(event) => {
                          if (!settingsData) return;
                          setSettingsData({
                            ...settingsData,
                            frequentInfo: { ...settingsData.frequentInfo, yearInSchool: event.target.value },
                          });
                        }}
                      >
                        <option value="">Select...</option>
                        <option value="1st year">1st year</option>
                        <option value="2nd year">2nd year</option>
                        <option value="3rd year">3rd year</option>
                        <option value="4th year">4th year</option>
                        <option value="5th year+">5th year+</option>
                        <option value="Graduate">Graduate</option>
                        <option value="N/A">N/A</option>
                      </select>
                    </div>

                    <div className="field">
                      <span className="field-label">Major</span>
                      <input
                        type="text"
                        value={settingsData?.frequentInfo?.major ?? ""}
                        onChange={(event) => {
                          if (!settingsData) return;
                          setSettingsData({
                            ...settingsData,
                            frequentInfo: { ...settingsData.frequentInfo, major: event.target.value },
                          });
                        }}
                        placeholder="e.g. Computer Science"
                      />
                    </div>

                    <div className="field">
                      <span className="field-label">Current job / role</span>
                      <input
                        type="text"
                        value={settingsData?.frequentInfo?.job ?? ""}
                        onChange={(event) => {
                          if (!settingsData) return;
                          setSettingsData({
                            ...settingsData,
                            frequentInfo: { ...settingsData.frequentInfo, job: event.target.value },
                          });
                        }}
                        placeholder="e.g. Software Engineer Intern"
                      />
                    </div>

                    <div className="field">
                      <span className="field-label">Employer / Company</span>
                      <input
                        type="text"
                        value={settingsData?.frequentInfo?.employer ?? ""}
                        onChange={(event) => {
                          if (!settingsData) return;
                          setSettingsData({
                            ...settingsData,
                            frequentInfo: { ...settingsData.frequentInfo, employer: event.target.value },
                          });
                        }}
                        placeholder="e.g. Acme Corp"
                      />
                    </div>

                    <div className="field">
                      <span className="field-label">Mailing address</span>
                      <textarea
                        rows={2}
                        value={settingsData?.frequentInfo?.address ?? ""}
                        onChange={(event) => {
                          if (!settingsData) return;
                          setSettingsData({
                            ...settingsData,
                            frequentInfo: { ...settingsData.frequentInfo, address: event.target.value },
                          });
                        }}
                        placeholder="123 Main St, City, ST 12345"
                      />
                    </div>

                    <div className="field">
                      <span className="field-label">Date of birth</span>
                      <input
                        type="text"
                        value={settingsData?.frequentInfo?.dateOfBirth ?? ""}
                        onChange={(event) => {
                          if (!settingsData) return;
                          setSettingsData({
                            ...settingsData,
                            frequentInfo: { ...settingsData.frequentInfo, dateOfBirth: event.target.value },
                          });
                        }}
                        placeholder="MM/DD/YYYY"
                      />
                    </div>

                    <div className="field">
                      <span className="field-label">Gender</span>
                      <select
                        value={settingsData?.frequentInfo?.gender ?? ""}
                        onChange={(event) => {
                          if (!settingsData) return;
                          setSettingsData({
                            ...settingsData,
                            frequentInfo: { ...settingsData.frequentInfo, gender: event.target.value },
                          });
                        }}
                      >
                        <option value="">Select...</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Non-binary">Non-binary</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div style={{ marginTop: "0.75rem" }}>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => {
                          if (!settingsData) return;
                          void (async () => {
                            setSettingsError(null);
                            setSettingsStatusMessage(null);
                            try {
                              await persistSettingsData(settingsData);
                              setSettingsStatusMessage("Frequent info saved.");
                            } catch (saveError) {
                              setSettingsError(saveError instanceof Error ? saveError.message : "Failed to save frequent info.");
                            }
                          })();
                        }}
                        disabled={isSavingSettingsData}
                      >
                        Save
                      </button>
                    </div>
                  </article>

                  <article className="section-card settings-step-card">
                    <h4 className="settings-step-title">Voice</h4>

                    <div className="permission-item permission-item-minimal voice-setup-microphone-block settings-microphone-block">
                      <div>
                        <p className="permission-item-title">Microphone access</p>
                        <p className="permission-status">
                          Status: {MICROPHONE_STATUS_LABELS[(settingsData ?? createDefaultOnboardingData()).permissions.microphoneAccess]}
                        </p>
                      </div>
                      <div className="permission-item-actions voice-setup-microphone-actions">
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => {
                            void requestMicrophoneAccess();
                          }}
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            void checkMicrophoneStatus();
                          }}
                          disabled={isCheckingMicrophonePermission}
                        >
                          {isCheckingMicrophonePermission ? "Checking..." : "Re-check"}
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            void openMicrophoneSettings();
                          }}
                        >
                          Settings
                        </button>
                      </div>
                    </div>

                    <div className="field settings-keybind-field">
                      <span className="field-label">Audio pill keybind</span>
                      <div className="shortcut-capture-row">
                        <button
                          type="button"
                          className={`button button-danger shortcut-record-button ${isCapturingSettingsShortcut ? "shortcut-record-button-active" : ""}`}
                          onClick={() => {
                            void updateShortcutBehavior("");
                            setIsCapturingSettingsShortcut((previous) => !previous);
                          }}
                          aria-pressed={isCapturingSettingsShortcut}
                          aria-label={isCapturingSettingsShortcut ? "Stop recording shortcut" : "Record shortcut"}
                        >
                          <span className="shortcut-record-symbol" aria-hidden="true">
                            {isCapturingSettingsShortcut ? "■" : "●"}
                          </span>
                        </button>
                        <div
                          className={`shortcut-keybind-display ${isCapturingSettingsShortcut ? "shortcut-keybind-display-active" : ""}`}
                          aria-label={isCapturingSettingsShortcut ? "Listening for keybind input" : "Current keybind display"}
                        >
                          {shortcutParts.length > 0 ? (
                            <span className="shortcut-keycaps">
                              {shortcutParts.map((part, index) => (
                                <span key={`${part}-${index}`} className="shortcut-keycap-group">
                                  {index > 0 && <span className="shortcut-keycap-plus">+</span>}
                                  <kbd className="shortcut-keycap">{part}</kbd>
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="shortcut-keybind-empty">
                              {isCapturingSettingsShortcut ? "Press keys..." : "No keybind set"}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="button button-secondary shortcut-reset-button"
                          onClick={() => {
                            setIsCapturingSettingsShortcut(false);
                            void updateShortcutBehavior(DEFAULT_SHORTCUT);
                          }}
                        >
                          Reset to default
                        </button>
                      </div>
                      <p className="field-hint">Press Record to update key combo.</p>
                    </div>
                  </article>
                </div>

                {(isLoadingSettingsData || isSavingSettingsData) && (
                  <p className="status-note">
                    {isLoadingSettingsData ? "Loading settings..." : "Saving changes..."}
                  </p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
