// ── Turn state ──────────────────────────────────────────────
export type TurnState = "idle" | "listening" | "thinking" | "acting" | "speaking";

// ── Intent result ───────────────────────────────────────────
export interface IntentResult {
  intent: "search" | "form_fill_draft" | "clarify" | "web_extract" | "multi_site_compare" | "quick_answer";
  confidence: number;
  query: string;
  clarification?: string;
  answer?: string;
}

export interface IntegrationSessionAuth {
  oauthConnected?: boolean;
  apiKeyValues?: Record<string, string>;
}

// ── Client → Server events ─────────────────────────────────
export interface StartSessionEvent {
  type: "start_session";
  userId?: string;
  profileId?: string;
  browserUseApiKey?: string;
  integrationAuth?: Record<string, IntegrationSessionAuth>;
}

export interface AudioChunkEvent {
  type: "audio_chunk";
  data: string; // base64 PCM
}

export interface AudioEndEvent {
  type: "audio_end";
}

export interface InterruptEvent {
  type: "interrupt";
}

export type ClientEvent =
  | StartSessionEvent
  | AudioChunkEvent
  | AudioEndEvent
  | InterruptEvent;

// ── Server → Client events ─────────────────────────────────
export interface SessionStartedEvent {
  type: "session_started";
  sessionId: string;
}

export interface StateEvent {
  type: "state";
  state: TurnState;
}

export interface TranscriptPartialEvent {
  type: "transcript_partial";
  text: string;
}

export interface TranscriptFinalEvent {
  type: "transcript_final";
  text: string;
}

export interface IntentEvent {
  type: "intent";
  intent: IntentResult;
}

export interface ActionStatusEvent {
  type: "action_status";
  message: string;
}

export interface NarrationTextEvent {
  type: "narration_text";
  text: string;
}

export interface NarrationAudioEvent {
  type: "narration_audio";
  audio: string; // base64 MP3
}

export interface DoneEvent {
  type: "done";
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type ServerEvent =
  | SessionStartedEvent
  | StateEvent
  | TranscriptPartialEvent
  | TranscriptFinalEvent
  | IntentEvent
  | ActionStatusEvent
  | NarrationTextEvent
  | NarrationAudioEvent
  | DoneEvent
  | ErrorEvent;
