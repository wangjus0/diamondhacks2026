import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { IntentResult } from "@murmur/shared";

const intentResultSchema = z.object({
  intent: z.enum(["search", "form_fill_draft", "clarify", "web_extract", "multi_site_compare"]),
  confidence: z.number().min(0).max(1),
  query: z.string(),
  clarification: z.string().optional(),
});

const SYSTEM_PROMPT = `You are an intent classifier for a voice-controlled browser agent.
Classify the user's speech into exactly ONE of these intents:

- "search": The user wants to search for information on the web (e.g. "search for restaurants near me", "look up the weather", "find cheap flights to LA")
- "form_fill_draft": The user wants to fill out a form on a website (e.g. "fill out the contact form", "sign up for the newsletter", "enter my shipping address"). This is draft only - never submit.
- "web_extract": The user wants to read, extract, or summarize content from a specific webpage (e.g. "read this page", "summarize that article", "what does this site say about X")
- "multi_site_compare": The user wants to compare information across multiple websites (e.g. "compare prices on Amazon vs Best Buy", "which site has better reviews for X", "compare X across sites")
- "clarify": The intent is unclear or ambiguous and you need more information.

Respond with JSON only:
{
  "intent": "search" | "form_fill_draft" | "web_extract" | "multi_site_compare" | "clarify",
  "confidence": 0.0 to 1.0,
  "query": "a concise, direct instruction for the browser layer",
  "clarification": "optional question to ask if intent is clarify"
}

Query rewrite rules:
- Rewrite the user's request into short, concrete task language.
- Remove filler phrases (e.g. "can you", "please", "I want you to").
- Do not copy the full utterance verbatim unless absolutely necessary.
- Keep all important constraints and entities (dates, places, products, names).
- For "clarify", query can stay close to the original request.`;

const FALLBACK: IntentResult = {
  intent: "clarify",
  confidence: 0,
  query: "",
  clarification: "I didn't understand that. Could you try rephrasing?",
};

export async function classifyIntent(
  ai: GoogleGenAI,
  transcript: string
): Promise<IntentResult> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${SYSTEM_PROMPT}\n\nUser said: "${transcript}"`,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) return { ...FALLBACK, query: transcript };

    const parsed = intentResultSchema.parse(JSON.parse(text));

    const rewrittenQuery = parsed.query.trim().length > 0 ? parsed.query.trim() : transcript;

    if (parsed.confidence < 0.6) {
      return {
        intent: "clarify",
        confidence: parsed.confidence,
        query: transcript,
        clarification:
          parsed.clarification || "I'm not sure what you meant. Could you rephrase?",
      };
    }

    return { ...parsed, query: rewrittenQuery };
  } catch (err) {
    console.error("[Intent] Classification failed:", err);
    return { ...FALLBACK, query: transcript };
  }
}
