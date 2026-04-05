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
  refineOutput?: (
    ai: GoogleGenAI,
    userRequest: string,
    rawOutput: string
  ) => Promise<string>;
  browserApiKey?: string;
}

type TranscriptFinalOverrideDeps = Partial<TranscriptFinalDeps> &
  TranscriptFinalLegacyDependencies;

type TranscriptFinalDeps = Readonly<{
  classify: (ai: GoogleGenAI, text: string) => Promise<IntentResult>;
  narrate: (session: Orchestratable, text: string, apiKey: string) => Promise<void>;
  createBrowserAdapter: (apiKey: string) => BrowserExecutor;
  refineOutput: (
    ai: GoogleGenAI,
    userRequest: string,
    rawOutput: string
  ) => Promise<string>;
  browserApiKey: string;
}>;

const defaultDeps: TranscriptFinalDeps = {
  classify: classifyIntent,
  narrate,
  createBrowserAdapter: (browserApiKey: string) => new BrowserAdapter(browserApiKey),
  refineOutput: refineOutputWithGemini,
  browserApiKey: env.BROWSER_USE_API_KEY,
};

const MAX_CORE_NARRATION_LINES = 4;
const MAX_CORE_NARRATION_CHARS = 420;
const PROCESS_LINE_PATTERNS = [
  /^step\s+\d+[:.-]?/i,
  /^status[:\s]/i,
  /^(creating|starting|running)\s+(browser|task|tool)\b/i,
  /^(browser\s+task|task)\s+(started|finished|failed|stopped)\b/i,
  /^(i|we)\s+(navigated|visited|went|opened|clicked|searched|reviewed|checked)\b/i,
  /^(navigated|visited|opened|clicked|searched)\b/i,
];
const OUTPUT_REFINEMENT_SYSTEM_PROMPT = `You clean raw browser automation output for voice playback.
Return ONLY the core information the user asked for.
Requirements:
- Keep the answer concise and factual.
- Exclude process narration (steps, navigation logs, tool status, "I clicked", etc.).
- Prefer direct answer format over explanation.
- If the raw output includes numbered findings or options, keep only the most relevant items.
- If there is an error, state it plainly in one short sentence.

Respond with JSON only:
{
  "answer": "clean, concise final answer"
}`;

export function toCoreNarrationText(rawText: string): string {
  const normalized = normalizeNarrationText(rawText);
  if (!normalized) {
    return "Task completed.";
  }

  const lines = normalized.split("\n");
  const filteredLines = lines.filter((line) =>
    PROCESS_LINE_PATTERNS.every((pattern) => !pattern.test(line))
  );
  const selectedLines = (filteredLines.length > 0 ? filteredLines : lines).slice(
    0,
    MAX_CORE_NARRATION_LINES
  );

  const joined = selectedLines.join("\n");
  return truncateNarration(joined, MAX_CORE_NARRATION_CHARS);
}

export async function refineOutputWithGemini(
  ai: GoogleGenAI,
  userRequest: string,
  rawOutput: string
): Promise<string> {
  const fallback = toCoreNarrationText(rawOutput);
  const generateContent = ai?.models?.generateContent;

  if (typeof generateContent !== "function") {
    return fallback;
  }

  try {
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${OUTPUT_REFINEMENT_SYSTEM_PROMPT}\n\n` +
        `User request:\n${userRequest}\n\n` +
        `Raw browser/tool output:\n${rawOutput}`,
      config: { responseMimeType: "application/json" },
    });

    const responseText = response.text;
    if (!responseText) {
      return fallback;
    }

    let parsed: { answer?: unknown };
    try {
      parsed = JSON.parse(responseText) as { answer?: unknown };
    } catch {
      return fallback;
    }

    if (typeof parsed.answer !== "string") {
      return fallback;
    }

    const normalized = normalizeNarrationText(parsed.answer);
    if (!normalized) {
      return fallback;
    }

    return toCoreNarrationText(normalized);
  } catch (err) {
    console.error("[Orchestrator] Output refinement failed:", err);
    return fallback;
  }
}

function normalizeNarrationText(text: string): string {
  const strippedMarkdown = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");

  return strippedMarkdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function truncateNarration(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const clipped = text.slice(0, maxChars);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? ")
  );
  if (sentenceEnd >= Math.floor(maxChars * 0.55)) {
    return clipped.slice(0, sentenceEnd + 1).trim();
  }

  return `${clipped.trimEnd()}...`;
}

function resolveDeps(maybeDeps: TranscriptFinalOverrideDeps | undefined): TranscriptFinalDeps {
  return {
    classify: maybeDeps?.classify ?? maybeDeps?.classifyIntent ?? defaultDeps.classify,
    narrate: maybeDeps?.narrate ?? defaultDeps.narrate,
    createBrowserAdapter:
      maybeDeps?.createBrowserAdapter ?? defaultDeps.createBrowserAdapter,
    refineOutput: maybeDeps?.refineOutput ?? defaultDeps.refineOutput,
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
    const refinedOutput = await deps.refineOutput(ai, text, output);
    await deps.narrate(session, refinedOutput, apiKey);

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
