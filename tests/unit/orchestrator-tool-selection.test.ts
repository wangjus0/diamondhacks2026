import test from "node:test";
import assert from "node:assert/strict";

import type { GoogleGenAI } from "@google/genai";
import { selectToolWithGemini } from "../../apps/server/src/orchestrator/orchestrator.ts";

test("selectToolWithGemini remaps explicit provider mentions to integration tools", async () => {
  const ai = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          toolId: "browser_use",
          confidence: 0.78,
          reason: "defaulted to browser_use",
        }),
      }),
    },
  } as unknown as GoogleGenAI;

  const cases = [
    {
      request: "check my Gmail inbox for latest updates",
      expectedToolId: "gmail",
    },
    {
      request: "summarize tasks in Linear for today",
      expectedToolId: "linear",
    },
    {
      request: "open my Google Sheets budget",
      expectedToolId: "google_sheets",
    },
    {
      request: "review HubSpot leads from this week",
      expectedToolId: "hubspot",
    },
  ] as const;

  for (const entry of cases) {
    const selected = await selectToolWithGemini(ai, entry.request, "search");
    assert.equal(selected.toolId, entry.expectedToolId);
    assert.match(
      selected.integrationInstruction ?? "",
      new RegExp(
        `Can you use the ${entry.expectedToolId.replace(/_/g, " ")} integration and`,
        "i"
      )
    );
  }
});

test("selectToolWithGemini falls back to explicit provider mapping when Gemini returns malformed text", async () => {
  const ai = {
    models: {
      generateContent: async () => ({
        text: "Sure, here is your result:\n```json\n{\"toolId\":\"browser_use\"}\n```",
      }),
    },
  } as unknown as GoogleGenAI;

  const selected = await selectToolWithGemini(
    ai,
    "check my Gmail inbox for my 3 most recent emails",
    "search"
  );

  assert.equal(selected.toolId, "gmail");
  assert.match(selected.reason, /explicit provider mapping to gmail/i);
  assert.match(
    selected.integrationInstruction ?? "",
    /Can you use the gmail integration and/i
  );
});

test("selectToolWithGemini falls back to explicit provider mapping when Gemini response text is empty", async () => {
  const ai = {
    models: {
      generateContent: async () => ({
        text: "",
      }),
    },
  } as unknown as GoogleGenAI;

  const selected = await selectToolWithGemini(ai, "check my Gmail inbox", "search");

  assert.equal(selected.toolId, "gmail");
  assert.match(selected.reason, /explicit provider mapping to gmail/i);
  assert.match(
    selected.integrationInstruction ?? "",
    /Can you use the gmail integration and/i
  );
});
