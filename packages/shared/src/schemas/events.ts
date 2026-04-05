import { z } from "zod";
import type { ClientEvent, ServerEvent } from "../events/types.js";

// ── Turn state schema ──────────────────────────────────────
const TurnStateSchema = z.enum(["idle", "listening", "thinking", "acting", "speaking"]);

// ── Intent result schema ───────────────────────────────────
const IntentResultSchema = z.object({
  intent: z.enum(["search", "form_fill_draft", "clarify", "web_extract", "multi_site_compare", "quick_answer"]),
  confidence: z.number(),
  query: z.string(),
  clarification: z.string().optional(),
  answer: z.string().optional(),
});

const StartSessionIntegrationAuthSchema = z.object({
  oauthConnected: z.boolean().optional(),
  apiKeyValues: z.record(z.string().min(1)).optional(),
});

// ── Client → Server ────────────────────────────────────────
export const ClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start_session"),
    userId: z.string().uuid().optional(),
    profileId: z.string().uuid().optional(),
    browserUseApiKey: z.string().min(1).optional(),
    integrationAuth: z.record(StartSessionIntegrationAuthSchema).optional(),
  }),
  z.object({ type: z.literal("audio_chunk"), data: z.string() }),
  z.object({ type: z.literal("audio_end") }),
  z.object({ type: z.literal("interrupt") }),
]);

// ── Server → Client ────────────────────────────────────────
export const ServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session_started"), sessionId: z.string() }),
  z.object({ type: z.literal("state"), state: TurnStateSchema }),
  z.object({ type: z.literal("transcript_partial"), text: z.string() }),
  z.object({ type: z.literal("transcript_final"), text: z.string() }),
  z.object({ type: z.literal("intent"), intent: IntentResultSchema }),
  z.object({ type: z.literal("action_status"), message: z.string() }),
  z.object({ type: z.literal("narration_text"), text: z.string() }),
  z.object({ type: z.literal("narration_audio"), audio: z.string() }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

// ── Parse helpers ──────────────────────────────────────────
export function parseClientEvent(raw: unknown): ClientEvent {
  return ClientEventSchema.parse(raw) as ClientEvent;
}

export function parseServerEvent(raw: unknown): ServerEvent {
  return ServerEventSchema.parse(raw) as ServerEvent;
}
