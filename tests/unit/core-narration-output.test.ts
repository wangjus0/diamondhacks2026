import test from "node:test";
import assert from "node:assert/strict";

import type { GoogleGenAI } from "@google/genai";
import {
  toCoreNarrationText,
  refineOutputWithGemini,
} from "../../apps/server/src/orchestrator/orchestrator.ts";

test("toCoreNarrationText removes procedural lines and keeps core result lines", () => {
  const output = [
    "I navigated to google.com and searched for options.",
    "1. Option A - https://a.example",
    "2. Option B - https://b.example",
  ].join("\n");

  const result = toCoreNarrationText(output);

  assert.equal(
    result,
    ["1. Option A - https://a.example", "2. Option B - https://b.example"].join("\n")
  );
});

test("toCoreNarrationText limits the spoken result to core lines", () => {
  const output = Array.from({ length: 15 }, (_, i) => `${i + 1}. Item ${i + 1}`).join("\n");

  const result = toCoreNarrationText(output);

  assert.equal(result, Array.from({ length: 12 }, (_, i) => `${i + 1}. Item ${i + 1}`).join("\n"));
});

test("toCoreNarrationText truncates very long responses", () => {
  const longSentence =
    "This is a very long response ".repeat(60) +
    "and it should be trimmed to keep only the core information requested.";
  const result = toCoreNarrationText(longSentence);

  assert.equal(result.length <= 903, true);
});

test("toCoreNarrationText keeps original content when every line looks procedural", () => {
  const output = "I navigated to the page and checked the details.";
  const result = toCoreNarrationText(output);

  assert.equal(result, output);
});

test("refineOutputWithGemini uses refined answer from Gemini", async () => {
  const ai = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          answer: "Top result: Murmur demo project at https://example.com/demo",
        }),
      }),
    },
  } as unknown as GoogleGenAI;

  const result = await refineOutputWithGemini(
    ai,
    "search for murmur demo projects",
    "Step 1: opened google\n1. Murmur demo project - https://example.com/demo"
  );

  assert.equal(result, "Top result: Murmur demo project at https://example.com/demo");
});

test("refineOutputWithGemini falls back to heuristic cleanup when Gemini output is invalid", async () => {
  const ai = {
    models: {
      generateContent: async () => ({
        text: "not-json",
      }),
    },
  } as unknown as GoogleGenAI;

  const result = await refineOutputWithGemini(
    ai,
    "search for murmur demo projects",
    "I navigated to google.com.\n1. Murmur demo project - https://example.com/demo"
  );

  assert.equal(result, "1. Murmur demo project - https://example.com/demo");
});
