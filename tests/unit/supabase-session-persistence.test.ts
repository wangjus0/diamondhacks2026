import test from "node:test";
import assert from "node:assert/strict";

import { SupabaseSessionPersistence } from "../../apps/server/src/persistence/supabase-session-persistence.ts";

interface FetchCall {
  url: URL;
  init: RequestInit;
}

function createFetchMock(responses: Response[]): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];

  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push({ url, init });

    const response = responses.shift();
    if (!response) {
      throw new Error("No mock response available.");
    }

    return response;
  };

  return { fetchImpl, calls };
}

test("startSession upserts an active session run", async () => {
  const { fetchImpl, calls } = createFetchMock([new Response(null, { status: 201 })]);
  const persistence = new SupabaseSessionPersistence("https://example.supabase.co", "service-role-key", {
    fetchImpl,
  });

  await persistence.startSession({
    sessionId: "session-123",
    startedAt: "2026-04-04T20:00:00.000Z",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(calls[0]?.url.pathname, "/rest/v1/session_runs");
  assert.equal(calls[0]?.url.searchParams.get("on_conflict"), "session_id");

  const payload = JSON.parse(String(calls[0]?.init.body));
  assert.deepEqual(payload, {
    session_id: "session-123",
    started_at: "2026-04-04T20:00:00.000Z",
    ended_at: null,
    status: "active",
    error_message: null,
  });
});

test("append and finish methods write to expected tables", async () => {
  const { fetchImpl, calls } = createFetchMock([
    new Response(null, { status: 201 }),
    new Response(null, { status: 201 }),
    new Response(null, { status: 201 }),
    new Response(null, { status: 204 }),
  ]);

  const persistence = new SupabaseSessionPersistence("https://example.supabase.co", "service-role-key", {
    fetchImpl,
  });

  await persistence.appendTranscriptFinal({ sessionId: "session-1", text: "hello" });
  await persistence.appendActionEvent({
    sessionId: "session-1",
    status: "running",
    step: "Open website",
    detail: "example.org",
  });
  await persistence.appendNarrationText({
    sessionId: "session-1",
    text: "I am opening the website.",
    sequence: 1,
  });
  await persistence.finishSession({
    sessionId: "session-1",
    status: "completed",
    endedAt: "2026-04-04T20:10:00.000Z",
  });

  assert.equal(calls[0]?.url.pathname, "/rest/v1/session_transcripts");
  assert.equal(calls[1]?.url.pathname, "/rest/v1/session_action_events");
  assert.equal(calls[2]?.url.pathname, "/rest/v1/session_narration_events");
  assert.equal(calls[3]?.url.pathname, "/rest/v1/session_runs");
  assert.equal(calls[3]?.url.searchParams.get("session_id"), "eq.session-1");

  const finishPayload = JSON.parse(String(calls[3]?.init.body));
  assert.equal(finishPayload.status, "completed");
  assert.equal(finishPayload.ended_at, "2026-04-04T20:10:00.000Z");
});

test("getSessionReplay returns mapped session with ordered arrays", async () => {
  const { fetchImpl } = createFetchMock([
    new Response(
      JSON.stringify([
        {
          session_id: "session-abc",
          started_at: "2026-04-04T20:00:00.000Z",
          ended_at: "2026-04-04T20:05:00.000Z",
          status: "completed",
          error_message: null,
          created_at: "2026-04-04T20:00:00.000Z",
          updated_at: "2026-04-04T20:05:00.000Z",
        },
      ]),
      { status: 200 }
    ),
    new Response(
      JSON.stringify([
        {
          id: "t1",
          session_id: "session-abc",
          text: "find coffee near me",
          created_at: "2026-04-04T20:01:00.000Z",
        },
      ]),
      { status: 200 }
    ),
    new Response(
      JSON.stringify([
        {
          id: "a1",
          session_id: "session-abc",
          status: "running",
          step: "searching",
          detail: "maps",
          created_at: "2026-04-04T20:02:00.000Z",
        },
      ]),
      { status: 200 }
    ),
    new Response(
      JSON.stringify([
        {
          id: "n1",
          session_id: "session-abc",
          text: "I found a few options.",
          sequence: 0,
          created_at: "2026-04-04T20:03:00.000Z",
        },
      ]),
      { status: 200 }
    ),
  ]);

  const persistence = new SupabaseSessionPersistence("https://example.supabase.co", "service-role-key", {
    fetchImpl,
  });

  const replay = await persistence.getSessionReplay("session-abc");

  assert.ok(replay);
  assert.equal(replay?.session.sessionId, "session-abc");
  assert.equal(replay?.transcripts[0]?.text, "find coffee near me");
  assert.equal(replay?.actions[0]?.step, "searching");
  assert.equal(replay?.narration[0]?.sequence, 0);
});
