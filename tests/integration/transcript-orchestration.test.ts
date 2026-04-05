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

test("final transcript flows through intent, browser action, narration, and done", async () => {
  const session = new FakeSession();
  const browserCalls: string[] = [];
  const refineCalls: Array<{ userRequest: string; rawOutput: string }> = [];
  const narratedTexts: string[] = [];

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "search for Murmur demo projects",
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.95,
        query: "search for Murmur demo projects",
      }),
      createBrowserAdapter: () => ({
        runSearch: async (query, callbacks) => {
          browserCalls.push(query);
          callbacks.onStatus("Opened search results");
          return "I navigated to search results.\n1. Demo Project - https://example.com/demo";
        },
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      refineOutput: async (_ai, userRequest, rawOutput) => {
        refineCalls.push({ userRequest, rawOutput });
        return "Top result: Demo Project - https://example.com/demo";
      },
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.deepEqual(session.states, ["thinking", "acting", "speaking", "idle"]);
  assert.deepEqual(browserCalls, ["search for Murmur demo projects"]);
  assert.deepEqual(refineCalls, [
    {
      userRequest: "search for Murmur demo projects",
      rawOutput: "I navigated to search results.\n1. Demo Project - https://example.com/demo",
    },
  ]);
  assert.deepEqual(narratedTexts, ["Top result: Demo Project - https://example.com/demo"]);
  assert.equal(session.browserAdapter, null);

  assert.deepEqual(
    session.events.map((event) => event.type),
    ["intent", "action_status", "narration_text", "done"]
  );
});
