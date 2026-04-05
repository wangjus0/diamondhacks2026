import type { GoogleGenAI } from "@google/genai";
import type { IntentResult, ServerEvent } from "@murmur/shared";
import { env } from "../config/env.js";
import { BrowserAdapter } from "../tools/browser/adapter.js";
import { narrate } from "../voice/narrator.js";
import {
  createPolicyConfig,
  evaluateIntentPolicy,
  logPolicyBlock,
} from "../safety/policy.js";
import { classifyIntent } from "./intent.js";
import { runTool } from "../tools/core/tool-runner.js";
import { ToolPolicyBlockedError } from "../tools/core/tool-errors.js";
import "../tools/browser/web-extract.js";
import "../tools/browser/multi-site-compare.js";

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
    callbacks: { onStatus: (message: string) => void },
    options?: { allowSubmit?: boolean }
  ): Promise<string>;
}

interface TranscriptFinalLegacyDependencies {
  classify?: (
    ai: GoogleGenAI,
    transcript: string
  ) => Promise<IntentResult>;
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

type TranscriptFinalOverrideDeps = Partial<TranscriptFinalDeps> &
  TranscriptFinalLegacyDependencies;

type TranscriptFinalDeps = Readonly<{
  classify: (ai: GoogleGenAI, text: string) => Promise<IntentResult>;
  narrate: (session: Orchestratable, text: string, apiKey: string) => Promise<void>;
  createBrowserAdapter: (apiKey: string) => BrowserExecutor;
  browserApiKey: string;
}>;

const defaultDeps: TranscriptFinalDeps = {
  classify: classifyIntent,
  narrate,
  createBrowserAdapter: (browserApiKey: string) => new BrowserAdapter(browserApiKey),
  browserApiKey: env.BROWSER_USE_API_KEY,
};

function resolveDeps(maybeDeps: TranscriptFinalOverrideDeps | undefined): TranscriptFinalDeps {
  return {
    classify: maybeDeps?.classify ?? maybeDeps?.classifyIntent ?? defaultDeps.classify,
    narrate: maybeDeps?.narrate ?? defaultDeps.narrate,
    createBrowserAdapter:
      maybeDeps?.createBrowserAdapter ?? defaultDeps.createBrowserAdapter,
    browserApiKey: maybeDeps?.browserApiKey ?? defaultDeps.browserApiKey,
  };
}

export async function handleTranscriptFinal(
  session: Orchestratable,
  ai: GoogleGenAI,
  apiKey: string,
  text: string,
  allowlistOrDeps?:
    | string
    | TranscriptFinalOverrideDeps,
  maybeDeps?: TranscriptFinalOverrideDeps
): Promise<void> {
  const navigationAllowlist =
    typeof allowlistOrDeps === "string" ? allowlistOrDeps : env.NAVIGATION_ALLOWLIST;
  const deps = resolveDeps(
    typeof allowlistOrDeps === "string" ? maybeDeps : allowlistOrDeps
  );

  try {
    session.setState("thinking");

    const result = await deps.classify(ai, text);
    session.send({ type: "intent", intent: result });

    if (result.intent === "clarify") {
      session.setState("speaking");
      await deps.narrate(session, result.clarification || "Could you clarify?", apiKey);
      session.setState("idle");
      session.send({ type: "done" });
      return;
    }

    const policyDecision = evaluateIntentPolicy(
      result,
      createPolicyConfig(navigationAllowlist, env.ALLOW_FINAL_FORM_SUBMISSION)
    );
    if (!policyDecision.allowed) {
      logPolicyBlock({
        reason: policyDecision.reason,
        intent: result.intent,
        query: result.query,
      });

      session.send({ type: "action_status", message: policyDecision.message });
      session.setState("speaking");
      await deps.narrate(session, policyDecision.message, apiKey);
      session.setState("idle");
      session.send({ type: "done" });
      return;
    }

    session.setState("acting");

    const statusCb = {
      onStatus: (msg: string) => session.send({ type: "action_status", message: msg }),
    };

    let output: string;

    if (result.intent === "web_extract" || result.intent === "multi_site_compare") {
      try {
        const toolResult = await runTool(
          result.intent,
          {
            query: result.query,
            browserApiKey: deps.browserApiKey,
            onStatus: statusCb.onStatus,
          },
          createPolicyConfig(navigationAllowlist, env.ALLOW_FINAL_FORM_SUBMISSION)
        );
        output = toolResult.output;
      } catch (err) {
        if (err instanceof ToolPolicyBlockedError) {
          logPolicyBlock({ reason: "dangerous_action", intent: result.intent, query: result.query });
          session.send({ type: "action_status", message: err.userMessage });
          session.setState("speaking");
          await deps.narrate(session, err.userMessage, apiKey);
          session.setState("idle");
          session.send({ type: "done" });
          return;
        }
        console.error("[Orchestrator] Tool error:", err);
        output = "Tool task failed. " + (err instanceof Error ? err.message : "");
      }
    } else {
      const browser = deps.createBrowserAdapter(deps.browserApiKey);
      session.setBrowserAdapter(browser);

      try {
        if (result.intent === "search") {
          output = await browser.runSearch(result.query, statusCb);
        } else {
          output = await browser.runFormFillDraft(result.query, statusCb, {
            allowSubmit: env.ALLOW_FINAL_FORM_SUBMISSION,
          });
        }
      } catch (err) {
        console.error("[Orchestrator] Browser error:", err);
        output = "Browser task failed. " + (err instanceof Error ? err.message : "");
      }

      session.setBrowserAdapter(null);
    }
    session.setState("speaking");
    await deps.narrate(session, output, apiKey);

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
