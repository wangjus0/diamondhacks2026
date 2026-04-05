import type {
  ActionEventInput,
  FinishSessionInput,
  NarrationTextInput,
  SessionActionEventRecord,
  SessionPersistence,
  SessionReplayRecord,
  SessionRunRecord,
  SessionNarrationEventRecord,
  SessionTranscriptRecord,
  StartSessionInput,
  TranscriptFinalInput,
} from "./session-persistence.js";

type FetchLike = typeof fetch;

interface SupabaseSessionPersistenceOptions {
  fetchImpl?: FetchLike;
}

export class SupabaseSessionPersistence implements SessionPersistence {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    options: SupabaseSessionPersistenceOptions = {}
  ) {
    this.baseUrl = supabaseUrl.replace(/\/$/, "");
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async startSession(input: StartSessionInput): Promise<void> {
    const startedAt = input.startedAt ?? nowIso();
    await this.request("POST", "session_runs", {
      searchParams: { on_conflict: "session_id" },
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        session_id: input.sessionId,
        ...(input.userId ? { user_id: input.userId } : {}),
        started_at: startedAt,
        ended_at: null,
        status: "active",
        error_message: null,
      },
    });
  }

  async appendTranscriptFinal(input: TranscriptFinalInput): Promise<void> {
    await this.request("POST", "session_transcripts", {
      prefer: "return=minimal",
      body: {
        session_id: input.sessionId,
        text: input.text,
        created_at: input.createdAt ?? nowIso(),
      },
    });
  }

  async appendActionEvent(input: ActionEventInput): Promise<void> {
    await this.request("POST", "session_action_events", {
      prefer: "return=minimal",
      body: {
        session_id: input.sessionId,
        status: input.status,
        step: input.step,
        detail: input.detail ?? null,
        created_at: input.createdAt ?? nowIso(),
      },
    });
  }

  async appendNarrationText(input: NarrationTextInput): Promise<void> {
    await this.request("POST", "session_narration_events", {
      prefer: "return=minimal",
      body: {
        session_id: input.sessionId,
        text: input.text,
        sequence: input.sequence ?? null,
        created_at: input.createdAt ?? nowIso(),
      },
    });
  }

  async finishSession(input: FinishSessionInput): Promise<void> {
    await this.request("PATCH", "session_runs", {
      searchParams: {
        session_id: `eq.${input.sessionId}`,
      },
      prefer: "return=minimal",
      body: {
        ended_at: input.endedAt ?? nowIso(),
        status: input.status,
        error_message: input.errorMessage ?? null,
      },
    });
  }

  async listSessions(limit: number): Promise<SessionRunRecord[]> {
    const response = await this.request<SessionRunRow[]>("GET", "session_runs", {
      searchParams: {
        select:
          "session_id,user_id,started_at,ended_at,status,error_message,created_at,updated_at",
        order: "started_at.desc",
        limit: `${limit}`,
      },
    });

    return response.map(mapSessionRunRow);
  }

  async getSessionReplay(sessionId: string): Promise<SessionReplayRecord | null> {
    const sessionRows = await this.request<SessionRunRow[]>("GET", "session_runs", {
      searchParams: {
        select:
          "session_id,user_id,started_at,ended_at,status,error_message,created_at,updated_at",
        session_id: `eq.${sessionId}`,
        limit: "1",
      },
    });

    const session = sessionRows[0];
    if (!session) {
      return null;
    }

    const [transcriptRows, actionRows, narrationRows] = await Promise.all([
      this.request<SessionTranscriptRow[]>("GET", "session_transcripts", {
        searchParams: {
          select: "id,session_id,text,created_at",
          session_id: `eq.${sessionId}`,
          order: "created_at.asc",
        },
      }),
      this.request<SessionActionRow[]>("GET", "session_action_events", {
        searchParams: {
          select: "id,session_id,status,step,detail,created_at",
          session_id: `eq.${sessionId}`,
          order: "created_at.asc",
        },
      }),
      this.request<SessionNarrationRow[]>("GET", "session_narration_events", {
        searchParams: {
          select: "id,session_id,text,sequence,created_at",
          session_id: `eq.${sessionId}`,
          order: "created_at.asc",
        },
      }),
    ]);

    return {
      session: mapSessionRunRow(session),
      transcripts: transcriptRows.map(mapTranscriptRow),
      actions: actionRows.map(mapActionRow),
      narration: narrationRows.map(mapNarrationRow),
    };
  }

  private async request<T = void>(
    method: "GET" | "POST" | "PATCH",
    table: string,
    options: {
      searchParams?: Record<string, string>;
      body?: unknown;
      prefer?: string;
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(options.searchParams ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      "Content-Type": "application/json",
    };

    if (options.prefer) {
      headers.Prefer = options.prefer;
    }

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Supabase request failed (${method} ${table}): ${response.status} ${body}`
      );
    }

    if (response.status === 204 || method !== "GET") {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

interface SessionRunRow {
  session_id: string;
  user_id: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionTranscriptRow {
  id: string;
  session_id: string;
  text: string;
  created_at: string;
}

interface SessionActionRow {
  id: string;
  session_id: string;
  status: string;
  step: string;
  detail: string | null;
  created_at: string;
}

interface SessionNarrationRow {
  id: string;
  session_id: string;
  text: string;
  sequence: number | null;
  created_at: string;
}

function mapSessionRunRow(row: SessionRunRow): SessionRunRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id ?? null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTranscriptRow(row: SessionTranscriptRow): SessionTranscriptRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

function mapActionRow(row: SessionActionRow): SessionActionEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    step: row.step,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function mapNarrationRow(row: SessionNarrationRow): SessionNarrationEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    sequence: row.sequence,
    createdAt: row.created_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}
