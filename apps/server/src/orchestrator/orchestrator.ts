import type { GoogleGenAI } from "@google/genai";
import type { ServerEvent } from "@diamond/shared";
import { classifyIntent } from "./intent.js";
import { narrate } from "../voice/narrator.js";
import { BrowserAdapter } from "../tools/browser/adapter.js";
import { env } from "../config/env.js";

interface Orchestratable {
  send(event: ServerEvent): void;
  setState(state: "idle" | "listening" | "thinking" | "acting" | "speaking"): void;
  setBrowserAdapter(adapter: BrowserAdapter | null): void;
}

export async function handleTranscriptFinal(
  session: Orchestratable,
  ai: GoogleGenAI,
  apiKey: string,
  text: string
): Promise<void> {
  try {
    session.setState("thinking");

    const result = await classifyIntent(ai, text);
    session.send({ type: "intent", intent: result });

    if (result.intent === "clarify") {
      session.setState("speaking");
      await narrate(
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
    const browser = new BrowserAdapter(env.BROWSER_USE_API_KEY);
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
    await narrate(session, output, apiKey);

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
