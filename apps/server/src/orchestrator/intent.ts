import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { IntentResult } from "@murmur/shared";

const intentResultSchema = z.object({
  intent: z.enum(["search", "form_fill_draft", "clarify", "web_extract", "multi_site_compare", "quick_answer"]),
  confidence: z.number().min(0).max(1),
  query: z.string(),
  clarification: z.string().optional(),
  answer: z.string().optional(),
});

const SYSTEM_PROMPT = `You are an intent classifier for a voice-controlled browser agent.
Classify the user's speech into exactly ONE of these intents:

- "quick_answer": The user is asking something you can answer directly from your own knowledge WITHOUT browsing the web. Examples: jokes, trivia, math, definitions, conversational questions ("tell me a joke", "what is 25 times 4", "explain photosynthesis", "how are you"). Provide the answer directly in the "answer" field.
- "search": The user wants to search for information on the web (e.g. "search for restaurants near me", "look up the weather", "find cheap flights to LA")
- "form_fill_draft": The user wants to fill out a form on a website (e.g. "fill out the contact form", "sign up for the newsletter", "enter my shipping address"). This is draft only - never submit.
- "web_extract": The user wants to read, extract, or summarize content from a specific webpage (e.g. "read this page", "summarize that article", "what does this site say about X")
- "multi_site_compare": The user wants to compare information across multiple websites (e.g. "compare prices on Amazon vs Best Buy", "which site has better reviews for X", "compare X across sites")
- "clarify": The intent is truly impossible to infer. Use this only as a last resort.

Respond with JSON only:
{
  "intent": "quick_answer" | "search" | "form_fill_draft" | "clarify",
  "confidence": 0.0 to 1.0,
  "query": "the original user text",
  "clarification": "optional question to ask if intent is clarify",
  "answer": "direct answer if intent is quick_answer"
}`;

const FALLBACK: IntentResult = {
  intent: "search",
  confidence: 0.5,
  query: "",
};

function inferIntentFromTranscript(transcript: string): IntentResult["intent"] {
  const text = transcript.toLowerCase();

  const compareSignals =
    /\b(compare|comparison|versus|vs\.?|better than|difference between)\b/.test(text) &&
    /\b(and|vs|versus|between)\b/.test(text);
  if (compareSignals) {
    return "multi_site_compare";
  }

  const webExtractSignals =
    /\b(read|extract|summarize|summary|what does this page say|from this page|on this page)\b/.test(
      text
    ) && /(https?:\/\/|website|webpage|page|site)/.test(text);
  if (webExtractSignals) {
    return "web_extract";
  }

  const formSignals =
    /\b(fill|form|sign up|signup|register|apply|enter my|submit application|contact form)\b/.test(
      text
    );
  if (formSignals) {
    return "form_fill_draft";
  }

  return "search";
}

export async function classifyIntent(
  ai: GoogleGenAI,
  transcript: string,
  historyContext?: string
): Promise<IntentResult> {
  try {
    const contextPrefix = historyContext
      ? `[Conversation history]\n${historyContext}\n\n`
      : "";
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${SYSTEM_PROMPT}\n\n${contextPrefix}User said: "${transcript}"`,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) {
      return {
        ...FALLBACK,
        intent: inferIntentFromTranscript(transcript),
        query: transcript,
      };
    }

    const parsed = intentResultSchema.parse(JSON.parse(text));
    const inferredIntent = inferIntentFromTranscript(transcript);
    const normalizedIntent =
      parsed.intent === "clarify" ? inferredIntent : parsed.intent;

    if (parsed.confidence < 0.6) {
      return {
        intent: normalizedIntent,
        confidence: Math.max(parsed.confidence, 0.51),
        query: transcript,
      };
    }

    return { ...parsed, intent: normalizedIntent, query: transcript };
  } catch (err) {
    console.error("[Intent] Classification failed:", err);
    return {
      ...FALLBACK,
      intent: inferIntentFromTranscript(transcript),
      query: transcript,
    };
  }
}
