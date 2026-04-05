export type MicrophoneAccessStatus =
  | "granted"
  | "denied"
  | "not-determined"
  | "restricted"
  | "unknown"
  | "unsupported";

export type StepKey = "permissions" | "account" | "workflow" | "preferences";

export type OnboardingFormData = {
  permissions: {
    assistantAccess: "granted" | "pending";
    microphoneAccess: MicrophoneAccessStatus;
    screenAccess: "granted" | "pending";
  };
  account: {
    displayName: string;
    workspaceName: string;
  };
  workflow: {
    primaryGoal: string;
    useCases: string;
  };
  preferences: {
    shortcutBehavior: string;
    notes: string;
  };
};

export type OnboardingPayload = {
  schemaVersion: number;
  currentStep: number;
  steps: OnboardingFormData;
};

export type StepErrors = Record<string, string>;

type FieldValidator = (value: string) => string | null;

type StepSchema<TFields extends Record<string, string>> = {
  [K in keyof TFields]: FieldValidator[];
};

const REQUIRED_MESSAGE = "This field is required.";

function required(value: string): string | null {
  if (value.trim().length === 0) {
    return REQUIRED_MESSAGE;
  }

  return null;
}

function minLength(min: number, message: string): FieldValidator {
  return (value) => (value.trim().length < min ? message : null);
}

function maxLength(max: number, message: string): FieldValidator {
  return (value) => (value.trim().length > max ? message : null);
}

const SCHEMA: {
  permissions: StepSchema<OnboardingFormData["permissions"]>;
  account: StepSchema<OnboardingFormData["account"]>;
  workflow: StepSchema<OnboardingFormData["workflow"]>;
  preferences: StepSchema<OnboardingFormData["preferences"]>;
} = {
  permissions: {
    assistantAccess: [],
    microphoneAccess: [
      (value) =>
        value === "granted" || value === "unsupported"
          ? null
          : "Please enable microphone access to continue.",
    ],
    screenAccess: [],
  },
  account: {
    displayName: [required, maxLength(80, "Display name must be 80 characters or fewer.")],
    workspaceName: [required, maxLength(120, "Workspace name must be 120 characters or fewer.")],
  },
  workflow: {
    primaryGoal: [required, minLength(10, "Please add at least 10 characters.")],
    useCases: [required, minLength(10, "Please add at least 10 characters.")],
  },
  preferences: {
    shortcutBehavior: [required, maxLength(120, "Shortcut preference must be 120 characters or fewer.")],
    notes: [maxLength(400, "Notes must be 400 characters or fewer.")],
  },
};

export const STEP_ORDER: StepKey[] = ["permissions", "account", "workflow", "preferences"];

export function createDefaultOnboardingData(): OnboardingFormData {
  return {
    permissions: {
      assistantAccess: "pending",
      microphoneAccess: "not-determined",
      screenAccess: "pending",
    },
    account: {
      displayName: "",
      workspaceName: "",
    },
    workflow: {
      primaryGoal: "",
      useCases: "",
    },
    preferences: {
      shortcutBehavior: "",
      notes: "",
    },
  };
}

export function mergePersistedOnboardingData(raw: unknown): OnboardingFormData {
  const defaults = createDefaultOnboardingData();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const payload = raw as Partial<OnboardingPayload>;
  const steps = payload.steps;
  if (!steps || typeof steps !== "object") {
    return defaults;
  }

  const account = steps.account ?? {};
  const workflow = steps.workflow ?? {};
  const preferences = steps.preferences ?? {};
  const permissions = steps.permissions ?? {};

  const persistedMicrophoneAccess =
    typeof permissions.microphoneAccess === "string" ? permissions.microphoneAccess : "not-determined";

  const microphoneAccess: MicrophoneAccessStatus =
    persistedMicrophoneAccess === "granted" ||
    persistedMicrophoneAccess === "denied" ||
    persistedMicrophoneAccess === "not-determined" ||
    persistedMicrophoneAccess === "restricted" ||
    persistedMicrophoneAccess === "unknown" ||
    persistedMicrophoneAccess === "unsupported"
      ? persistedMicrophoneAccess
      : "not-determined";

  return {
    permissions: {
      assistantAccess:
        permissions.assistantAccess === "granted" ? "granted" : defaults.permissions.assistantAccess,
      microphoneAccess,
      screenAccess: permissions.screenAccess === "granted" ? "granted" : defaults.permissions.screenAccess,
    },
    account: {
      displayName: typeof account.displayName === "string" ? account.displayName : defaults.account.displayName,
      workspaceName: typeof account.workspaceName === "string" ? account.workspaceName : defaults.account.workspaceName,
    },
    workflow: {
      primaryGoal: typeof workflow.primaryGoal === "string" ? workflow.primaryGoal : defaults.workflow.primaryGoal,
      useCases: typeof workflow.useCases === "string" ? workflow.useCases : defaults.workflow.useCases,
    },
    preferences: {
      shortcutBehavior:
        typeof preferences.shortcutBehavior === "string"
          ? preferences.shortcutBehavior
          : defaults.preferences.shortcutBehavior,
      notes: typeof preferences.notes === "string" ? preferences.notes : defaults.preferences.notes,
    },
  };
}

export function deriveCurrentStep(raw: unknown): number {
  if (!raw || typeof raw !== "object") {
    return 0;
  }

  const payload = raw as Partial<OnboardingPayload>;
  const schemaVersion = payload.schemaVersion;
  const currentStep = payload.currentStep;
  if (typeof currentStep !== "number" || Number.isNaN(currentStep)) {
    return 0;
  }

  const migratedStep = schemaVersion === 1 ? currentStep + 1 : currentStep;

  if (migratedStep < 0) {
    return 0;
  }

  if (migratedStep >= STEP_ORDER.length) {
    return STEP_ORDER.length - 1;
  }

  return Math.floor(migratedStep);
}

export function validateStep(step: StepKey, data: OnboardingFormData): StepErrors {
  const validators = SCHEMA[step];
  const values = data[step] as Record<string, string>;
  const nextErrors: StepErrors = {};

  Object.entries(validators).forEach(([field, fieldValidators]) => {
    const value = values[field] ?? "";
    const message = fieldValidators.map((validator) => validator(value)).find((result) => result !== null);
    if (message) {
      nextErrors[field] = message;
    }
  });

  return nextErrors;
}

export function createPayload(currentStep: number, data: OnboardingFormData): OnboardingPayload {
  return {
    schemaVersion: 2,
    currentStep,
    steps: data,
  };
}
