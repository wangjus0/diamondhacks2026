const BASE_URL = "https://api.browser-use.com/api/v2";
const POLL_INTERVAL_MS = 2000;
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BrowserTaskCallbacks {
  onStatus: (message: string) => void;
}

interface BrowserAdapterOptions {
  profileId?: string | null;
}

export class BrowserAdapter {
  private readonly apiKey: string;
  private readonly profileId: string | null;
  private currentTaskId: string | null = null;
  private currentSessionId: string | null = null;
  private cancelled = false;

  constructor(apiKey: string, options?: BrowserAdapterOptions) {
    this.apiKey = apiKey;
    this.profileId = normalizeProfileId(options?.profileId);
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
    if (!this.currentSessionId) return;

    try {
      const res = await fetch(
        `${BASE_URL}/sessions/${this.currentSessionId}`,
        {
          method: "PATCH",
          headers: {
            "X-Browser-Use-API-Key": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "stop" }),
        }
      );
      if (!res.ok) {
        console.error("[Browser] Failed to cancel session:", res.status);
      }
    } catch (err) {
      console.error("[Browser] Cancel error:", err);
    }
  }

  async runTask(
    task: string,
    callbacks: BrowserTaskCallbacks
  ): Promise<string> {
    this.cancelled = false;
    callbacks.onStatus("Creating browser task...");
    const reusableSessionId = await this.ensureSessionIdForProfile(callbacks);

    const created = await this.createTask(task, reusableSessionId);
    this.currentTaskId = created.id;
    this.currentSessionId = created.sessionId ?? reusableSessionId;
    callbacks.onStatus("Browser task started, working...");

    // Poll until completion
    let lastStepCount = 0;

    while (!this.cancelled) {
      await sleep(POLL_INTERVAL_MS);

      const pollRes = await fetch(`${BASE_URL}/tasks/${this.currentTaskId}`, {
        headers: { "X-Browser-Use-API-Key": this.apiKey },
      });

      if (!pollRes.ok) {
        throw new Error(`Poll failed (${pollRes.status})`);
      }

      const taskData = (await pollRes.json()) as {
        status: string;
        output?: string | null;
        isSuccess?: boolean | null;
        steps?: Array<{
          number: number;
          memory?: string;
          url?: string;
          actions?: string[];
        }>;
      };

      // Emit status for new steps
      const steps = taskData.steps ?? [];
      if (steps.length > lastStepCount) {
        for (let i = lastStepCount; i < steps.length; i++) {
          const step = steps[i];
          // Parse first action JSON to get a human-readable description
          let desc = `Step ${step.number}`;
          if (step.actions?.length) {
            try {
              const action = JSON.parse(step.actions[0]);
              const actionType = Object.keys(action)[0];
              desc += `: ${actionType}`;
              if (step.url) {
                const hostname = new URL(step.url).hostname;
                desc += ` (${hostname})`;
              }
            } catch {
              desc += step.url ? ` on ${new URL(step.url).hostname}` : "";
            }
          }
          callbacks.onStatus(desc);
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

    // If we exited due to cancellation
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
    const payloads: BrowserTaskCreateBody[] = sessionId
      ? [
          { task, session_id: sessionId },
          { task, sessionId },
        ]
      : [{ task }];
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
  return (
    `Navigate to google.com, search for '${query}', and collect the top 5 result titles and URLs. ` +
    `Return results as a numbered list with title and URL for each.`
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
