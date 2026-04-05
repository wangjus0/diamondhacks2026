export type TurnState =
  | "idle"
  | "listening"
  | "thinking"
  | "acting"
  | "speaking"
  | "error";

export type IntentName = "search" | "form_fill_draft" | "clarify" | "web_extract" | "multi_site_compare";

export type ActionOutcome =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled";

export type AudioInputEncoding = "pcm16" | "webm_opus";

export type AudioOutputEncoding = "mp3" | "wav" | "pcm16";
