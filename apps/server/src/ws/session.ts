import type { GoogleGenAI } from "@google/genai";
import type { ClientEvent, ServerEvent } from "@murmur/shared";
import { parseClientEvent } from "@murmur/shared";
import crypto from "node:crypto";
import type { RawData, WebSocket } from "ws";
import { env } from "../config/env.js";
import type {
  SessionPersistence,
  SessionTerminalStatus,
} from "../persistence/session-persistence.js";
import { SessionPersistenceService } from "../modules/session/session-persistence-service.js";
import type {
  SessionConnectionContext,
  SessionStatus,
} from "../modules/session/session-types.js";
import { handleTranscriptFinal } from "../orchestrator/orchestrator.js";
import { BrowserAdapter } from "../tools/browser/adapter.js";
import { SttAdapter } from "../voice/stt.js";

type SessionTurnState = Extract<ServerEvent, { type: "state" }>["state"];

const DEFAULT_CONNECTION: SessionConnectionContext = {
  ip: null,
  userAgent: null,
};

const NOOP_PERSISTENCE: SessionPersistence = {
  async startSession() {},
  async appendTranscriptFinal() {},
  async appendActionEvent() {},
  async appendNarrationText() {},
  async finishSession() {},
  async listSessions() {
    return [];
  },
  async getSessionReplay() {
    return null;
  },
};

export class Session {
  readonly id: string;
  private state: SessionTurnState = "idle";
  private ws: WebSocket;
  private ai: GoogleGenAI;
  private persistence: SessionPersistence;
  private readonly memoryPersistence: SessionPersistenceService | null;
  private readonly connection: SessionConnectionContext;
  private stt: SttAdapter | null = null;
  private accumulatedTranscript = "";
  private hasFinalizedRun = false;
  private narrationSequence = 0;
  private browserAdapter: BrowserAdapter | null = null;
  private browserProfileId: string | null = null;
  private browserUseApiKeyOverride: string | null = null;
  private hasEnded = false;
  private isPersistenceDisabled = false;

  constructor(
    ws: WebSocket,
    ai: GoogleGenAI,
    persistence?: SessionPersistence,
    connection: SessionConnectionContext = DEFAULT_CONNECTION,
    memoryPersistence: SessionPersistenceService | null = null
  ) {
    this.id = crypto.randomUUID();
    this.ws = ws;
    this.ai = ai;
    this.persistence = persistence ?? NOOP_PERSISTENCE;
    this.memoryPersistence = memoryPersistence;
    this.connection = connection;

    this.ws.on("message", (raw: RawData) => {
      this.handleMessage(normalizeRawSocketData(raw));
    });

    this.ws.on("close", () => {
      console.log(`[session:${this.id}] WebSocket closed`);
      this.finishSession("disconnected");
      this.endSession("closed");
    });

    this.ws.on("error", (err) => {
      console.error(`[session:${this.id}] WebSocket error:`, err);
      this.finishSession("errored", err instanceof Error ? err.message : "WebSocket error");
      this.endSession("error", err instanceof Error ? err.message : "WebSocket error");
    });
  }

  send(event: ServerEvent): void {
    if (event.type === "action_status") {
      this.memoryPersistence?.persistActionEvent(this.id, event.message);
    }

    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(event));
    }

    this.persistOutgoingEvent(event);

    if (event.type === "done") {
      this.finishSession("completed");
      this.endSession("completed");
      return;
    }

    if (event.type === "error") {
      this.finishSession("errored", event.message);
      this.endSession("error", event.message);
    }
  }

  setState(next: SessionTurnState): void {
    this.state = next;
    this.send({ type: "state", state: next });
  }

  getState(): SessionTurnState {
    return this.state;
  }

  setBrowserAdapter(adapter: BrowserAdapter | null): void {
    this.browserAdapter = adapter;
  }

  private handleMessage(raw: string): void {
    let event: ClientEvent;
    try {
      event = parseClientEvent(JSON.parse(raw));
    } catch (err) {
      console.error(`[session:${this.id}] Invalid event:`, err);
      this.send({ type: "error", message: "Invalid event payload" });
      return;
    }

    switch (event.type) {
      case "start_session":
        this.onStartSession(event.profileId, event.browserUseApiKey);
        break;
      case "audio_chunk":
        void this.onAudioChunk(event.data);
        break;
      case "audio_end":
        void this.onAudioEnd();
        break;
      case "interrupt":
        this.onInterrupt();
        break;
    }
  }

  private onStartSession(profileId?: string, browserUseApiKey?: string): void {
    console.log(`[session:${this.id}] Session started`);
    this.audioChunkCount = 0;
    this.hasFinalizedRun = false;
    this.narrationSequence = 0;
    this.browserProfileId = normalizeProfileId(profileId);
    this.browserUseApiKeyOverride = normalizeBrowserUseApiKey(browserUseApiKey);

    this.persistNonBlocking(
      this.persistence.startSession({ sessionId: this.id }),
      "start session"
    );
    this.memoryPersistence?.startSession(this.id, this.connection);

    this.send({ type: "session_started", sessionId: this.id });
    this.setState("listening");
  }

  private audioChunkCount = 0;

  private async onAudioChunk(data: string): Promise<void> {
    this.audioChunkCount++;
    if (this.audioChunkCount % 10 === 1) {
      console.log(`[session:${this.id}] Audio chunk #${this.audioChunkCount} (len=${data.length}, state=${this.state})`);
    }
    if (this.state === "idle") {
      this.setState("listening");
    }

    if (!this.stt) {
      this.accumulatedTranscript = "";
      this.stt = new SttAdapter(env.ELEVEN_LABS_API_KEY, {
        onPartial: (text) => {
          this.send({ type: "transcript_partial", text });
        },
        onFinal: (text) => {
          this.accumulatedTranscript = text;
          this.memoryPersistence?.persistTranscript(this.id, text);
          this.send({ type: "transcript_final", text });
        },
        onError: (error) => {
          console.error(`[session:${this.id}] STT error:`, error);
          this.send({ type: "error", message: "Speech recognition error" });
        },
      });
      await this.stt.connect();
    }

    this.stt.sendAudio(data);
  }

  private async onAudioEnd(): Promise<void> {
    console.log(`[session:${this.id}] Audio stream ended`);

    if (this.stt) {
      await this.stt.closeGracefully();
      this.stt = null;
    }

    const transcript = this.accumulatedTranscript.trim();
    console.log(`[session:${this.id}] Transcript: "${transcript}" (state: ${this.state})`);
    if (transcript) {
      await handleTranscriptFinal(
        this,
        this.ai,
        env.ELEVEN_LABS_API_KEY,
        transcript,
        env.NAVIGATION_ALLOWLIST,
        {
          createBrowserAdapter: () =>
            new BrowserAdapter(
              this.browserUseApiKeyOverride ?? env.BROWSER_USE_API_KEY,
              {
              profileId: this.browserProfileId,
              }
            ),
        }
      );
    } else {
      this.setState("idle");
    }
  }

  private onInterrupt(): void {
    console.log(`[session:${this.id}] Interrupted`);
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }

    if (this.browserAdapter) {
      void this.browserAdapter.cancel();
      this.browserAdapter = null;
    }

    this.finishSession("interrupted");
    this.endSession("interrupted");
    this.setState("idle");
  }

  private persistOutgoingEvent(event: ServerEvent): void {
    switch (event.type) {
      case "transcript_final":
        this.persistNonBlocking(
          this.persistence.appendTranscriptFinal({
            sessionId: this.id,
            text: event.text,
          }),
          "append transcript final"
        );
        break;
      case "action_status":
        this.persistNonBlocking(
          this.persistence.appendActionEvent({
            sessionId: this.id,
            status: "running",
            step: event.message,
          }),
          "append action status"
        );
        break;
      case "narration_text": {
        const sequence = this.narrationSequence;
        this.narrationSequence += 1;
        this.persistNonBlocking(
          this.persistence.appendNarrationText({
            sessionId: this.id,
            text: event.text,
            sequence,
          }),
          "append narration text"
        );
        break;
      }
      default:
        break;
    }
  }

  private finishSession(status: SessionTerminalStatus, errorMessage?: string): void {
    if (this.hasFinalizedRun) {
      return;
    }

    this.hasFinalizedRun = true;
    this.persistNonBlocking(
      this.persistence.finishSession({
        sessionId: this.id,
        status,
        errorMessage,
      }),
      `finish session as ${status}`
    );
  }

  private persistNonBlocking(task: Promise<void>, operation: string): void {
    void task.catch((error) => {
      if (isSupabaseMissingTableError(error)) {
        this.disablePersistence();
        console.warn(
          `[session:${this.id}] Disabling Supabase persistence for this session because required tables are missing.`
        );
        return;
      }

      console.error(`[session:${this.id}] Failed to ${operation}:`, error);
    });
  }

  private disablePersistence(): void {
    if (this.isPersistenceDisabled) {
      return;
    }

    this.isPersistenceDisabled = true;
    this.persistence = NOOP_PERSISTENCE;
  }

  private endSession(
    status: Exclude<SessionStatus, "active">,
    errorMessage: string | null = null
  ): void {
    if (this.hasEnded) {
      return;
    }

    this.hasEnded = true;
    this.memoryPersistence?.endSession(this.id, status, errorMessage);
  }
}

function normalizeRawSocketData(raw: RawData): string {
  if (typeof raw === "string") {
    return raw;
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf-8");
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf-8");
  }

  return raw.toString("utf-8");
}

function isSupabaseMissingTableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("PGRST205") ||
    error.message.includes("Could not find the table")
  );
}

function normalizeProfileId(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function normalizeBrowserUseApiKey(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!/^bu_[A-Za-z0-9_-]{8,}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}
