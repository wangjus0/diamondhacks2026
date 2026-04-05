const BASE_URL = "https://api.browser-use.com/api/v2";
const POLL_INTERVAL_MS = 2000;

export interface BrowserTaskCallbacks {
  onStatus: (message: string) => void;
}

export class BrowserAdapter {
  private apiKey: string;
  private currentTaskId: string | null = null;
  private currentSessionId: string | null = null;
  private cancelled = false;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
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

    // Create task
    const createRes = await fetch(`${BASE_URL}/tasks`, {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Browser Use API error (${createRes.status}): ${body}`);
    }

    const created = (await createRes.json()) as {
      id: string;
      sessionId: string;
    };
    this.currentTaskId = created.id;
    this.currentSessionId = created.sessionId;
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
