/**
 * Live validation script: runs the gmail "3 most recent emails" pipeline
 * against the browser-use v3 API (Composio) and verifies the output.
 *
 * Usage: node scripts/validate-gmail-pipeline.mjs
 */

const API_KEY = "bu_89iar4f2flwjyanqgVEC-vv5B3AeXBDLb_dRWZ6tLMg";
const PROFILE_ID = "2b965c08-396a-4dea-8255-950b2df13c8a";
const BASE_URL = "https://api.browser-use.com/api/v3";
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 60; // 3 minutes max

// This is exactly what the orchestrator sends for a "3 most recent emails" request.
const TASK =
  "Can you use the gmail integration and tell me what my 3 most recent emails are. " +
  "For each email provide the sender name, subject line, and date received.";

async function createSession() {
  console.log(`\n[1] Creating v3 session (profile: ${PROFILE_ID})...`);
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ task: TASK, profile_id: PROFILE_ID }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Session create failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  if (!data.id) throw new Error(`No session id in response: ${JSON.stringify(data)}`);
  console.log(`    Session created: ${data.id} (model: ${data.model ?? "unknown"})`);
  return data.id;
}

async function pollUntilDone(sessionId) {
  console.log(`\n[2] Polling session ${sessionId}...`);
  let lastStepCount = 0;
  let lastStepSummary = "";

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`${BASE_URL}/sessions/${sessionId}`, {
      headers: { "X-Browser-Use-API-Key": API_KEY },
    });

    if (!res.ok) throw new Error(`Poll failed ${res.status}`);

    const data = await res.json();
    const stepCount = data.stepCount ?? 0;
    const summary = data.lastStepSummary ?? "";

    if (stepCount > lastStepCount || summary !== lastStepSummary) {
      if (summary && summary !== lastStepSummary) {
        console.log(`    Step ${stepCount}: ${summary.slice(0, 120)}`);
      }
      lastStepCount = stepCount;
      lastStepSummary = summary;
    }

    // v3 terminal statuses
    if (
      data.status === "stopped" ||
      data.status === "idle" ||
      data.status === "error" ||
      data.status === "timed_out"
    ) {
      console.log(`\n    Status: ${data.status} | isTaskSuccessful: ${data.isTaskSuccessful}`);
      return { status: data.status, output: data.output ?? "", isTaskSuccessful: data.isTaskSuccessful };
    }

    console.log(`    [${i + 1}/${MAX_POLLS}] Status: ${data.status}...`);
  }

  throw new Error("Timed out waiting for task completion");
}

async function stopSession(sessionId) {
  await fetch(`${BASE_URL}/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { "X-Browser-Use-API-Key": API_KEY },
  }).catch(() => {});
}

function validateOutput(output, isTaskSuccessful) {
  console.log(`\n[3] Raw output:\n${"─".repeat(60)}\n${output}\n${"─".repeat(60)}`);

  const issues = [];

  if (!isTaskSuccessful) {
    issues.push("isTaskSuccessful is false or null");
  }
  if (/integration.*unavail|unavail.*integration/i.test(output)) {
    issues.push("Output says integration is unavailable");
  }
  if (/not connected|connect your|composio/i.test(output)) {
    issues.push("Output says account is not connected to integration");
  }
  if (/password|log.?in|sign.?in|credentials/i.test(output)) {
    issues.push("Output mentions login/password (not authenticated)");
  }
  if (output.trim().length < 20) {
    issues.push("Output is too short to contain 3 email descriptions");
  }

  // Look for evidence of 3 emails
  const numberedItems = (output.match(/\b[1-9]\.|email\s*#?[1-9]|^[1-9]\)/gim) ?? []).length;
  const hasThreeItems = numberedItems >= 3 || detectThreeEmails(output);

  if (!hasThreeItems) {
    issues.push(`Could not detect 3 distinct emails in output (found ~${numberedItems} numbered items)`);
  }

  return issues;
}

function detectThreeEmails(text) {
  const subjectMatches = text.match(/subject|from:|sender|re:/gi) ?? [];
  const dateMatches =
    text.match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|today|yesterday|\d+\s*(hour|min|day|week)s?\s*ago)\b/gi
    ) ?? [];
  return subjectMatches.length >= 3 || dateMatches.length >= 3;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`ATTEMPT ${attempt}/${MAX_ATTEMPTS} — browser-use v3 / Composio Gmail`);
    console.log(`${"=".repeat(60)}`);

    let sessionId = null;
    try {
      sessionId = await createSession();
      const { status, output, isTaskSuccessful } = await pollUntilDone(sessionId);
      const issues = validateOutput(output, isTaskSuccessful);

      if (issues.length === 0) {
        console.log(`\n✅ PASS — Composio Gmail returned 3 emails successfully.`);
        return;
      }

      console.log(`\n❌ FAIL — Issues found:`);
      for (const issue of issues) {
        console.log(`  • ${issue}`);
      }

      if (attempt < MAX_ATTEMPTS) {
        console.log(`\nRetrying in 5s...`);
        await sleep(5000);
      }
    } catch (err) {
      console.error(`\n💥 Error on attempt ${attempt}:`, err.message);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`Retrying in 5s...`);
        await sleep(5000);
      }
    } finally {
      if (sessionId) await stopSession(sessionId);
    }
  }

  console.log(`\n❌ All ${MAX_ATTEMPTS} attempts failed.`);
  process.exit(1);
}

run();
