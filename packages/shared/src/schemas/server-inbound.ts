import { z } from "zod";

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_NARRATION_AUDIO_B64_LENGTH = 2_000_000;

const baseMessageShape = {
  requestId: z.string().min(1).optional(),
  timestamp: z.string().datetime().optional(),
};

const turnStateSchema = z.enum([
  "idle",
  "listening",
  "thinking",
  "acting",
  "speaking",
  "error",
]);

const intentNameSchema = z.enum(["search", "form_fill_draft", "clarify", "web_extract", "multi_site_compare"]);

const actionOutcomeSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);

export const sessionStartedPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    startedAt: z.string().datetime(),
  })
  .strict();

export const statePayloadSchema = z
  .object({
    state: turnStateSchema,
    previousState: turnStateSchema.optional(),
  })
  .strict();

export const transcriptPartialPayloadSchema = z
  .object({
    text: z.string().min(1),
    sequence: z.number().int().min(0),
  })
  .strict();

export const transcriptFinalPayloadSchema = z
  .object({
    text: z.string().min(1),
    utteranceId: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const intentPayloadSchema = z
  .object({
    intent: intentNameSchema,
    confidence: z.number().min(0).max(1),
    query: z.string().min(1),
  })
  .strict();

export const actionStatusPayloadSchema = z
  .object({
    status: actionOutcomeSchema,
    step: z.string().min(1),
    detail: z.string().optional(),
  })
  .strict();

export const narrationTextPayloadSchema = z
  .object({
    text: z.string().min(1),
    sequence: z.number().int().min(0),
  })
  .strict();

export const narrationAudioPayloadSchema = z
  .object({
    audioBase64: z
      .string()
      .min(1)
      .max(MAX_NARRATION_AUDIO_B64_LENGTH)
      .regex(BASE64_PATTERN),
    sequence: z.number().int().min(0),
    encoding: z.enum(["mp3", "wav", "pcm16"]),
    sampleRateHz: z.number().int().positive().optional(),
  })
  .strict();

export const donePayloadSchema = z
  .object({
    summary: z.string().optional(),
  })
  .strict();

export const errorPayloadSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    recoverable: z.boolean(),
  })
  .strict();

export const sessionStartedMessageSchema = z
  .object({
    type: z.literal("session_started"),
    payload: sessionStartedPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const stateMessageSchema = z
  .object({
    type: z.literal("state"),
    payload: statePayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const transcriptPartialMessageSchema = z
  .object({
    type: z.literal("transcript_partial"),
    payload: transcriptPartialPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const transcriptFinalMessageSchema = z
  .object({
    type: z.literal("transcript_final"),
    payload: transcriptFinalPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const intentMessageSchema = z
  .object({
    type: z.literal("intent"),
    payload: intentPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const actionStatusMessageSchema = z
  .object({
    type: z.literal("action_status"),
    payload: actionStatusPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const narrationTextMessageSchema = z
  .object({
    type: z.literal("narration_text"),
    payload: narrationTextPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const narrationAudioMessageSchema = z
  .object({
    type: z.literal("narration_audio"),
    payload: narrationAudioPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const doneMessageSchema = z
  .object({
    type: z.literal("done"),
    payload: donePayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const errorMessageSchema = z
  .object({
    type: z.literal("error"),
    payload: errorPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const serverToClientMessageSchema = z.discriminatedUnion("type", [
  sessionStartedMessageSchema,
  stateMessageSchema,
  transcriptPartialMessageSchema,
  transcriptFinalMessageSchema,
  intentMessageSchema,
  actionStatusMessageSchema,
  narrationTextMessageSchema,
  narrationAudioMessageSchema,
  doneMessageSchema,
  errorMessageSchema,
]);

export type SessionStartedPayloadInput = z.infer<
  typeof sessionStartedPayloadSchema
>;
export type StatePayloadInput = z.infer<typeof statePayloadSchema>;
export type TranscriptPartialPayloadInput = z.infer<
  typeof transcriptPartialPayloadSchema
>;
export type TranscriptFinalPayloadInput = z.infer<
  typeof transcriptFinalPayloadSchema
>;
export type IntentPayloadInput = z.infer<typeof intentPayloadSchema>;
export type ActionStatusPayloadInput = z.infer<typeof actionStatusPayloadSchema>;
export type NarrationTextPayloadInput = z.infer<typeof narrationTextPayloadSchema>;
export type NarrationAudioPayloadInput = z.infer<
  typeof narrationAudioPayloadSchema
>;
export type DonePayloadInput = z.infer<typeof donePayloadSchema>;
export type ErrorPayloadInput = z.infer<typeof errorPayloadSchema>;

export type SessionStartedMessageInput = z.infer<
  typeof sessionStartedMessageSchema
>;
export type StateMessageInput = z.infer<typeof stateMessageSchema>;
export type TranscriptPartialMessageInput = z.infer<
  typeof transcriptPartialMessageSchema
>;
export type TranscriptFinalMessageInput = z.infer<
  typeof transcriptFinalMessageSchema
>;
export type IntentMessageInput = z.infer<typeof intentMessageSchema>;
export type ActionStatusMessageInput = z.infer<typeof actionStatusMessageSchema>;
export type NarrationTextMessageInput = z.infer<typeof narrationTextMessageSchema>;
export type NarrationAudioMessageInput = z.infer<
  typeof narrationAudioMessageSchema
>;
export type DoneMessageInput = z.infer<typeof doneMessageSchema>;
export type ErrorMessageInput = z.infer<typeof errorMessageSchema>;
export type ServerToClientMessageInput = z.infer<
  typeof serverToClientMessageSchema
>;
