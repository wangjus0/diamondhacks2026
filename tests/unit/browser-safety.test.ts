import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserAdapter,
  buildIntegrationFormFillDraftTaskPrompt,
  buildIntegrationSearchTaskPrompt,
  buildIntegrationSystemPromptExtension,
  chooseSkillIdsForIntegration,
  buildFormFillDraftTaskPrompt,
  buildSearchTaskPrompt,
  getSkillTermsForTool,
  rankSkillsForTool,
  shouldFallbackFromProfileSessionError,
} from "../../apps/server/src/tools/browser/adapter.ts";

test("search task prompt stays focused on read-only retrieval", () => {
  const prompt = buildSearchTaskPrompt("best tacos in san jose");

  assert.match(prompt, /use concise keyword searches/i);
  assert.match(prompt, /do not paste the full user utterance verbatim/i);
  assert.match(prompt, /supporting points and source URLs/i);
  assert.doesNotMatch(prompt, /top\s*5/i);
  assert.match(prompt, /do not .*submit/i);
  assert.match(prompt, /do not .*checkout/i);
});

test("integration-first search prompt avoids forced google search", () => {
  const prompt = buildSearchTaskPrompt("summarize my unread emails", {
    preferredToolId: "gmail",
    forceIntegration: true,
    integrationInstruction: "Use the gmail integration unread urgent emails",
  });

  assert.doesNotMatch(prompt, /google\.com/i);
  assert.match(prompt, /Can you use the gmail integration and\s*unread urgent emails/i);
  assert.match(prompt, /\.$/);
});

test("auto-integration search prompt avoids forced google search when no specific tool is pinned", () => {
  const prompt = buildSearchTaskPrompt("check my latest email updates", {
    forceIntegration: true,
    integrationInstruction: "Use the gmail integration to: check latest email updates",
  });

  assert.doesNotMatch(prompt, /google\.com/i);
  assert.match(prompt, /Can you use the best available connected integration and/i);
  assert.match(prompt, /\.$/);
});

test("integration prompt uses concise objective and avoids verbatim user request echo", () => {
  const verboseQuery =
    "Hi, can you check my Gmail inbox for my three most recent emails please?";
  const prompt = buildSearchTaskPrompt(verboseQuery, {
    preferredToolId: "gmail",
    forceIntegration: true,
  });

  assert.match(
    prompt,
    /Can you use the gmail integration and tell me what my three most recent emails are/i
  );
  assert.doesNotMatch(prompt, /User request:/i);
  assert.doesNotMatch(prompt, /Hi,\s*can you check my Gmail inbox/i);
});

test("form fill draft prompt explicitly blocks dangerous actions", () => {
  const prompt = buildFormFillDraftTaskPrompt("fill out a contact form");

  assert.match(prompt, /Do NOT submit the form\./i);
  assert.match(prompt, /Do NOT click any submit, pay, checkout, or confirmation buttons\./i);
  assert.match(prompt, /Report which fields were filled and with what values\./i);
});

test("form fill prompt can allow submit when enabled", () => {
  const prompt = buildFormFillDraftTaskPrompt("fill and submit this form", {
    allowSubmit: true,
  });

  assert.match(prompt, /If the user explicitly asked to submit, submit the form once/i);
  assert.match(prompt, /Never perform payment, checkout, or purchase actions\./i);
});

test("integration-first form prompt includes integration and safety constraints", () => {
  const prompt = buildFormFillDraftTaskPrompt("create a draft invoice", {
    preferredToolId: "stripe",
    forceIntegration: true,
    allowSubmit: false,
    integrationInstruction: "Use the stripe integration invoice draft creation",
  });

  assert.match(prompt, /Can you use the stripe integration and\s*invoice draft creation/i);
  assert.doesNotMatch(prompt, /navigate to google\.com/i);
});

test("getSkillTermsForTool uses integration-specific terms", () => {
  assert.deepEqual(getSkillTermsForTool("google_drive"), ["google drive"]);
  assert.deepEqual(getSkillTermsForTool("jira"), ["jira", "atlassian"]);
});

test("rankSkillsForTool prioritizes matching integration skills", () => {
  const skills = [
    {
      id: "skill-gmail",
      title: "Gmail Inbox Summarizer",
      description: "Read latest emails from Gmail",
      slug: "gmail-inbox-summarizer",
      goal: "",
      categories: ["integration"],
    },
    {
      id: "skill-notion",
      title: "Notion Page Writer",
      description: "Create docs in Notion",
      slug: "notion-page-writer",
      goal: "",
      categories: ["integration"],
    },
  ];

  const ranked = rankSkillsForTool(skills, "gmail", getSkillTermsForTool("gmail"));

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "skill-gmail");
});

test("buildIntegrationSystemPromptExtension only applies to known integrations", () => {
  const prompt = buildIntegrationSystemPromptExtension("gmail");
  assert.equal(typeof prompt, "string");
  assert.match(prompt ?? "", /oauth-connected account/i);

  assert.equal(buildIntegrationSystemPromptExtension("browser_use"), null);
});

test("chooseSkillIdsForIntegration falls back to wildcard when forced and unmatched", () => {
  assert.deepEqual(chooseSkillIdsForIntegration([], true), {
    skillIds: ["*"],
    mode: "wildcard",
  });
  assert.deepEqual(chooseSkillIdsForIntegration([], false), {
    skillIds: [],
    mode: "none",
  });
  assert.deepEqual(chooseSkillIdsForIntegration(["a", "b"], true), {
    skillIds: ["a", "b"],
    mode: "matched",
  });
});

test("integration prompt helpers are explicit and concise", () => {
  const search = buildIntegrationSearchTaskPrompt("find urgent emails", "gmail");
  const draft = buildIntegrationFormFillDraftTaskPrompt("update issue", "jira", {
    allowSubmit: true,
  });

  assert.match(search, /Can you use the gmail integration and\s*find urgent emails/i);
  assert.match(search, /\.$/);
  assert.match(draft, /Can you use the jira integration and\s*update issue/i);
  assert.match(draft, /\.$/);
});

test("shouldFallbackFromProfileSessionError detects concurrent session quota failures", () => {
  const concurrentLimitError = new Error(
    "Failed to create Browser Use session for profile xyz. HTTP 429: Free plan limit: 3 concurrent sessions reached."
  );
  assert.equal(shouldFallbackFromProfileSessionError(concurrentLimitError), true);
  assert.equal(shouldFallbackFromProfileSessionError("HTTP 429 concurrent sessions reached"), true);
  assert.equal(
    shouldFallbackFromProfileSessionError(
      "HTTP 429: Free tier allows up to 3 concurrent sessions across all projects."
    ),
    true
  );
  assert.equal(
    shouldFallbackFromProfileSessionError(new Error("HTTP 401 unauthorized")),
    false
  );
});

test("v3 runSearch with forceIntegration sends integration-focused task to /sessions endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let sessionCreateCalled = false;
  let capturedTaskBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "POST" && url.includes("/sessions")) {
      sessionCreateCalled = true;
      capturedTaskBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "sess_v3_test" }), { status: 200 });
    }

    if (method === "GET" && url.includes("/sessions/sess_v3_test")) {
      return new Response(
        JSON.stringify({ status: "stopped", output: "Gmail integration: 3 recent emails found." }),
        { status: 200 }
      );
    }

    if (method === "DELETE") {
      return new Response(null, { status: 200 });
    }

    throw new Error(`Unexpected fetch call: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const adapter = new BrowserAdapter("bu_test_integration_key");
    const output = await adapter.runSearch(
      "check unread emails",
      { onStatus: () => {} },
      { preferredToolId: "gmail", forceIntegration: true, strictIntegration: true }
    );

    assert.ok(sessionCreateCalled, "Should create session via POST /sessions");
    assert.ok(capturedTaskBody !== null);
    assert.match(String(capturedTaskBody?.task ?? ""), /gmail integration/i);
    assert.equal(capturedTaskBody?.skillIds, undefined, "v3 should not send skillIds");
    assert.match(output, /gmail integration/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v3 runSearch session body never contains skillIds or systemPromptExtension", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "POST" && url.includes("/sessions")) {
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "sess_v3_body" }), { status: 200 });
    }

    if (method === "GET" && url.includes("/sessions/sess_v3_body")) {
      return new Response(
        JSON.stringify({ status: "stopped", output: "Task complete." }),
        { status: 200 }
      );
    }

    if (method === "DELETE") {
      return new Response(null, { status: 200 });
    }

    throw new Error(`Unexpected fetch call: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const adapter = new BrowserAdapter("bu_test_integration_key");
    await adapter.runSearch(
      "check unread emails",
      { onStatus: () => {} },
      { preferredToolId: "gmail", forceIntegration: true, strictIntegration: true }
    );

    assert.ok(capturedBody !== null);
    assert.equal(typeof capturedBody?.task, "string");
    assert.equal(capturedBody?.skillIds, undefined);
    assert.equal(capturedBody?.systemPromptExtension, undefined);
    assert.equal(capturedBody?.session_id, undefined);
    assert.equal(capturedBody?.sessionId, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
