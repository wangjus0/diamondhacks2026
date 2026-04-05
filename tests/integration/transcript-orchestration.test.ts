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
    ["intent", "action_status", "action_status", "narration_text", "done"]
  );

  const actionStatuses = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "action_status" }> =>
      event.type === "action_status"
  );
  assert.equal(actionStatuses.length, 2);
  assert.match(actionStatuses[0].message, /^Tool selected:\s+browser_use\s+\(\d+%\)$/);
  assert.equal(actionStatuses[1].message, "Opened search results");
});

test("non-native selected tool emits fallback status and uses browser path", async () => {
  const session = new FakeSession();
  const browserCalls: string[] = [];
  const browserOptions: Array<{
    preferredToolId?: string;
    selectedToolReason?: string;
    forceIntegration?: boolean;
    strictIntegration?: boolean;
    integrationInstruction?: string;
  }> = [];

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "check unread emails and summarize urgent ones",
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.91,
        query: "check unread emails and summarize urgent ones",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.93,
        reason: "email request maps to gmail",
        integrationInstruction: "Can you use the gmail integration and unread urgent emails.",
      }),
      createBrowserAdapter: () => ({
        runSearch: async (query, callbacks, options) => {
          browserCalls.push(query);
          browserOptions.push({
            preferredToolId: options?.preferredToolId,
            selectedToolReason: options?.selectedToolReason,
            forceIntegration: options?.forceIntegration,
            strictIntegration: options?.strictIntegration,
            integrationInstruction: options?.integrationInstruction,
          });
          callbacks.onStatus("Opened search results");
          return "1. Urgent message summary";
        },
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      refineOutput: async () => "Urgent summary: 1 message needs reply today.",
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
      browserApiKeySource: "user",
    }
  );

  assert.deepEqual(browserCalls, ["check unread emails and summarize urgent ones"]);
  assert.deepEqual(browserOptions, [
    {
      preferredToolId: "gmail",
      selectedToolReason: "email request maps to gmail",
      forceIntegration: true,
      strictIntegration: false,
      integrationInstruction: "Can you use the gmail integration and unread urgent emails",
    },
  ]);

  const actionStatuses = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "action_status" }> =>
      event.type === "action_status"
  );
  assert.equal(actionStatuses.length, 3);
  assert.equal(actionStatuses[0].message, "Tool selected: gmail (93%)");
  assert.equal(
    actionStatuses[1].message,
    "Composio integration: Can you use the gmail integration and unread urgent emails"
  );
  assert.equal(actionStatuses[2].message, "Opened search results");
});

test("integration tool selection avoids native web_extract execution path", async () => {
  const session = new FakeSession();
  let searchCalls = 0;
  let formCalls = 0;

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "check my Gmail inbox for the latest three emails",
    {
      classifyIntent: async () => ({
        intent: "web_extract",
        confidence: 0.95,
        query: "check my Gmail inbox for the latest three emails",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.9,
        reason: "gmail integration needed",
      }),
      createBrowserAdapter: () => ({
        runSearch: async (_query, callbacks, options) => {
          searchCalls += 1;
          assert.equal(options?.preferredToolId, "gmail");
          assert.equal(options?.forceIntegration, true);
          assert.equal(options?.strictIntegration, false);
          assert.match(
            options?.integrationInstruction ?? "",
            /^Can you use the gmail integration and\s+/i
          );
          callbacks.onStatus("Executed integration search path");
          return "Latest three emails summarized.";
        },
        runFormFillDraft: async () => {
          formCalls += 1;
          return "Unexpected form path";
        },
      }),
      refineOutput: async () => "Latest three emails summarized.",
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
      browserApiKeySource: "user",
    }
  );

  assert.equal(searchCalls, 1);
  assert.equal(formCalls, 0);
});

test("integration request uses server Browser Use key when user key is not provided", async () => {
  const session = new FakeSession();
  let browserCalled = false;

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "check my gmail inbox",
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.95,
        query: "check my gmail inbox",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.92,
        reason: "gmail integration needed",
      }),
      createBrowserAdapter: () => ({
        runSearch: async () => {
          browserCalled = true;
          return "unexpected";
        },
        runFormFillDraft: async () => {
          browserCalled = true;
          return "unexpected";
        },
      }),
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      refineOutput: async (_ai, _request, rawOutput) => rawOutput,
      browserApiKey: "server-key",
      browserApiKeySource: "server",
    }
  );

  assert.equal(browserCalled, true);
  const statuses = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "action_status" }> =>
      event.type === "action_status"
  );
  assert.ok(
    statuses.some((status) =>
      /Using Browser Use API key from server\/.env for integration execution\./i.test(
        status.message
      )
    )
  );
});

test("clarify intent proceeds with proactive best-effort execution", async () => {
  const session = new FakeSession();
  let searchCalls = 0;

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "do something with my inbox",
    {
      classifyIntent: async () => ({
        intent: "clarify",
        confidence: 0.2,
        query: "do something with my inbox",
        clarification: "What exactly should I do?",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.88,
        reason: "inbox request maps to gmail",
      }),
      createBrowserAdapter: () => ({
        runSearch: async (_query, callbacks) => {
          searchCalls += 1;
          callbacks.onStatus("Executed best-effort integration search");
          return "Inbox summary";
        },
        runFormFillDraft: async () => "Unexpected form path",
      }),
      refineOutput: async () => "Inbox summary",
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
      browserApiKeySource: "user",
    }
  );

  assert.equal(searchCalls, 1);
  const actionStatuses = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "action_status" }> =>
      event.type === "action_status"
  );
  assert.ok(
    actionStatuses.some((status) =>
      /Intent was ambiguous; proceeding proactively with best-effort execution\./i.test(
        status.message
      )
    )
  );
});
