const BASE_URL = "https://api.browser-use.com/api/v2";
const POLL_INTERVAL_MS = 2000;
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTEGRATION_NAME_PATTERN = /^[\w .:@/-]{1,80}$/;
const INTEGRATION_FIELD_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

const KNOWN_INTEGRATION_DOMAINS: Record<string, readonly string[]> = {
  airtable: ["airtable.com"],
  asana: ["asana.com"],
  calendly: ["calendly.com"],
  clickup: ["clickup.com"],
  discord: ["discord.com"],
  dropbox: ["dropbox.com"],
  figma: ["figma.com"],
  github: ["github.com"],
  gmail: ["mail.google.com", "google.com"],
  "google ads": ["ads.google.com", "google.com"],
  "google calendar": ["calendar.google.com", "google.com"],
  "google docs": ["docs.google.com", "google.com"],
  "google drive": ["drive.google.com", "google.com"],
  "google forms": ["docs.google.com", "google.com"],
  "google meet": ["meet.google.com", "google.com"],
  "google sheets": ["sheets.google.com", "google.com"],
  "google slides": ["slides.google.com", "google.com"],
  hubspot: ["hubspot.com"],
  jira: ["atlassian.net"],
  linear: ["linear.app"],
  notion: ["notion.so"],
  outlook: ["outlook.office.com", "microsoft.com"],
  pipedrive: ["pipedrive.com"],
  salesforce: ["salesforce.com"],
  slack: ["slack.com"],
  stripe: ["stripe.com"],
  trello: ["trello.com"],
};

export interface BrowserTaskCallbacks {
  onStatus: (message: string) => void;
}

export interface BrowserTaskExecutor {
  runSearch(
    query: string,
    callbacks: BrowserTaskCallbacks
  ): Promise<string>;
  runFormFillDraft(
    query: string,
    callbacks: BrowserTaskCallbacks,
    options?: { allowSubmit?: boolean }
  ): Promise<string>;
  cancel(): Promise<void>;
}

export type IntegrationAuthPayload = Record<
  string,
  {
    oauthConnected?: boolean;
    apiKeyValues?: Record<string, string>;
  }
>;

type BrowserUseDomainSecrets = Record<string, Record<string, string>>;

interface BrowserAdapterOptions {
  profileId?: string | null;
  integrationAuth?: IntegrationAuthPayload | null;
}

export class BrowserAdapter implements BrowserTaskExecutor {
  private readonly apiKey: string;
  private readonly profileId: string | null;
  private readonly integrationAuth: IntegrationAuthPayload;
  private readonly domainScopedSecrets: BrowserUseDomainSecrets;
  private currentTaskId: string | null = null;
  private currentSessionId: string | null = null;
  private cancelled = false;

  constructor(apiKey: string, options?: BrowserAdapterOptions) {
    this.apiKey = apiKey;
    this.profileId = normalizeProfileId(options?.profileId);
    this.integrationAuth = normalizeIntegrationAuth(options?.integrationAuth);
    this.domainScopedSecrets = buildDomainScopedSecretsFromNormalized(this.integrationAuth);
  }

  async runSearch(
    query: string,
    callbacks: BrowserTaskCallbacks
  ): Promise<string> {
    return this.runTask(buildSearchTaskPrompt(query), callbacks);
  }

  async runFormFillDraft(
    query: string,
    callbacks: BrowserTaskCallbacks,
    options?: { allowSubmit?: boolean }
  ): Promise<string> {
    return this.runTask(
      buildFormFillDraftTaskPrompt(query, { allowSubmit: options?.allowSubmit ?? false }),
      callbacks
    );
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (!this.currentSessionId) {
      return;
    }

    try {
      const response = await fetch(`${BASE_URL}/sessions/${this.currentSessionId}`, {
        method: "PATCH",
        headers: {
          "X-Browser-Use-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      });
      if (!response.ok) {
        console.error("[Browser] Failed to cancel session:", response.status);
      }
    } catch (error) {
      console.error("[Browser] Cancel error:", error);
    }
  }

  async runTask(
    task: string,
    callbacks: BrowserTaskCallbacks
  ): Promise<string> {
    this.cancelled = false;
    callbacks.onStatus("Creating browser task...");

    if (Object.keys(this.integrationAuth).length > 0) {
      callbacks.onStatus(
        `Loaded ${Object.keys(this.integrationAuth).length} integration credential set(s).`
      );
    }

    if (Object.keys(this.domainScopedSecrets).length > 0) {
      callbacks.onStatus(
        `Prepared ${Object.keys(this.domainScopedSecrets).length} Browser Use secret domain bundle(s).`
      );
    }

    const reusableSessionId = await this.ensureSessionIdForProfile(callbacks);
    const created = await this.createTask(task, reusableSessionId);

    this.currentTaskId = created.id;
    this.currentSessionId = created.sessionId ?? reusableSessionId;
    callbacks.onStatus("Browser task started, working...");

    let lastStepCount = 0;
    while (!this.cancelled) {
      await sleep(POLL_INTERVAL_MS);

      const pollResponse = await fetch(`${BASE_URL}/tasks/${this.currentTaskId}`, {
        headers: { "X-Browser-Use-API-Key": this.apiKey },
      });
      if (!pollResponse.ok) {
        throw new Error(`Poll failed (${pollResponse.status})`);
      }

      const taskData = (await pollResponse.json()) as {
        status: string;
        output?: string | null;
        steps?: Array<{
          number: number;
          url?: string;
          actions?: string[];
        }>;
      };

      const steps = taskData.steps ?? [];
      if (steps.length > lastStepCount) {
        for (let index = lastStepCount; index < steps.length; index += 1) {
          const step = steps[index];
          let description = `Step ${step.number}`;
          if (step.actions?.length) {
            try {
              const action = JSON.parse(step.actions[0]);
              const actionType = Object.keys(action)[0];
              description += `: ${actionType}`;
              if (step.url) {
                description += ` (${new URL(step.url).hostname})`;
              }
            } catch {
              description += step.url ? ` on ${new URL(step.url).hostname}` : "";
            }
          }
          callbacks.onStatus(description);
        }
        lastStepCount = steps.length;
      }

      if (taskData.status === "finished") {
        this.currentTaskId = null;
        this.currentSessionId = null;
        return taskData.output ?? "Task completed but no output was returned.";
      }

      if (taskData.status === "failed" || taskData.status === "stopped") {
        this.currentTaskId = null;
        this.currentSessionId = null;
        return taskData.output ?? `Task ${taskData.status}.`;
      }
    }

    this.currentTaskId = null;
    this.currentSessionId = null;
    return "Task was interrupted.";
  }

  private async ensureSessionIdForProfile(
    callbacks: BrowserTaskCallbacks
  ): Promise<string | null> {
    if (!this.profileId) {
      return null;
    }

    if (this.currentSessionId) {
      return this.currentSessionId;
    }

    callbacks.onStatus("Starting browser profile session...");

    const payloads: BrowserSessionCreateBody[] = [
      { profile_id: this.profileId },
      { profileId: this.profileId },
    ];
    const errors: string[] = [];

    for (const payload of payloads) {
      const response = await fetch(`${BASE_URL}/sessions`, {
        method: "POST",
        headers: {
          "X-Browser-Use-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        errors.push(`HTTP ${response.status}: ${await readErrorDetails(response)}`);
        continue;
      }

      const created = (await response.json()) as SessionCreateResponse;
      const sessionId = created.id ?? created.sessionId ?? created.session_id;
      if (!sessionId) {
        errors.push("Missing session id in create-session response.");
        continue;
      }

      this.currentSessionId = sessionId;
      return sessionId;
    }

    throw new Error(
      `Failed to create Browser Use session for profile ${this.profileId}. ${errors.join(" | ")}`
    );
  }

  private async createTask(
    task: string,
    sessionId: string | null
  ): Promise<{ id: string; sessionId?: string }> {
    const basePayloads: BrowserTaskCreateBody[] = sessionId
      ? [
          { task, session_id: sessionId },
          { task, sessionId },
        ]
      : [{ task }];
    const payloads = buildTaskPayloadVariants(
      basePayloads,
      this.integrationAuth,
      this.domainScopedSecrets
    );
    const errors: string[] = [];

    for (const payload of payloads) {
      const response = await fetch(`${BASE_URL}/tasks`, {
        method: "POST",
        headers: {
          "X-Browser-Use-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        errors.push(`HTTP ${response.status}: ${await readErrorDetails(response)}`);
        continue;
      }

      const created = (await response.json()) as TaskCreateResponse;
      const taskId = created.id;
      if (!taskId) {
        errors.push("Missing task id in create-task response.");
        continue;
      }

      return {
        id: taskId,
        sessionId: created.sessionId ?? created.session_id ?? sessionId ?? undefined,
      };
    }

    throw new Error(`Browser Use API task creation failed. ${errors.join(" | ")}`);
  }
}

export { BrowserAdapter as BrowserUseAdapter };

type TaskCreateResponse = {
  id: string;
  sessionId?: string;
  session_id?: string;
};

interface SessionCreateResponse {
  id?: string;
  sessionId?: string;
  session_id?: string;
}

interface BrowserSessionCreateBody {
  profileId?: string;
  profile_id?: string;
}

interface BrowserTaskCreateBody {
  task: string;
  sessionId?: string;
  session_id?: string;
  secrets?: BrowserUseDomainSecrets;
  integration_auth?: IntegrationAuthPayload;
  integrations?: string[];
}

function normalizeProfileId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!PROFILE_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function normalizeIntegrationAuth(
  raw: IntegrationAuthPayload | null | undefined
): IntegrationAuthPayload {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const entries: Array<[string, IntegrationAuthPayload[string]]> = [];
  for (const [integrationName, entry] of Object.entries(raw)) {
    if (entries.length >= 256 || !entry || typeof entry !== "object") {
      continue;
    }

    const normalizedName = integrationName.trim();
    if (!INTEGRATION_NAME_PATTERN.test(normalizedName)) {
      continue;
    }

    const oauthConnected = entry.oauthConnected === true;
    const apiKeyEntries: Array<[string, string]> = [];
    if (entry.apiKeyValues && typeof entry.apiKeyValues === "object") {
      for (const [fieldId, fieldValue] of Object.entries(entry.apiKeyValues)) {
        if (
          apiKeyEntries.length >= 24 ||
          typeof fieldValue !== "string" ||
          !INTEGRATION_FIELD_ID_PATTERN.test(fieldId.trim())
        ) {
          continue;
        }

        const value = fieldValue.trim().slice(0, 4096);
        if (value.length === 0) {
          continue;
        }

        apiKeyEntries.push([fieldId.trim(), value]);
      }
    }

    if (!oauthConnected && apiKeyEntries.length === 0) {
      continue;
    }

    entries.push([
      normalizedName,
      {
        ...(oauthConnected ? { oauthConnected: true } : {}),
        ...(apiKeyEntries.length > 0
          ? { apiKeyValues: Object.fromEntries(apiKeyEntries) }
          : {}),
      },
    ]);
  }

  return Object.fromEntries(entries);
}

export function buildDomainScopedSecretsForIntegrations(
  raw: IntegrationAuthPayload | null | undefined
): BrowserUseDomainSecrets {
  return buildDomainScopedSecretsFromNormalized(normalizeIntegrationAuth(raw));
}

function buildDomainScopedSecretsFromNormalized(
  integrationAuth: IntegrationAuthPayload
): BrowserUseDomainSecrets {
  const domainEntries: Array<[string, Record<string, string>]> = [];

  for (const [integrationName, entry] of Object.entries(integrationAuth)) {
    const apiKeyValues = entry.apiKeyValues ?? {};
    if (Object.keys(apiKeyValues).length === 0) {
      continue;
    }

    const domains = resolveIntegrationDomains(integrationName);
    if (domains.length === 0) {
      continue;
    }

    const integrationPrefix = toEnvToken(integrationName);
    for (const domain of domains) {
      const existing =
        domainEntries.find(([existingDomain]) => existingDomain === domain)?.[1] ?? {};

      for (const [fieldId, value] of Object.entries(apiKeyValues)) {
        const normalizedFieldId = toEnvToken(fieldId);
        existing[fieldId] = value;
        existing[normalizedFieldId] = value;
        existing[`${integrationPrefix}_${normalizedFieldId}`] = value;
      }

      if (!domainEntries.some(([existingDomain]) => existingDomain === domain)) {
        domainEntries.push([domain, existing]);
      }
    }
  }

  return Object.fromEntries(domainEntries);
}

function buildTaskPayloadVariants(
  basePayloads: BrowserTaskCreateBody[],
  integrationAuth: IntegrationAuthPayload,
  domainScopedSecrets: BrowserUseDomainSecrets
): BrowserTaskCreateBody[] {
  const hasIntegrationAuth = Object.keys(integrationAuth).length > 0;
  const hasDomainScopedSecrets = Object.keys(domainScopedSecrets).length > 0;
  const integrationNames = Object.keys(integrationAuth);
  const variants: BrowserTaskCreateBody[] = [];

  for (const basePayload of basePayloads) {
    if (hasIntegrationAuth && hasDomainScopedSecrets) {
      variants.push({
        ...basePayload,
        integration_auth: integrationAuth,
        integrations: integrationNames,
        secrets: domainScopedSecrets,
      });
    }

    if (hasDomainScopedSecrets) {
      variants.push({
        ...basePayload,
        secrets: domainScopedSecrets,
      });
    }

    if (hasIntegrationAuth) {
      variants.push({
        ...basePayload,
        integration_auth: integrationAuth,
        integrations: integrationNames,
      });
    }

    variants.push(basePayload);
  }

  const deduped = new Map<string, BrowserTaskCreateBody>();
  for (const payload of variants) {
    const key = JSON.stringify(payload);
    if (!deduped.has(key)) {
      deduped.set(key, payload);
    }
  }

  return Array.from(deduped.values());
}

function resolveIntegrationDomains(integrationName: string): string[] {
  const normalizedName = integrationName.trim().toLowerCase();
  const known = KNOWN_INTEGRATION_DOMAINS[normalizedName];
  if (known) {
    return [...known];
  }

  if (normalizedName.startsWith("google ")) {
    return ["google.com"];
  }

  if (/^[a-z0-9-]+\.[a-z]{2,}$/i.test(normalizedName)) {
    return [normalizedName];
  }

  return [];
}

function toEnvToken(raw: string): string {
  const token = raw
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return token || "KEY";
}

async function readErrorDetails(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text || "(empty response)";
  } catch {
    return "(failed to read response body)";
  }
}

export function buildSearchTaskPrompt(query: string): string {
  const goal = normalizeTaskGoal(query);
  return (
    `Goal: ${goal}. ` +
    `Use concise keyword searches. Do not paste the full user utterance verbatim into the search box. ` +
    `Open only the most relevant pages needed to satisfy the goal. ` +
    `Return a concise answer with supporting points and source URLs. ` +
    `Read-only only: do not sign in, submit forms, purchase, or checkout.`
  );
}

export function buildFormFillDraftTaskPrompt(
  query: string,
  options?: { allowSubmit?: boolean }
): string {
  if (options?.allowSubmit) {
    return (
      `Based on this request: '${query}', navigate to the appropriate website. ` +
      `Find the relevant form and fill it out with reasonable values based on the request. ` +
      `If the user explicitly asked to submit, submit the form once after fields are completed. ` +
      `Never perform payment, checkout, or purchase actions. ` +
      `Report which fields were filled and whether submission occurred.`
    );
  }

  return (
    `Based on this request: '${query}', navigate to the appropriate website. ` +
    `Find the relevant form and fill it out with reasonable values based on the request. ` +
    `Do NOT submit the form. Do NOT click any submit, pay, checkout, or confirmation buttons. ` +
    `Report which fields were filled and with what values.`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTaskGoal(query: string): string {
  return query
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ");
}
