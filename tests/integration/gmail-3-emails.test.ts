/**
 * End-to-end test: Gmail "3 most recent emails" query must return all 3 emails
 * through the full orchestrator pipeline (classify → select tool → refine query
 * → browser run → refine output → narrate).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleGenAI } from "@google/genai";
import type { ServerEvent } from "@murmur/shared";

import { handleTranscriptFinal } from "../../apps/server/src/orchestrator/orchestrator.ts";

class FakeSession {
  readonly events: ServerEvent[] = [];
  readonly states: Array<"idle" | "listening" | "thinking" | "acting" | "speaking"> = [];
  browserAdapter: unknown = null;

  send(event: ServerEvent): void {
    this.events.push(event);
  }

  setState(state: "idle" | "listening" | "thinking" | "acting" | "speaking"): void {
    this.states.push(state);
  }

  setBrowserAdapter(adapter: unknown): void {
    this.browserAdapter = adapter;
  }
}

const GMAIL_RAW_OUTPUT = [
  "Here are your 3 most recent emails:",
  "1. From: Alice <alice@example.com> | Subject: Q2 Planning | Date: Apr 4",
  "2. From: Bob <bob@example.com> | Subject: Code Review Request | Date: Apr 3",
  "3. From: Carol <carol@example.com> | Subject: Team Lunch Friday | Date: Apr 2",
].join("\n");

const GMAIL_REFINED_OUTPUT = [
  "1. Q2 Planning from Alice (Apr 4)",
  "2. Code Review Request from Bob (Apr 3)",
  "3. Team Lunch Friday from Carol (Apr 2)",
].join("\n");

function makeGeminiAi(refinedOutput: string): GoogleGenAI {
  return {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({ answer: refinedOutput }),
      }),
    },
  } as unknown as GoogleGenAI;
}

test("Gmail 3-emails: integration instruction preserves count from original transcript", async () => {
  const session = new FakeSession();
  const capturedInstructions: string[] = [];
  const narratedTexts: string[] = [];

  await handleTranscriptFinal(
    session,
    makeGeminiAi(GMAIL_REFINED_OUTPUT),
    "elevenlabs-key",
    "Can you check my gmail inbox for my 3 most recent emails",
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.95,
        query: "Can you check my gmail inbox for my 3 most recent emails",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.97,
        reason: "explicit gmail reference with count",
        // Gemini drops the "3" — the fallback to original text must restore it
        integrationInstruction: "Can you use the gmail integration and check inbox emails",
      }),
      refineBrowserQuery: async () => "check gmail inbox emails",
      createBrowserAdapter: () => ({
        runSearch: async (_query, _callbacks, options) => {
          capturedInstructions.push(options?.integrationInstruction ?? "");
          return GMAIL_RAW_OUTPUT;
        },
        runFormFillDraft: async () => {
          throw new Error("unexpected form fill");
        },
      }),
      narrate: async (s, text) => {
        narratedTexts.push(text);
        s.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
      browserApiKeySource: "user",
    }
  );

  // The integration instruction sent to browser-use must contain "3"
  assert.equal(capturedInstructions.length, 1);
  assert.match(
    capturedInstructions[0],
    /\b3\b/,
    `Integration instruction should contain "3": ${capturedInstructions[0]}`
  );

  // All 3 emails must survive in the narrated output
  assert.equal(narratedTexts.length, 1);
  const narrated = narratedTexts[0];
  assert.match(narrated, /Q2 Planning/i, "Email 1 missing from output");
  assert.match(narrated, /Code Review/i, "Email 2 missing from output");
  assert.match(narrated, /Team Lunch/i, "Email 3 missing from output");
});

test("Gmail 3-emails: Gemini output refinement preserves all 3 emails", async () => {
  const session = new FakeSession();
  const narratedTexts: string[] = [];

  await handleTranscriptFinal(
    session,
    makeGeminiAi(GMAIL_REFINED_OUTPUT),
    "elevenlabs-key",
    "Can you check my gmail inbox for my 3 most recent emails",
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.95,
        query: "Can you check my gmail inbox for my 3 most recent emails",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.97,
        reason: "explicit gmail reference",
        integrationInstruction:
          "Can you use the gmail integration and tell me what my 3 most recent emails are",
      }),
      refineBrowserQuery: async () => "check gmail inbox 3 most recent emails",
      createBrowserAdapter: () => ({
        runSearch: async () => GMAIL_RAW_OUTPUT,
        runFormFillDraft: async () => {
          throw new Error("unexpected form fill");
        },
      }),
      narrate: async (s, text) => {
        narratedTexts.push(text);
        s.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
      browserApiKeySource: "user",
    }
  );

  assert.equal(narratedTexts.length, 1);
  const narrated = narratedTexts[0];
  // All 3 email subjects must be present
  assert.match(narrated, /Q2 Planning/i, "Email 1 missing from narrated output");
  assert.match(narrated, /Code Review/i, "Email 2 missing from narrated output");
  assert.match(narrated, /Team Lunch/i, "Email 3 missing from narrated output");
});

test("Gmail 3-emails: fallback narration (no Gemini) still returns all 3 emails", async () => {
  // Simulate Gemini output refinement failure — the heuristic path must preserve all 3
  const ai = {
    models: {
      generateContent: async () => ({ text: "not-json" }),
    },
  } as unknown as GoogleGenAI;

  const session = new FakeSession();
  const narratedTexts: string[] = [];

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-key",
    "Can you check my gmail inbox for my 3 most recent emails",
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.95,
        query: "Can you check my gmail inbox for my 3 most recent emails",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.97,
        reason: "explicit gmail reference",
        integrationInstruction:
          "Can you use the gmail integration and tell me what my 3 most recent emails are",
      }),
      refineBrowserQuery: async () => "check gmail inbox 3 most recent emails",
      createBrowserAdapter: () => ({
        runSearch: async () => GMAIL_RAW_OUTPUT,
        runFormFillDraft: async () => {
          throw new Error("unexpected form fill");
        },
      }),
      narrate: async (s, text) => {
        narratedTexts.push(text);
        s.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
      browserApiKeySource: "user",
    }
  );

  assert.equal(narratedTexts.length, 1);
  const narrated = narratedTexts[0];
  // All 3 emails must survive the heuristic fallback truncation
  assert.match(narrated, /Q2 Planning/i, "Email 1 missing from fallback narration");
  assert.match(narrated, /Code Review/i, "Email 2 missing from fallback narration");
  assert.match(narrated, /Team Lunch/i, "Email 3 missing from fallback narration");
});
