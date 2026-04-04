import type { GoogleGenAI } from "@google/genai";
import type { ServerEvent } from "@diamond/shared";
import { classifyIntent } from "./intent.js";
import { narrate } from "../voice/narrator.js";
import { BrowserAdapter } from "../tools/browser/adapter.js";
import { env } from "../config/env.js";
import type { IntentResult } from "@diamond/shared";

interface Orchestratable {
  send(event: ServerEvent): void;
  setState(state: "idle" | "listening" | "thinking" | "acting" | "speaking"): void;
  setBrowserAdapter(adapter: BrowserExecutor | null): void;
}

interface BrowserExecutor {
  runSearch(
    query: string,
    callbacks: { onStatus: (message: string) => void }
  ): Promise<string>;
  runFormFillDraft(
    query: string,
    callbacks: { onStatus: (message: string) => void }
  ): Promise<string>;
}

interface TranscriptFinalDependencies {
  classifyIntent?: (
    ai: GoogleGenAI,
    transcript: string
  ) => Promise<IntentResult>;
  narrate?: (
    session: Orchestratable,
    text: string,
    apiKey: string
  ) => Promise<void>;
  createBrowserAdapter?: (apiKey: string) => BrowserExecutor;
  browserApiKey?: string;
}

export async function handleTranscriptFinal(
  session: Orchestratable,
  ai: GoogleGenAI,
  apiKey: string,
  text: string,
  dependencies: TranscriptFinalDependencies = {}
): Promise<void> {
  const classifyIntentImpl = dependencies.classifyIntent ?? classifyIntent;
  const narrateImpl = dependencies.narrate ?? narrate;
  const createBrowserAdapter =
    dependencies.createBrowserAdapter ??
    ((browserApiKey: string) => new BrowserAdapter(browserApiKey));
  const browserApiKey = dependencies.browserApiKey ?? env.BROWSER_USE_API_KEY;

  try {
    session.setState("thinking");

    const result = await classifyIntentImpl(ai, text);
    session.send({ type: "intent", intent: result });

    if (result.intent === "clarify") {
      session.setState("speaking");
      await narrateImpl(
        session,
        result.clarification || "Could you clarify?",
        apiKey
      );
      session.setState("idle");
      session.send({ type: "done" });
      return;
    }

    // search or form_fill_draft -- execute via Browser Use
    session.setState("acting");
    const browser = createBrowserAdapter(browserApiKey);
    session.setBrowserAdapter(browser);

    const statusCb = {
      onStatus: (msg: string) =>
        session.send({ type: "action_status", message: msg }),
    };

    let output: string;
    try {
      if (result.intent === "search") {
        output = await browser.runSearch(result.query, statusCb);
      } else {
        output = await browser.runFormFillDraft(result.query, statusCb);
      }
    } catch (err) {
      console.error("[Orchestrator] Browser error:", err);
      output = "Browser task failed. " + (err instanceof Error ? err.message : "");
    }

    session.setBrowserAdapter(null);
    session.setState("speaking");
    await narrateImpl(session, output, apiKey);

    session.setState("idle");
    session.send({ type: "done" });
  } catch (err) {
    console.error("[Orchestrator] Error:", err);
    session.send({
      type: "error",
      message: err instanceof Error ? err.message : "Unknown orchestrator error",
    });
    session.setState("idle");
  }
}
