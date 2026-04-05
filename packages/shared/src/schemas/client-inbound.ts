import { z } from "zod";

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_AUDIO_CHUNK_B64_LENGTH = 256_000;

const baseMessageShape = {
  requestId: z.string().min(1).optional(),
  timestamp: z.string().datetime().optional(),
};

const integrationAuthEntrySchema = z
  .object({
    oauthConnected: z.boolean().optional(),
    apiKeyValues: z.record(z.string().min(1)).optional(),
  })
  .strict();

export const startSessionPayloadSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    locale: z.string().min(2).optional(),
    profileId: z.string().uuid().optional(),
    browserUseApiKey: z.string().min(1).optional(),
    integrationAuth: z.record(integrationAuthEntrySchema).optional(),
  })
  .strict();

export const audioChunkPayloadSchema = z
  .object({
    chunkBase64: z
      .string()
      .min(1)
      .max(MAX_AUDIO_CHUNK_B64_LENGTH)
      .regex(BASE64_PATTERN),
    sequence: z.number().int().min(0),
    encoding: z.enum(["pcm16", "webm_opus"]),
    sampleRateHz: z.number().int().positive().optional(),
  })
  .strict();

export const audioEndPayloadSchema = z
  .object({
    reason: z.enum(["end_of_speech", "manual_stop"]).optional(),
    finalSequence: z.number().int().min(0).optional(),
  })
  .strict();

export const interruptPayloadSchema = z
  .object({
    reason: z.string().max(200).optional(),
  })
  .strict();

export const startSessionMessageSchema = z
  .object({
    type: z.literal("start_session"),
    payload: startSessionPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const audioChunkMessageSchema = z
  .object({
    type: z.literal("audio_chunk"),
    payload: audioChunkPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const audioEndMessageSchema = z
  .object({
    type: z.literal("audio_end"),
    payload: audioEndPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const interruptMessageSchema = z
  .object({
    type: z.literal("interrupt"),
    payload: interruptPayloadSchema,
    ...baseMessageShape,
  })
  .strict();

export const clientToServerMessageSchema = z.discriminatedUnion("type", [
  startSessionMessageSchema,
  audioChunkMessageSchema,
  audioEndMessageSchema,
  interruptMessageSchema,
]);

export type StartSessionMessageInput = z.infer<typeof startSessionMessageSchema>;
export type AudioChunkMessageInput = z.infer<typeof audioChunkMessageSchema>;
export type AudioEndMessageInput = z.infer<typeof audioEndMessageSchema>;
export type InterruptMessageInput = z.infer<typeof interruptMessageSchema>;
export type ClientToServerMessageInput = z.infer<
  typeof clientToServerMessageSchema
>;

export type StartSessionPayloadInput = z.infer<typeof startSessionPayloadSchema>;
export type AudioChunkPayloadInput = z.infer<typeof audioChunkPayloadSchema>;
export type AudioEndPayloadInput = z.infer<typeof audioEndPayloadSchema>;
export type InterruptPayloadInput = z.infer<typeof interruptPayloadSchema>;
