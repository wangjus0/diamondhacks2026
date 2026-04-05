import { useEffect, useMemo, useState } from "react";
import {
  hydrateBrowserUseApiKeyFromDesktop,
  normalizeBrowserProfileId,
  normalizeBrowserUseApiKey,
  persistBrowserProfileId,
  persistBrowserUseApiKey,
} from "../../lib/browser-profile";
import { resolveServerHttpOrigin } from "../../lib/server-origin";
import { getSupabaseClient } from "../../lib/supabase";
import { useAuth } from "./AuthProvider";
import {
  createDefaultOnboardingData,
  createPayload,
  deriveCurrentStep,
  mergePersistedOnboardingData,
  validateStep,
  type MicrophoneAccessStatus,
  type OnboardingFormData,
  type StepErrors,
  type StepKey,
} from "./onboardingSchema";
import { isMicrophoneAccessSatisfied, normalizeMicrophoneAccessStatus } from "./microphonePermission";

type OnboardingGateScaffoldProps = {
  onCompleted: () => void;
  initialLoadError?: string | null;
};

type OnboardingRow = {
  responses: unknown;
  completed: boolean;
};

type StepMeta = {
  key: StepKey;
  title: string;
  description: string;
};

const STEP_META: StepMeta[] = [
  {
    key: "permissions",
    title: "Permissions",
    description: "Enable assistant and microphone access before starting your first session.",
  },
  {
    key: "account",
    title: "Account basics",
    description: "Placeholder fields for profile and workspace metadata.",
  },
  {
    key: "workflow",
    title: "Workflow snapshot",
    description: "Placeholder prompts for use cases and primary outcomes.",
  },
  {
    key: "preferences",
    title: "Command preferences",
    description: "Placeholder settings for shortcut and assistant behavior.",
  },
];

const INITIAL_STEP_ERRORS: Record<StepKey, StepErrors> = {
  permissions: {},
  account: {},
  workflow: {},
  preferences: {},
};

const LAST_STEP_INDEX = STEP_META.length - 1;
const BROWSER_PROFILE_SYNC_GUIDE_URL =
  "https://docs.browser-use.com/cloud/guides/profile-sync";
const BROWSER_USE_SETTINGS_URL = "https://cloud.browser-use.com/settings";
const BROWSER_PROFILE_SYNC_COMMAND =
  "export BROWSER_USE_API_KEY=your_key && curl -fsSL https://browser-use.com/profile.sh | sh";

function InlineError({ message, id }: { message?: string; id: string }) {
  if (!message) {
    return null;
  }

  return <p id={id} className="field-error">{message}</p>;
}

const MICROPHONE_STATUS_LABEL: Record<MicrophoneAccessStatus, string> = {
  granted: "Granted",
  denied: "Denied",
  restricted: "Restricted",
  "not-determined": "Not requested",
  unsupported: "Unsupported",
  unknown: "Unknown",
};

function PermissionStep(props: {
  data: OnboardingFormData["permissions"];
  errors: StepErrors;
  onAssistantAccessChange: (value: "granted" | "pending") => void;
  onScreenAccessChange: (value: "granted" | "pending") => void;
  onRequestMicrophoneAccess: () => Promise<void>;
  onCheckMicrophoneStatus: () => Promise<void>;
  onOpenMicrophoneSettings: () => Promise<void>;
  browserUseApiKey: string;
  onBrowserUseApiKeyChange: (value: string) => void;
  onStartAutomaticBrowserProfileSync: () => Promise<void>;
  runningAutomaticSync: boolean;
  onBrowserProfileIdChange: (value: string) => void;
  onOpenBrowserUseSettings: () => Promise<void>;
  onCopyBrowserProfileSyncCommand: () => Promise<void>;
  onOpenBrowserProfileSyncGuide: () => Promise<void>;
  onValidateBrowserProfileId: () => Promise<void>;
  checkingBrowserProfile: boolean;
  browserProfileConnected: boolean;
  checkingStatus: boolean;
}) {
  return (
    <div className="permission-stack">
      <div className="permission-item">
        <div>
          <h3 className="permission-item-title">Allow Murmur to assist</h3>
          <p className="permission-item-copy">Enable helper prompts and contextual guidance while you work.</p>
        </div>
        <button
          type="button"
          className={`permission-toggle ${props.data.assistantAccess === "granted" ? "permission-toggle-on" : ""}`}
          aria-label="Allow Murmur to assist"
          onClick={() => {
            props.onAssistantAccessChange(props.data.assistantAccess === "granted" ? "pending" : "granted");
          }}
          aria-pressed={props.data.assistantAccess === "granted"}
        />
      </div>

      <div className="permission-item">
        <div>
          <h3 className="permission-item-title">Allow microphone access</h3>
          <p className="permission-item-copy">Murmur needs microphone access to capture voice commands.</p>
          <p className="permission-status">Status: {MICROPHONE_STATUS_LABEL[props.data.microphoneAccess]}</p>
          <InlineError id="microphone-access-error" message={props.errors.microphoneAccess} />
        </div>
        <div className="permission-item-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              void props.onRequestMicrophoneAccess();
            }}
          >
            Request access
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              void props.onCheckMicrophoneStatus();
            }}
            disabled={props.checkingStatus}
          >
            {props.checkingStatus ? "Checking..." : "Re-check"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              void props.onOpenMicrophoneSettings();
            }}
          >
            Open settings
          </button>
        </div>
      </div>

      <div className="permission-item">
        <div>
          <h3 className="permission-item-title">Allow screen context</h3>
          <p className="permission-item-copy">Optional: let Murmur understand what is on-screen for better responses.</p>
        </div>
        <button
          type="button"
          className={`permission-toggle ${props.data.screenAccess === "granted" ? "permission-toggle-on" : ""}`}
          aria-label="Allow screen context"
          onClick={() => {
            props.onScreenAccessChange(props.data.screenAccess === "granted" ? "pending" : "granted");
          }}
          aria-pressed={props.data.screenAccess === "granted"}
        />
      </div>

      <div className="permission-item">
        <div>
          <h3 className="permission-item-title">Connect Browser Profile</h3>
          <p className="permission-item-copy">
            Sync your local Chrome cookies to Browser Use, then paste the profile ID so Murmur can reuse your logged-in sessions.
          </p>
          <label className="field">
            <span className="field-label">Browser Use API key</span>
            <input
              type="password"
              value={props.browserUseApiKey}
              onChange={(event) => {
                props.onBrowserUseApiKeyChange(event.target.value);
              }}
              placeholder="bu_..."
            />
          </label>
          <p className="permission-item-copy">
            Tutorial:
          </p>
          <ol className="permission-item-copy">
            <li>Open Browser Use settings and copy your API key.</li>
            <li>Paste the key above and click Sync Automatically.</li>
            <li>In the opened browser, select the accounts to sync.</li>
            <li>If the profile ID is not auto-detected, paste it below and click Verify profile.</li>
          </ol>
          <p className="permission-status">
            Sync command: <code>{BROWSER_PROFILE_SYNC_COMMAND}</code>
          </p>
          <p className="permission-status">
            Status: {props.browserProfileConnected ? "Connected" : "Not connected"}
          </p>
          <label className="field">
            <span className="field-label">Browser Use profile ID</span>
            <input
              type="text"
              value={props.data.browserProfileId}
              onChange={(event) => {
                props.onBrowserProfileIdChange(event.target.value);
              }}
              placeholder="3c90c3cc-0d44-4b50-8888-8dd25736052a"
              aria-invalid={Boolean(props.errors.browserProfileId)}
              aria-describedby={props.errors.browserProfileId ? "browser-profile-id-error" : undefined}
            />
            <InlineError id="browser-profile-id-error" message={props.errors.browserProfileId} />
          </label>
        </div>
        <div className="permission-item-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              void props.onStartAutomaticBrowserProfileSync();
            }}
            disabled={props.runningAutomaticSync}
          >
            {props.runningAutomaticSync ? "Syncing..." : "Sync Automatically"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              void props.onOpenBrowserUseSettings();
            }}
          >
            Open Browser Use Settings
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              void props.onCopyBrowserProfileSyncCommand();
            }}
          >
            Copy Sync Command
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              void props.onOpenBrowserProfileSyncGuide();
            }}
          >
            Open Sync Guide
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              void props.onValidateBrowserProfileId();
            }}
            disabled={props.checkingBrowserProfile}
          >
            {props.checkingBrowserProfile ? "Verifying..." : "Verify profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountStep(props: {
  data: OnboardingFormData["account"];
  errors: StepErrors;
  onDisplayNameChange: (value: string) => void;
  onWorkspaceNameChange: (value: string) => void;
}) {
  return (
    <div className="onboarding-fields">
      <label className="field">
        <span className="field-label">Display name (placeholder)</span>
        <input
          type="text"
          value={props.data.displayName}
          onChange={(event) => props.onDisplayNameChange(event.target.value)}
          placeholder="Alex Rivera"
          aria-invalid={Boolean(props.errors.displayName)}
          aria-describedby={props.errors.displayName ? "display-name-error" : undefined}
        />
        <InlineError id="display-name-error" message={props.errors.displayName} />
      </label>

      <label className="field">
        <span className="field-label">Workspace name (placeholder)</span>
        <input
          type="text"
          value={props.data.workspaceName}
          onChange={(event) => props.onWorkspaceNameChange(event.target.value)}
          placeholder="Murmur Team"
          aria-invalid={Boolean(props.errors.workspaceName)}
          aria-describedby={props.errors.workspaceName ? "workspace-name-error" : undefined}
        />
        <InlineError id="workspace-name-error" message={props.errors.workspaceName} />
      </label>
    </div>
  );
}

function WorkflowStep(props: {
  data: OnboardingFormData["workflow"];
  errors: StepErrors;
  onPrimaryGoalChange: (value: string) => void;
  onUseCasesChange: (value: string) => void;
}) {
  return (
    <div className="onboarding-fields">
      <label className="field">
        <span className="field-label">Primary goal (placeholder)</span>
        <textarea
          value={props.data.primaryGoal}
          onChange={(event) => props.onPrimaryGoalChange(event.target.value)}
          rows={3}
          placeholder="What should Murmur help you accomplish first?"
          className="resizable-textarea"
          aria-invalid={Boolean(props.errors.primaryGoal)}
          aria-describedby={props.errors.primaryGoal ? "primary-goal-error" : undefined}
        />
        <InlineError id="primary-goal-error" message={props.errors.primaryGoal} />
      </label>

      <label className="field">
        <span className="field-label">Frequent use cases (placeholder)</span>
        <textarea
          value={props.data.useCases}
          onChange={(event) => props.onUseCasesChange(event.target.value)}
          rows={3}
          placeholder="Describe the top scenarios you expect to use."
          className="resizable-textarea"
          aria-invalid={Boolean(props.errors.useCases)}
          aria-describedby={props.errors.useCases ? "use-cases-error" : undefined}
        />
        <InlineError id="use-cases-error" message={props.errors.useCases} />
      </label>
    </div>
  );
}

function PreferencesStep(props: {
  data: OnboardingFormData["preferences"];
  errors: StepErrors;
  onShortcutBehaviorChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}) {
  return (
    <div className="onboarding-fields">
      <label className="field">
        <span className="field-label">Shortcut preference (placeholder)</span>
        <input
          type="text"
          value={props.data.shortcutBehavior}
          onChange={(event) => props.onShortcutBehaviorChange(event.target.value)}
          placeholder="Open instantly with context from current app"
          aria-invalid={Boolean(props.errors.shortcutBehavior)}
          aria-describedby={props.errors.shortcutBehavior ? "shortcut-behavior-error" : undefined}
        />
        <InlineError id="shortcut-behavior-error" message={props.errors.shortcutBehavior} />
      </label>

      <label className="field">
        <span className="field-label">Additional notes (placeholder)</span>
        <textarea
          value={props.data.notes}
          onChange={(event) => props.onNotesChange(event.target.value)}
          rows={4}
          placeholder="Any preferences to keep for future onboarding fields."
          className="resizable-textarea"
          aria-invalid={Boolean(props.errors.notes)}
          aria-describedby={props.errors.notes ? "notes-error" : undefined}
        />
        <InlineError id="notes-error" message={props.errors.notes} />
      </label>
    </div>
  );
}

export function OnboardingGateScaffold({ onCompleted, initialLoadError }: OnboardingGateScaffoldProps) {
  const { user, signOut } = useAuth();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [isInitializing, setIsInitializing] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<OnboardingFormData>(createDefaultOnboardingData());
  const [stepErrors, setStepErrors] = useState<Record<StepKey, StepErrors>>(INITIAL_STEP_ERRORS);
  const [saveError, setSaveError] = useState<string | null>(initialLoadError ?? null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isCheckingPermission, setIsCheckingPermission] = useState(false);
  const [isCheckingBrowserProfile, setIsCheckingBrowserProfile] = useState(false);
  const [browserUseApiKey, setBrowserUseApiKey] = useState("");
  const [isRunningAutomaticSync, setIsRunningAutomaticSync] = useState(false);

  const setMicrophoneAccess = (value: MicrophoneAccessStatus) => {
    setFormData((previous) => ({
      ...previous,
      permissions: {
        ...previous.permissions,
        microphoneAccess: value,
      },
    }));

    setStepErrors((previous) => {
      const { microphoneAccess: _removed, ...remaining } = previous.permissions;
      return {
        ...previous,
        permissions: remaining,
      };
    });
  };

  const checkMicrophoneStatus = async () => {
    setIsCheckingPermission(true);
    try {
      if (window.desktop?.permissions?.getMicrophoneAccessStatus) {
        const status = await window.desktop.permissions.getMicrophoneAccessStatus();
        setMicrophoneAccess(normalizeMicrophoneAccessStatus(status));
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophoneAccess("unsupported");
        return;
      }

      setMicrophoneAccess("not-determined");
    } finally {
      setIsCheckingPermission(false);
    }
  };

  const requestMicrophoneAccess = async () => {
    setSaveError(null);
    setStatusMessage(null);

    try {
      if (window.desktop?.permissions?.requestMicrophoneAccess) {
        const granted = await window.desktop.permissions.requestMicrophoneAccess();
        setMicrophoneAccess(granted ? "granted" : "denied");
        setStatusMessage(granted ? "Microphone access granted." : "Microphone access denied. Open settings to enable.");
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophoneAccess("unsupported");
        setStatusMessage("Microphone permission is not supported in this runtime.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      setMicrophoneAccess("granted");
      setStatusMessage("Microphone access granted.");
    } catch {
      setMicrophoneAccess("denied");
      setSaveError("Microphone access was denied. You can retry or open system settings.");
    }
  };

  const openMicrophoneSettings = async () => {
    if (window.desktop?.permissions?.openMicrophoneSettings) {
      await window.desktop.permissions.openMicrophoneSettings();
      return;
    }

    setStatusMessage("Open your browser or system privacy settings to enable microphone access.");
  };

  const openBrowserProfileSyncGuide = async () => {
    const externalUrlApi = window.desktop?.openExternalUrl;
    if (externalUrlApi) {
      await externalUrlApi(BROWSER_PROFILE_SYNC_GUIDE_URL);
      return;
    }

    window.open(BROWSER_PROFILE_SYNC_GUIDE_URL, "_blank", "noopener,noreferrer");
  };

  const openBrowserUseSettings = async () => {
    const externalUrlApi = window.desktop?.openExternalUrl;
    if (externalUrlApi) {
      await externalUrlApi(BROWSER_USE_SETTINGS_URL);
      return;
    }

    window.open(BROWSER_USE_SETTINGS_URL, "_blank", "noopener,noreferrer");
  };

  const copyBrowserProfileSyncCommand = async () => {
    setSaveError(null);

    if (!navigator.clipboard?.writeText) {
      setStatusMessage("Clipboard is unavailable. Copy the command from the tutorial section.");
      return;
    }

    try {
      await navigator.clipboard.writeText(BROWSER_PROFILE_SYNC_COMMAND);
      setStatusMessage("Browser profile sync command copied.");
    } catch {
      setSaveError("Could not copy sync command. Copy it manually from the tutorial section.");
    }
  };

  const validateBrowserProfileId = async () => {
    setSaveError(null);
    setStatusMessage(null);
    setIsCheckingBrowserProfile(true);

    try {
      const candidate = normalizeBrowserProfileId(formData.permissions.browserProfileId);
      if (!candidate) {
        setStepErrors((previous) => ({
          ...previous,
          permissions: {
            ...previous.permissions,
            browserProfileId: "Enter a valid Browser Use profile ID (UUID).",
          },
        }));
        return;
      }

      const serverOrigin = resolveServerHttpOrigin(
        window.location,
        window.desktop?.getRealtimeWebSocketUrl?.()
      );
      const response = await fetch(
        `${serverOrigin}/integrations/browser-use/profiles/${encodeURIComponent(candidate)}/validate`,
        {
          headers: browserUseApiKey
            ? {
                "x-murmur-browser-use-api-key": browserUseApiKey,
              }
            : undefined,
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        valid?: boolean;
        message?: string;
        profileId?: string;
      };
      if (!response.ok || payload.valid !== true) {
        setSaveError(payload.message || "Could not verify Browser Use profile ID.");
        return;
      }

      const normalized = normalizeBrowserProfileId(payload.profileId) ?? candidate;
      updateStepField("permissions", "browserProfileId", normalized);
      await persistBrowserProfileId(normalized);
      setStatusMessage("Browser profile connected.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to verify Browser Use profile ID.");
    } finally {
      setIsCheckingBrowserProfile(false);
    }
  };

  const startAutomaticBrowserProfileSync = async () => {
    setSaveError(null);
    setStatusMessage(null);

    const normalizedApiKey = normalizeBrowserUseApiKey(browserUseApiKey);
    if (!normalizedApiKey) {
      setSaveError("Enter a valid Browser Use API key (starts with bu_).");
      return;
    }

    const syncApi = window.desktop?.browserUse?.startProfileSync;
    if (!syncApi) {
      setSaveError("Automatic sync is only available in the desktop app. Use the guide to sync manually.");
      return;
    }

    setIsRunningAutomaticSync(true);
    try {
      await persistBrowserUseApiKey(normalizedApiKey);
      const result = await syncApi(normalizedApiKey);
      if (!result.success) {
        setSaveError(result.message);
        return;
      }

      if (result.profileId) {
        updateStepField("permissions", "browserProfileId", result.profileId);
        await persistBrowserProfileId(result.profileId);
        setStatusMessage("Browser profile synced and connected.");
        return;
      }

      setStatusMessage("Sync completed. Paste the generated profile ID and click Verify profile.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Automatic profile sync failed.");
    } finally {
      setIsRunningAutomaticSync(false);
    }
  };

  useEffect(() => {
    let isActive = true;

    const hydrate = async () => {
      if (!user) {
        if (isActive) {
          setIsInitializing(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("onboarding_responses")
        .select("responses, completed")
        .eq("user_id", user.id)
        .maybeSingle<OnboardingRow>();

      if (!isActive) {
        return;
      }

      if (error) {
        setSaveError(error.message);
        setIsInitializing(false);
        return;
      }

      if (data?.completed) {
        onCompleted();
        return;
      }

      if (data?.responses) {
        setFormData(mergePersistedOnboardingData(data.responses));
        setCurrentStep(deriveCurrentStep(data.responses));
      }

      setIsInitializing(false);
    };

    void hydrate();
    void hydrateBrowserUseApiKeyFromDesktop().then((apiKey) => {
      if (!apiKey) {
        return;
      }

      setBrowserUseApiKey(apiKey);
    });

    return () => {
      isActive = false;
    };
  }, [onCompleted, supabase, user]);

  useEffect(() => {
    if (currentStep !== 0) {
      return;
    }

    if (formData.permissions.microphoneAccess === "granted") {
      return;
    }

    void checkMicrophoneStatus();
  }, [currentStep]);

  const activeStep = STEP_META[currentStep];
  const assistantEnabled = formData.permissions.assistantAccess === "granted";
  const microphoneReady = isMicrophoneAccessSatisfied(formData.permissions.microphoneAccess);
  const screenEnabled = formData.permissions.screenAccess === "granted";
  const browserProfileConnected = Boolean(
    normalizeBrowserProfileId(formData.permissions.browserProfileId)
  );
  const permissionProgressCount = [
    assistantEnabled,
    microphoneReady,
    screenEnabled,
    browserProfileConnected,
  ].filter(Boolean).length;

  const persistProgress = async (options: { completed: boolean; completedAt: string | null; nextStep: number }) => {
    if (!user) {
      throw new Error("You must be signed in to save onboarding.");
    }

    const payload = createPayload(options.nextStep, formData);

    const { error } = await supabase.from("onboarding_responses").upsert(
      {
        user_id: user.id,
        responses: payload,
        completed: options.completed,
        completed_at: options.completedAt,
      },
      {
        onConflict: "user_id",
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    await persistBrowserProfileId(
      normalizeBrowserProfileId(formData.permissions.browserProfileId)
    );
  };

  const applyValidationForCurrentStep = (): boolean => {
    const key = activeStep.key;
    const validation = validateStep(key, formData);
    setStepErrors((previous) => ({
      ...previous,
      [key]: validation,
    }));

    return Object.keys(validation).length === 0;
  };

  const handleSaveProgress = async () => {
    setSaveError(null);
    setStatusMessage(null);
    setIsSaving(true);

    try {
      await persistProgress({ completed: false, completedAt: null, nextStep: currentStep });
      setStatusMessage("Progress saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save progress.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleNext = async () => {
    if (!applyValidationForCurrentStep()) {
      return;
    }

    const nextStep = Math.min(currentStep + 1, LAST_STEP_INDEX);
    setSaveError(null);
    setStatusMessage(null);
    setIsSaving(true);

    try {
      await persistProgress({ completed: false, completedAt: null, nextStep });
      setCurrentStep(nextStep);
      setStatusMessage("Progress saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save progress.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    setSaveError(null);
    setStatusMessage(null);
    setCurrentStep((previous) => Math.max(0, previous - 1));
  };

  const updateStepField = <TStep extends StepKey, TField extends keyof OnboardingFormData[TStep]>(
    step: TStep,
    field: TField,
    value: string,
  ) => {
    setFormData((previous) => ({
      ...previous,
      [step]: {
        ...previous[step],
        [field]: value,
      },
    }));

    setStepErrors((previous) => {
      const currentStepErrors = previous[step];
      const { [field as string]: _removed, ...remainingStepErrors } = currentStepErrors;

      return {
        ...previous,
        [step]: remainingStepErrors,
      };
    });
  };

  const handleComplete = async () => {
    if (!applyValidationForCurrentStep()) {
      return;
    }

    if (!isMicrophoneAccessSatisfied(formData.permissions.microphoneAccess)) {
      setCurrentStep(0);
      setSaveError("Please enable microphone access before completing onboarding.");
      return;
    }

    setSaveError(null);
    setStatusMessage(null);
    setIsSaving(true);

    try {
      const completedAt = new Date().toISOString();
      await persistProgress({ completed: true, completedAt, nextStep: LAST_STEP_INDEX });
      setStatusMessage("Onboarding completed.");
      onCompleted();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to complete onboarding.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="screen">
        <div className="panel status-card center-status">Loading onboarding...</div>
      </div>
    );
  }

  return (
    <div className="screen onboarding-screen">
      <div className="onboarding-shell">
        <div className="panel onboarding-card onboarding-main">
          <header className="onboarding-header">
            <p className="eyebrow">
              First-time setup
            </p>
            <h1 className="onboarding-title">Let&apos;s get you set up</h1>
            <p>
              Configure your workspace in a few steps. You can save progress and return anytime.
            </p>
            <ol className="step-pills" aria-label="Onboarding steps">
              {STEP_META.map((step, index) => (
                <li
                  key={step.key}
                  className={`step-pill ${index === currentStep ? "step-pill-active" : ""}`}
                  aria-current={index === currentStep ? "step" : undefined}
                >
                  {index + 1}. {step.title}
                </li>
              ))}
            </ol>
          </header>

          <section className="section-card onboarding-form-card">
            <div>
              <h2 className="onboarding-step-title">{activeStep.title}</h2>
              <p>{activeStep.description}</p>
            </div>

            {activeStep.key === "permissions" && (
              <PermissionStep
                data={formData.permissions}
                errors={stepErrors.permissions}
                onAssistantAccessChange={(value) => {
                  updateStepField("permissions", "assistantAccess", value);
                }}
                onScreenAccessChange={(value) => {
                  updateStepField("permissions", "screenAccess", value);
                }}
                onRequestMicrophoneAccess={requestMicrophoneAccess}
                onCheckMicrophoneStatus={checkMicrophoneStatus}
                onOpenMicrophoneSettings={openMicrophoneSettings}
                onBrowserProfileIdChange={(value) => {
                  updateStepField("permissions", "browserProfileId", value);
                }}
                browserUseApiKey={browserUseApiKey}
                onBrowserUseApiKeyChange={(value) => {
                  setBrowserUseApiKey(value);
                }}
                onStartAutomaticBrowserProfileSync={startAutomaticBrowserProfileSync}
                runningAutomaticSync={isRunningAutomaticSync}
                onOpenBrowserUseSettings={openBrowserUseSettings}
                onCopyBrowserProfileSyncCommand={copyBrowserProfileSyncCommand}
                onOpenBrowserProfileSyncGuide={openBrowserProfileSyncGuide}
                onValidateBrowserProfileId={validateBrowserProfileId}
                checkingBrowserProfile={isCheckingBrowserProfile}
                browserProfileConnected={browserProfileConnected}
                checkingStatus={isCheckingPermission}
              />
            )}

            {activeStep.key === "account" && (
              <AccountStep
                data={formData.account}
                errors={stepErrors.account}
                onDisplayNameChange={(value) => {
                  updateStepField("account", "displayName", value);
                }}
                onWorkspaceNameChange={(value) => {
                  updateStepField("account", "workspaceName", value);
                }}
              />
            )}

            {activeStep.key === "workflow" && (
              <WorkflowStep
                data={formData.workflow}
                errors={stepErrors.workflow}
                onPrimaryGoalChange={(value) => {
                  updateStepField("workflow", "primaryGoal", value);
                }}
                onUseCasesChange={(value) => {
                  updateStepField("workflow", "useCases", value);
                }}
              />
            )}

            {activeStep.key === "preferences" && (
              <PreferencesStep
                data={formData.preferences}
                errors={stepErrors.preferences}
                onShortcutBehaviorChange={(value) => {
                  updateStepField("preferences", "shortcutBehavior", value);
                }}
                onNotesChange={(value) => {
                  updateStepField("preferences", "notes", value);
                }}
              />
            )}
          </section>

          {statusMessage && <p className="alert alert-info">{statusMessage}</p>}
          {saveError && <p className="alert alert-danger">{saveError}</p>}

          <footer className="footer-actions">
            <div className="action-group">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 0 || isSaving}
                className="button button-secondary"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSaveProgress();
                }}
                disabled={isSaving}
                className="button button-secondary"
              >
                Save progress
              </button>
            </div>

            <div className="action-group">
              <button
                type="button"
                onClick={() => {
                  void signOut();
                }}
                disabled={isSaving}
                className="button button-secondary"
              >
                Sign out
              </button>

              {currentStep < LAST_STEP_INDEX ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleNext();
                  }}
                  disabled={isSaving}
                  className="button button-primary"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void handleComplete();
                  }}
                  disabled={isSaving}
                  className="button button-primary"
                >
                  Complete onboarding
                </button>
              )}
            </div>
          </footer>
        </div>

        <aside className="onboarding-visual" aria-label="Permission guidance preview">
          <div className="permission-dialog">
            <p className="permission-title">Enable system access for the best Murmur experience.</p>
            <p className="permission-copy">
              {permissionProgressCount}/4 setup checks complete. Confirm microphone and browser profile access so voice commands work reliably.
            </p>
            <div className="permission-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  void openMicrophoneSettings();
                }}
              >
                Open System Settings
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  void requestMicrophoneAccess();
                }}
              >
                Allow Microphone
              </button>
            </div>
          </div>

          <div className="system-preview">
            <div className="system-header">Accessibility</div>
            <div className={`system-row ${assistantEnabled ? "system-row-active" : ""}`}>
              <span>Assistant</span>
              <span className={`system-toggle ${assistantEnabled ? "system-toggle-on" : ""}`} />
            </div>
            <div className={`system-row ${microphoneReady ? "system-row-active" : ""}`}>
              <span>Microphone</span>
              <span className={`system-toggle ${microphoneReady ? "system-toggle-on" : ""}`} />
            </div>
            <div className={`system-row ${screenEnabled ? "system-row-active" : ""}`}>
              <span>Screen context</span>
              <span className={`system-toggle ${screenEnabled ? "system-toggle-on" : ""}`} />
            </div>
            <div className={`system-row ${browserProfileConnected ? "system-row-active" : ""}`}>
              <span>Browser profile</span>
              <span className={`system-toggle ${browserProfileConnected ? "system-toggle-on" : ""}`} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
