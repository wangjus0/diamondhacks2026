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
import { generateToolPlan } from "./tool-guide.js";
import { runTool } from "../tools/core/tool-runner.js";
import { ToolPolicyBlockedError } from "../tools/core/tool-errors.js";
import "../tools/browser/web-extract.js";
import "../tools/browser/multi-site-compare.js";
import { z } from "zod";

interface Orchestratable {
  send(event: ServerEvent): void;
  setState(state: "idle" | "listening" | "thinking" | "acting" | "speaking"): void;
  setBrowserAdapter(adapter: BrowserExecutor | null): void;
}

interface BrowserExecutor {
  runSearch(
    query: string,
    callbacks: { onStatus: (message: string) => void },
    options?: {
      preferredToolId?: ToolId;
      selectedToolReason?: string;
      forceIntegration?: boolean;
      strictIntegration?: boolean;
      integrationInstruction?: string;
    }
  ): Promise<string>;
  runFormFillDraft(
    query: string,
    callbacks: { onStatus: (message: string) => void },
    options?: {
      allowSubmit?: boolean;
      preferredToolId?: ToolId;
      selectedToolReason?: string;
      forceIntegration?: boolean;
      strictIntegration?: boolean;
      integrationInstruction?: string;
    }
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
  selectTool?: (
    ai: GoogleGenAI,
    userRequest: string,
    intent: IntentResult["intent"]
  ) => Promise<ToolSelectionResult>;
  refineOutput?: (
    ai: GoogleGenAI,
    userRequest: string,
    rawOutput: string
  ) => Promise<string>;
  browserApiKey?: string;
  browserApiKeySource?: "user" | "server";
}

type TranscriptFinalOverrideDeps = Partial<TranscriptFinalDeps> &
  TranscriptFinalLegacyDependencies;

type TranscriptFinalDeps = Readonly<{
  classify: (ai: GoogleGenAI, text: string, historyContext?: string) => Promise<IntentResult>;
  narrate: (session: Orchestratable, text: string, apiKey: string) => Promise<void>;
  createBrowserAdapter: (apiKey: string) => BrowserExecutor;
  selectTool: (
    ai: GoogleGenAI,
    userRequest: string,
    intent: IntentResult["intent"]
  ) => Promise<ToolSelectionResult>;
  refineOutput: (
    ai: GoogleGenAI,
    userRequest: string,
    rawOutput: string,
    historyContext?: string
  ) => Promise<string>;
  refineBrowserQuery: (
    ai: GoogleGenAI,
    userRequest: string,
    intent: IntentResult["intent"],
    toolId: ToolId,
    historyContext?: string
  ) => Promise<string>;
  browserApiKey: string;
  browserApiKeySource: "user" | "server";
}>;

const defaultDeps: TranscriptFinalDeps = {
  classify: classifyIntent,
  narrate,
  createBrowserAdapter: (browserApiKey: string) => new BrowserAdapter(browserApiKey),
  selectTool: selectToolWithGemini,
  refineOutput: refineOutputWithGemini,
  refineBrowserQuery: refineBrowserQueryWithGemini,
  browserApiKey: env.BROWSER_USE_API_KEY,
  browserApiKeySource: "server",
};

const AVAILABLE_TOOL_IDS = [
  "browser_use",
  "web_extract",
  "multi_site_compare",
  "gmail",
  "outlook",
  "discord",
  "slack",
  "dropbox",
  "google_drive",
  "google_sheets",
  "supabase",
  "google_calendar",
  "google_docs",
  "notion",
  "exa",
  "github",
  "jira",
  "linear",
  "figma",
  "hubspot",
  "salesforce",
  "stripe",
] as const;

type ToolId = (typeof AVAILABLE_TOOL_IDS)[number];

type ToolSelectionResult = {
  toolId: ToolId;
  confidence: number;
  reason: string;
  integrationInstruction?: string;
};

const TOOL_SELECTION_SCHEMA = z.object({
  toolId: z.enum(AVAILABLE_TOOL_IDS),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(240),
  integrationInstruction: z.string().min(1).max(320).optional(),
});

const NATIVE_ORCHESTRATOR_TOOLS = new Set<ToolId>([
  "browser_use",
  "web_extract",
  "multi_site_compare",
]);
const INTEGRATION_TOOL_IDS = new Set<ToolId>(
  AVAILABLE_TOOL_IDS.filter((toolId) => !NATIVE_ORCHESTRATOR_TOOLS.has(toolId))
);

const TOOL_SELECTION_SYSTEM_PROMPT = `You are a tool router.
Choose exactly one best tool for the user request from this list:
${AVAILABLE_TOOL_IDS.join(", ")}

Rules:
- Prefer specialized integrations (gmail, notion, github, stripe, etc.) when the request clearly targets them.
- If the user explicitly names a provider (for example Gmail, Outlook, Slack, Notion, GitHub, Stripe), choose that provider's integration tool.
- Use web_extract when the user asks to extract/summarize a specific page.
- Use multi_site_compare when the user asks to compare across multiple sites.
- Use browser_use for generic browsing/search/form actions.
- If toolId is an integration tool (gmail/notion/github/stripe/etc.), include integrationInstruction in this exact format:
  "Can you use the <tool> integration and <short objective summary>"
  - The objective must be short and action-focused, not a verbatim copy of the user prompt.
- If toolId is not an integration tool, omit integrationInstruction.
- Return JSON only:
{"toolId":"...", "confidence":0.0, "reason":"short reason", "integrationInstruction":"Can you use the ... integration and ..."} `;

const PROVIDER_DETECTION_TERMS: Partial<Record<ToolId, readonly string[]>> = {
  gmail: ["gmail", "google mail", "inbox"],
  outlook: ["outlook", "microsoft outlook"],
  discord: ["discord"],
  slack: ["slack"],
  dropbox: ["dropbox"],
  google_drive: ["google drive", "drive"],
  google_sheets: ["google sheets", "sheets"],
  supabase: ["supabase"],
  google_calendar: ["google calendar", "calendar"],
  google_docs: ["google docs", "docs"],
  notion: ["notion"],
  exa: ["exa"],
  github: ["github"],
  jira: ["jira", "atlassian"],
  linear: ["linear"],
  figma: ["figma"],
  hubspot: ["hubspot"],
  salesforce: ["salesforce"],
  stripe: ["stripe"],
};

// ── Conversation history ──────────────────────────────────────────────────────

export type ConversationTurn = {
  transcript: string;
  response: string;
};

export type ConversationHistory = {
  /** Gemini-generated summary of older turns that were compacted away. */
  summary: string | null;
  /** Most recent verbatim turns kept in full. */
  recentTurns: ConversationTurn[];
};

export function createEmptyHistory(): ConversationHistory {
  return { summary: null, recentTurns: [] };
}

const MAX_RECENT_TURNS = 6;
const COMPACT_TO_TURNS = 3; // keep this many after compacting

function buildHistoryContext(history: ConversationHistory): string {
  const parts: string[] = [];
  if (history.summary) {
    parts.push(`Summary of earlier conversation: ${history.summary}`);
  }
  for (const turn of history.recentTurns) {
    parts.push(`User: ${turn.transcript}\nAssistant: ${turn.response}`);
  }
  return parts.join("\n\n");
}

async function maybeCompactHistory(
  ai: GoogleGenAI,
  history: ConversationHistory
): Promise<void> {
  if (history.recentTurns.length <= MAX_RECENT_TURNS) {
    return;
  }

  const toCompact = history.recentTurns.splice(0, history.recentTurns.length - COMPACT_TO_TURNS);
  const existingPrefix = history.summary ? `Previous summary: ${history.summary}\n\n` : "";
  const turnText = toCompact
    .map((t) => `User: ${t.transcript}\nAssistant: ${t.response}`)
    .join("\n\n");

  try {
    const generateContent = ai?.models?.generateContent;
    if (typeof generateContent === "function") {
      const response = await generateContent({
        model: "gemini-2.5-flash",
        contents:
          `Summarize this conversation into 2-3 concise sentences capturing key facts, topics, and results. ` +
          `The summary will be used as context for future turns.\n\n` +
          `${existingPrefix}${turnText}`,
      });
      history.summary = response.text?.trim() ?? history.summary;
    } else {
      // Fallback: plain text truncation
      history.summary = toCompact
        .map((t) => `${t.transcript} → ${t.response}`)
        .join("; ")
        .slice(0, 400);
    }
  } catch {
    history.summary = toCompact
      .map((t) => `${t.transcript} → ${t.response}`)
      .join("; ")
      .slice(0, 400);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const MAX_CORE_NARRATION_LINES = 12;
const MAX_CORE_NARRATION_CHARS = 900;
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
- If the user asked for N items (e.g. "3 most recent emails", "top 5 results"), preserve ALL N items in the answer. Do NOT reduce the count.
- If the raw output includes a list, keep every item that the user explicitly requested.
- If there is an error, state it plainly in one short sentence.

Respond with JSON only:
{
  "answer": "clean, concise final answer"
}`;

const BROWSER_QUERY_REFINEMENT_SYSTEM_PROMPT = `You compress a user request into a short Browser Use task query.
Return JSON only:
{
  "query": "short action-oriented query",
  "objective": "very short objective phrase"
}

Rules:
- Keep it concise and actionable.
- Preserve critical nouns/numbers/time constraints.
- Do not include process narration.
- Avoid repeating the full user prompt verbatim.
- If toolId is an integration (gmail/notion/github/stripe/etc.), prefer objective phrasing that works in:
  "Can you use the <tool> integration and <objective>"`;

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

function normalizeBrowserQueryText(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").trim();
}

function fallbackToolFromIntent(intent: IntentResult["intent"]): ToolSelectionResult {
  if (intent === "web_extract") {
    return { toolId: "web_extract", confidence: 0.7, reason: "intent indicates web extraction" };
  }

  if (intent === "multi_site_compare") {
    return {
      toolId: "multi_site_compare",
      confidence: 0.7,
      reason: "intent indicates cross-site comparison",
    };
  }

  return { toolId: "browser_use", confidence: 0.6, reason: "default browser execution path" };
}

function normalizeIntegrationInstruction(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

function stripIntegrationPrefix(text: string): string {
  return text
    .replace(
      /^(?:can\s+you\s+)?use\s+(?:the\s+)?[\w\s_-]+?\s+integration\b(?:\s*,?\s*(?:and(?:\s+then)?|to(?:\s+do)?|:))?[:\s-]*/i,
      ""
    )
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();
}

function hasExplicitCount(text: string): boolean {
  return /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(text);
}

function buildIntegrationInstructionForTool(
  toolId: ToolId,
  userQuery: string,
  rawInstruction?: string
): string | undefined {
  if (!INTEGRATION_TOOL_IDS.has(toolId)) {
    return undefined;
  }

  const label = toolId.replace(/_/g, " ");
  const normalizedRaw = normalizeIntegrationInstruction(rawInstruction);
  const rawObjective = stripIntegrationPrefix(normalizedRaw);
  const instructionObjective = summarizeIntegrationObjective(rawObjective || userQuery, 16, 220, toolId);
  const queryObjective = summarizeIntegrationObjective(userQuery, 16, 220, toolId);

  // Prefer the query-derived objective when it contains a specific count
  // that the (potentially Gemini-compressed) instruction lost.
  const objective =
    hasExplicitCount(queryObjective) && !hasExplicitCount(instructionObjective)
      ? queryObjective
      : instructionObjective;

  return `Can you use the ${label} integration and ${objective}`;
}

function summarizeIntegrationObjective(
  text: string,
  maxWords: number,
  maxChars: number,
  toolId?: ToolId
): string {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hi|hello|hey|yo)\b[,\s]*/i, "")
    .replace(/^(can you|could you|would you|please)\b[,\s]*/i, "")
    .replace(/\b(can you|could you|would you)\b/g, "")
    .replace(/\bplease\b/g, "")
    .replace(/\bfor me\b/g, "")
    .replace(/\bthanks?\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();

  if (toolId === "gmail") {
    const recentEmailsMatch = normalized.match(
      /\b(?:my\s+)?(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:most\s+recent|latest|recent|newest)\s+emails?\b/
    );
    if (recentEmailsMatch) {
      const count = recentEmailsMatch[1];
      if (count) {
        return `tell me what my ${count} most recent emails are`;
      }
      return "tell me what my most recent emails are";
    }
  }

  const words = normalized
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, maxWords);

  const compact = words.join(" ").slice(0, maxChars).trim();
  return compact || "complete the requested task";
}

function fallbackBrowserQuery(userRequest: string): string {
  const normalized = normalizeBrowserQueryText(userRequest);
  if (!normalized) {
    return "complete the requested task";
  }
  return normalized.slice(0, 200);
}

async function refineBrowserQueryWithGemini(
  ai: GoogleGenAI,
  userRequest: string,
  intent: IntentResult["intent"],
  toolId: ToolId,
  historyContext?: string
): Promise<string> {
  const fallback = fallbackBrowserQuery(userRequest);
  const generateContent = ai?.models?.generateContent;
  if (typeof generateContent !== "function") {
    return fallback;
  }

  try {
    const contextSection = historyContext
      ? `[Conversation history]\n${historyContext}\n\n`
      : "";
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${BROWSER_QUERY_REFINEMENT_SYSTEM_PROMPT}\n\n` +
        `${contextSection}` +
        `Intent: ${intent}\n` +
        `Tool: ${toolId}\n` +
        `User request: ${userRequest}`,
      config: { responseMimeType: "application/json" },
    });
    const responseText = response.text;
    if (!responseText) {
      return fallback;
    }

    let parsed: { query?: unknown; objective?: unknown };
    try {
      parsed = JSON.parse(responseText) as { query?: unknown; objective?: unknown };
    } catch {
      return fallback;
    }

    const candidate =
      (typeof parsed.query === "string" && parsed.query) ||
      (typeof parsed.objective === "string" && parsed.objective) ||
      "";
    const normalized = normalizeBrowserQueryText(candidate).slice(0, 220);
    return normalized || fallback;
  } catch (err) {
    console.error("[Orchestrator] Browser query refinement failed:", err);
    return fallback;
  }
}

function detectExplicitIntegrationTool(userRequest: string): ToolId | null {
  const text = userRequest.toLowerCase();
  let bestMatch: { toolId: ToolId; score: number } | null = null;

  for (const toolId of INTEGRATION_TOOL_IDS) {
    const defaultTerm = toolId.replace(/_/g, " ");
    const terms = PROVIDER_DETECTION_TERMS[toolId] ?? [defaultTerm];

    for (const rawTerm of terms) {
      const term = rawTerm.trim().toLowerCase();
      if (!term || !new RegExp(`\\b${escapeRegex(term)}\\b`, "i").test(text)) {
        continue;
      }

      const score = term.length;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { toolId, score };
      }
    }
  }

  return bestMatch?.toolId ?? null;
}

function tryParseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseToolSelectionResponse(rawText: string): unknown {
  const direct = tryParseJsonObject(rawText);
  if (direct) {
    return direct;
  }

  const firstJsonObject = extractFirstJsonObject(rawText);
  if (!firstJsonObject) {
    return null;
  }

  return tryParseJsonObject(firstJsonObject);
}

function buildFallbackSelection(
  intent: IntentResult["intent"],
  userRequest: string
): ToolSelectionResult {
  const explicitIntegrationTool = detectExplicitIntegrationTool(userRequest);
  if (explicitIntegrationTool) {
    return {
      toolId: explicitIntegrationTool,
      confidence: 0.8,
      reason: `explicit provider mapping to ${explicitIntegrationTool}`,
      integrationInstruction: buildIntegrationInstructionForTool(
        explicitIntegrationTool,
        userRequest
      ),
    };
  }

  const fallback = fallbackToolFromIntent(intent);
  return {
    ...fallback,
    integrationInstruction: buildIntegrationInstructionForTool(fallback.toolId, userRequest),
  };
}

export async function selectToolWithGemini(
  ai: GoogleGenAI,
  userRequest: string,
  intent: IntentResult["intent"]
): Promise<ToolSelectionResult> {
  const fallback = buildFallbackSelection(intent, userRequest);
  const generateContent = ai?.models?.generateContent;
  if (typeof generateContent !== "function") {
    return fallback;
  }

  try {
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${TOOL_SELECTION_SYSTEM_PROMPT}\n\n` +
        `Detected intent: ${intent}\n` +
        `User request: ${userRequest}`,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) {
      return fallback;
    }

    const parsed = parseToolSelectionResponse(text);
    if (!parsed) {
      return fallback;
    }

    const selectedResult = TOOL_SELECTION_SCHEMA.safeParse(parsed);
    if (!selectedResult.success) {
      return fallback;
    }
    const selected = selectedResult.data;
    const explicitIntegrationTool = detectExplicitIntegrationTool(userRequest);
    const finalToolId =
      explicitIntegrationTool && selected.toolId !== explicitIntegrationTool
        ? explicitIntegrationTool
        : selected.toolId;
    const finalReason =
      explicitIntegrationTool && selected.toolId !== explicitIntegrationTool
        ? `explicit provider mapping to ${explicitIntegrationTool}; ${selected.reason}`.slice(0, 240)
        : selected.reason;

    const integrationInstruction = buildIntegrationInstructionForTool(
      finalToolId,
      userRequest,
      selected.integrationInstruction
    );
    return {
      toolId: finalToolId,
      confidence: selected.confidence,
      reason: finalReason,
      integrationInstruction,
    };
  } catch (err) {
    console.error("[Orchestrator] Tool selection failed:", err);
    return fallback;
  }
}

function resolveExecutionIntent(
  selectedToolId: ToolId,
  classifiedIntent: IntentResult["intent"]
): IntentResult["intent"] {
  if (selectedToolId === "web_extract") {
    return "web_extract";
  }
  if (selectedToolId === "multi_site_compare") {
    return "multi_site_compare";
  }

  // If we chose an integration tool, force browser adapter paths instead of native extract/compare prompts.
  if (INTEGRATION_TOOL_IDS.has(selectedToolId)) {
    return classifiedIntent === "form_fill_draft" ? "form_fill_draft" : "search";
  }

  return classifiedIntent;
}

export async function refineOutputWithGemini(
  ai: GoogleGenAI,
  userRequest: string,
  rawOutput: string,
  historyContext?: string
): Promise<string> {
  const fallback = toCoreNarrationText(rawOutput);
  const generateContent = ai?.models?.generateContent;

  if (typeof generateContent !== "function") {
    return fallback;
  }

  try {
    const contextSection = historyContext
      ? `[Conversation history]\n${historyContext}\n\n`
      : "";
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${OUTPUT_REFINEMENT_SYSTEM_PROMPT}\n\n` +
        `${contextSection}` +
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

    return normalized;
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveDeps(maybeDeps: TranscriptFinalOverrideDeps | undefined): TranscriptFinalDeps {
  return {
    classify: maybeDeps?.classify ?? maybeDeps?.classifyIntent ?? defaultDeps.classify,
    narrate: maybeDeps?.narrate ?? defaultDeps.narrate,
    createBrowserAdapter:
      maybeDeps?.createBrowserAdapter ?? defaultDeps.createBrowserAdapter,
    selectTool: maybeDeps?.selectTool ?? defaultDeps.selectTool,
    refineOutput: maybeDeps?.refineOutput ?? defaultDeps.refineOutput,
    refineBrowserQuery: maybeDeps?.refineBrowserQuery ?? defaultDeps.refineBrowserQuery,
    browserApiKey: maybeDeps?.browserApiKey ?? defaultDeps.browserApiKey,
    browserApiKeySource:
      maybeDeps?.browserApiKeySource ?? defaultDeps.browserApiKeySource,
  };
}

export async function handleTranscriptFinal(
  session: Orchestratable,
  ai: GoogleGenAI,
  apiKey: string,
  text: string,
  history?: ConversationHistory,
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

  const historyContext = history ? buildHistoryContext(history) : "";

  try {
    session.setState("thinking");

    const classified = await deps.classify(ai, text, historyContext || undefined);
    const result: IntentResult =
      classified.intent === "clarify"
        ? {
            ...classified,
            intent: "search",
            confidence: Math.max(classified.confidence, 0.51),
            query: classified.query || text,
            clarification: undefined,
          }
        : classified;
    session.send({ type: "intent", intent: result });
    if (classified.intent === "clarify") {
      session.send({
        type: "action_status",
        message: "Intent was ambiguous; proceeding proactively with best-effort execution.",
      });
    }

    if (result.intent === "quick_answer") {
      const answer = result.answer || "I'm not sure how to answer that.";
      session.setState("speaking");
      await deps.narrate(session, answer, apiKey);
      if (history) {
        history.recentTurns.push({ transcript: text, response: answer });
        await maybeCompactHistory(ai, history);
      }
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

    // Tool Guide: determine optimal execution strategy
    const toolPlan = await generateToolPlan(ai, text, result.intent, historyContext || undefined);
    console.log(`[ToolGuide] Strategy: ${toolPlan.strategy}, integrations: [${toolPlan.integrations.join(", ")}]`);
    session.send({
      type: "action_status",
      message: toolPlan.integrations.length
        ? `Using ${toolPlan.integrations.join(", ")} → ${toolPlan.reasoning}`
        : toolPlan.reasoning,
    });


    session.setState("acting");

    const statusCb = {
      onStatus: (msg: string) => session.send({ type: "action_status", message: msg }),
    };

    // Use enhanced prompt from tool guide when available
    const taskQuery = toolPlan.enhanced_prompt || text;

    let output: string;
    const browser = deps.createBrowserAdapter(deps.browserApiKey);
    session.setBrowserAdapter(browser);

    if (result.intent === "web_extract" || result.intent === "multi_site_compare") {
      try {
        const toolResult = await runTool(
          result.intent,
          {
            query: taskQuery,
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
      try {
        if (result.intent === "search") {
          output = await browser.runSearch(taskQuery, statusCb);
        } else {
          output = await browser.runFormFillDraft(taskQuery, statusCb, {
            allowSubmit: env.ALLOW_FINAL_FORM_SUBMISSION,
          });
        }
      } catch (err) {
        console.error("[Orchestrator] Browser error:", err);
        output = "Browser task failed. " + (err instanceof Error ? err.message : "");
      }
    }

    session.setBrowserAdapter(null);
    session.setState("speaking");
    const refinedOutput = await deps.refineOutput(ai, text, output, historyContext || undefined);
    await deps.narrate(session, refinedOutput, apiKey);

    // Append this turn to history and compact if needed
    if (history) {
      history.recentTurns.push({ transcript: text, response: refinedOutput });
      await maybeCompactHistory(ai, history);
    }

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
