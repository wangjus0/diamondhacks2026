export type MicrophoneAccessStatus =
  | "granted"
  | "denied"
  | "not-determined"
  | "restricted"
  | "unknown"
  | "unsupported";

export type ProfileCustomField = {
  key: string;
  value: string;
};

export type StepKey = "permissions" | "account" | "profile" | "workflow" | "preferences";

export type OnboardingFormData = {
  permissions: {
    assistantAccess: "granted" | "pending";
    microphoneAccess: MicrophoneAccessStatus;
    screenAccess: "granted" | "pending";
    browserProfileId: string;
  };
  account: {
    displayName: string;
    workspaceName: string;
  };
  profile: {
    fullName: string;
    dateOfBirth: string;
    major: string;
    occupation: string;
    graduationYear: string;
    zipCode: string;
    phoneNumber: string;
    customFields: ProfileCustomField[];
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

const REQUIRED_MESSAGE = "This field is required.";

function required(value: string): string | null {
  if (value.trim().length === 0) {
    return REQUIRED_MESSAGE;
  }

  return null;
}

function maxLength(max: number, message: string): FieldValidator {
  return (value) => (value.trim().length > max ? message : null);
}

function optionalUsDate(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) {
    return "Use mm/dd/yyyy format.";
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12) {
    return "Enter a valid date.";
  }

  const maxDay = new Date(year, month, 0).getDate();
  if (day < 1 || day > maxDay) {
    return "Enter a valid date.";
  }

  return null;
}

function normalizeDateOfBirthValue(value: string): string {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!isoMatch) {
    return value;
  }

  const year = isoMatch[1];
  const month = isoMatch[2];
  const day = isoMatch[3];
  return `${month}/${day}/${year}`;
}

function optionalGraduationMonthYear(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = /^(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) {
    return "Use mm/yyyy format.";
  }

  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) {
    return "Enter a valid month.";
  }

  if (year < 1900 || year > 2100) {
    return "Enter a year between 1900 and 2100.";
  }

  return null;
}

function normalizeGraduationValue(value: string): string {
  const trimmed = value.trim();
  const yearOnlyMatch = /^(\d{4})$/.exec(trimmed);
  if (yearOnlyMatch) {
    return `01/${yearOnlyMatch[1]}`;
  }

  const isoMonthMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (isoMonthMatch) {
    return `${isoMonthMatch[2]}/${isoMonthMatch[1]}`;
  }

  return value;
}

function optionalZipCode(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!/^\d{5}(?:-\d{4})?$/.test(trimmed)) {
    return "Use a valid ZIP code (12345 or 12345-6789).";
  }

  return null;
}

function optionalPhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!/^\(\d{3}\)-\d{3}-\d{4}$/.test(trimmed)) {
    return "Use format (xxx)-xxx-xxxx.";
  }

  return null;
}

const SCHEMA: Record<StepKey, Record<string, FieldValidator[]>> = {
  permissions: {
    assistantAccess: [],
    microphoneAccess: [
      (value) =>
        value === "granted" || value === "unsupported"
          ? null
          : "Please enable microphone access to continue.",
    ],
    screenAccess: [],
    browserProfileId: [
      (value) =>
        value.trim().length === 0 ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value.trim()
        )
          ? null
          : "Enter a valid Browser Use profile ID (UUID).",
    ],
  },
  account: {
    displayName: [required, maxLength(80, "Display name must be 80 characters or fewer.")],
    workspaceName: [maxLength(120, "Workspace name must be 120 characters or fewer.")],
  },
  profile: {
    fullName: [maxLength(120, "Name must be 120 characters or fewer.")],
    dateOfBirth: [optionalUsDate],
    major: [maxLength(120, "Major must be 120 characters or fewer.")],
    occupation: [maxLength(160, "Occupation must be 160 characters or fewer.")],
    graduationYear: [optionalGraduationMonthYear],
    zipCode: [optionalZipCode],
    phoneNumber: [optionalPhoneNumber],
  },
  workflow: {
    primaryGoal: [maxLength(240, "Primary goal must be 240 characters or fewer.")],
    useCases: [maxLength(240, "Use cases must be 240 characters or fewer.")],
  },
  preferences: {
    shortcutBehavior: [required, maxLength(120, "Shortcut preference must be 120 characters or fewer.")],
    notes: [maxLength(400, "Notes must be 400 characters or fewer.")],
  },
};

export const STEP_ORDER: StepKey[] = ["account", "profile", "permissions"];

export function createDefaultOnboardingData(): OnboardingFormData {
  return {
    permissions: {
      assistantAccess: "pending",
      microphoneAccess: "not-determined",
      screenAccess: "pending",
      browserProfileId: "",
    },
    account: {
      displayName: "",
      workspaceName: "",
    },
    profile: {
      fullName: "",
      dateOfBirth: "",
      major: "",
      occupation: "",
      graduationYear: "",
      zipCode: "",
      phoneNumber: "",
      customFields: [],
    },
    workflow: {
      primaryGoal: "",
      useCases: "",
    },
    preferences: {
      shortcutBehavior: "Cmd+Shift+Space",
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
  const profile = steps.profile ?? {};
  const persistedShortcutBehavior =
    typeof preferences.shortcutBehavior === "string" && preferences.shortcutBehavior.trim().length > 0
      ? preferences.shortcutBehavior
      : defaults.preferences.shortcutBehavior;

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
      browserProfileId:
        typeof permissions.browserProfileId === "string"
          ? permissions.browserProfileId
          : defaults.permissions.browserProfileId,
    },
    account: {
      displayName: typeof account.displayName === "string" ? account.displayName : defaults.account.displayName,
      workspaceName: typeof account.workspaceName === "string" ? account.workspaceName : defaults.account.workspaceName,
    },
    profile: {
      fullName: typeof profile.fullName === "string" ? profile.fullName : defaults.profile.fullName,
      dateOfBirth:
        typeof profile.dateOfBirth === "string"
          ? normalizeDateOfBirthValue(profile.dateOfBirth)
          : defaults.profile.dateOfBirth,
      major: typeof profile.major === "string" ? profile.major : defaults.profile.major,
      occupation:
        typeof profile.occupation === "string" ? profile.occupation : defaults.profile.occupation,
      graduationYear:
        typeof profile.graduationYear === "string"
          ? normalizeGraduationValue(profile.graduationYear)
          : defaults.profile.graduationYear,
      zipCode: typeof profile.zipCode === "string" ? profile.zipCode : defaults.profile.zipCode,
      phoneNumber:
        typeof profile.phoneNumber === "string"
          ? profile.phoneNumber
          : defaults.profile.phoneNumber,
      customFields: Array.isArray(profile.customFields)
        ? profile.customFields
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return null;
              }

              const candidate = entry as { key?: unknown; value?: unknown };
              const key = typeof candidate.key === "string" ? candidate.key : "";
              const value = typeof candidate.value === "string" ? candidate.value : "";
              if (key.trim().length === 0 && value.trim().length === 0) {
                return null;
              }

              return { key, value };
            })
            .filter((entry): entry is ProfileCustomField => entry !== null)
        : defaults.profile.customFields,
    },
    workflow: {
      primaryGoal: typeof workflow.primaryGoal === "string" ? workflow.primaryGoal : defaults.workflow.primaryGoal,
      useCases: typeof workflow.useCases === "string" ? workflow.useCases : defaults.workflow.useCases,
    },
    preferences: {
      shortcutBehavior: persistedShortcutBehavior,
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
  const values = data[step] as Record<string, unknown>;
  const nextErrors: StepErrors = {};

  Object.entries(validators).forEach(([field, fieldValidators]) => {
    const raw = values[field];
    const value = typeof raw === "string" ? raw : "";
    const message = fieldValidators.map((validator) => validator(value)).find((result) => result !== null);
    if (message) {
      nextErrors[field] = message;
    }
  });

  return nextErrors;
}

export function createPayload(currentStep: number, data: OnboardingFormData): OnboardingPayload {
  return {
    schemaVersion: 4,
    currentStep,
    steps: data,
  };
}

export function buildProfileCustomFieldsRecord(customFields: ProfileCustomField[]): Record<string, string> {
  const entries = customFields
    .map((entry) => ({
      key: entry.key.trim(),
      value: entry.value.trim(),
    }))
    .filter((entry) => entry.key.length > 0 && entry.value.length > 0);

  return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
}

function profileLine(label: string, value: string): string {
  return `- ${label}: ${value.trim().length > 0 ? value.trim() : "Not provided"}`;
}

export function buildProfileMarkdown(data: OnboardingFormData, email?: string | null): string {
  const profileName =
    data.profile.fullName.trim().length > 0
      ? data.profile.fullName.trim()
      : data.account.displayName.trim();

  const customFields = buildProfileCustomFieldsRecord(data.profile.customFields);
  const customFieldLines = Object.entries(customFields).map(([key, value]) => `- ${key}: ${value}`);

  const lines: string[] = [
    "# Profile",
    "",
    "## Basics",
    profileLine("Name", profileName),
    profileLine("Email", email ?? ""),
    profileLine("Date of birth", data.profile.dateOfBirth),
    profileLine("Major", data.profile.major),
    profileLine("Occupation", data.profile.occupation),
    profileLine("Graduation", data.profile.graduationYear),
    profileLine("ZIP code", data.profile.zipCode),
    profileLine("Phone number", data.profile.phoneNumber),
  ];

  if (customFieldLines.length > 0) {
    lines.push("", "## Custom Fields", ...customFieldLines);
  }

  return lines.join("\n");
}
