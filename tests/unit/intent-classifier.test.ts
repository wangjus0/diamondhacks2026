import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleGenAI } from "@google/genai";

import { classifyIntent } from "../../apps/server/src/orchestrator/intent.ts";

function createAi(responseText?: string, error?: Error): GoogleGenAI {
  return {
    models: {
      generateContent: async () => {
        if (error) {
          throw error;
        }

        return { text: responseText };
      },
    },
  } as unknown as GoogleGenAI;
}

test("classifyIntent returns search result when confidence is high", async () => {
  const ai = createAi(
    JSON.stringify({
      intent: "search",
      confidence: 0.91,
      query: "ignored by classifier",
    })
  );

  const result = await classifyIntent(ai, "search for Murmur winners");

  assert.deepEqual(result, {
    intent: "search",
    confidence: 0.91,
    query: "search for Murmur winners",
  });
});

test("classifyIntent proceeds proactively when confidence is low", async () => {
  const ai = createAi(
    JSON.stringify({
      intent: "form_fill_draft",
      confidence: 0.42,
      query: "ignored by classifier",
      clarification: "Which form should I fill out?",
    })
  );

  const result = await classifyIntent(ai, "fill something out for me");

  assert.deepEqual(result, {
    intent: "form_fill_draft",
    confidence: 0.51,
    query: "fill something out for me",
  });
});

test("classifyIntent returns heuristic fallback when the model output is invalid", async () => {
  const ai = createAi("not json");

  const result = await classifyIntent(ai, "do the thing");

  assert.deepEqual(result, {
    intent: "search",
    confidence: 0.5,
    query: "do the thing",
  });
});
