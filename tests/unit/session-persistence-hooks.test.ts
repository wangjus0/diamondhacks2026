import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import type {
  SessionPersistence,
  FinishSessionInput,
  StartSessionInput,
  TranscriptFinalInput,
  ActionEventInput,
  NarrationTextInput,
} from "../../apps/server/src/persistence/session-persistence.ts";

class MockWebSocket extends EventEmitter {
  readyState = 1;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
}

interface PersistenceCalls {
  start: StartSessionInput[];
  transcript: TranscriptFinalInput[];
  action: ActionEventInput[];
  narration: NarrationTextInput[];
  finish: FinishSessionInput[];
}

function createMockPersistence(): {
  persistence: SessionPersistence;
  calls: PersistenceCalls;
} {
  const calls: PersistenceCalls = {
    start: [],
    transcript: [],
    action: [],
    narration: [],
    finish: [],
  };

  const persistence: SessionPersistence = {
    async startSession(input) {
      calls.start.push(input);
    },
    async appendTranscriptFinal(input) {
      calls.transcript.push(input);
    },
    async appendActionEvent(input) {
      calls.action.push(input);
    },
    async appendNarrationText(input) {
      calls.narration.push(input);
    },
    async finishSession(input) {
      calls.finish.push(input);
    },
    async listSessions() {
      return [];
    },
    async getSessionReplay() {
      return null;
    },
  };

  return { persistence, calls };
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function createSession(
  ws: MockWebSocket,
  persistence: SessionPersistence
) {
  process.env.ELEVEN_LABS_API_KEY = "test-eleven-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

  const { Session } = await import("../../apps/server/src/ws/session.ts");
  return new Session(ws as never, {} as never, persistence);
}

test("session persists start + outgoing events and finalizes on done", async () => {
  const ws = new MockWebSocket();
  const { persistence, calls } = createMockPersistence();
  const session = await createSession(ws, persistence);

  ws.emit("message", JSON.stringify({ type: "start_session" }));
  session.send({ type: "transcript_final", text: "hello world" });
  session.send({ type: "action_status", message: "searching for coffee" });
  session.send({ type: "narration_text", text: "I am searching now." });
  session.send({ type: "done" });
  ws.emit("close");

  await flushAsyncWork();

  assert.equal(calls.start.length, 1);
  assert.equal(calls.start[0]?.sessionId, session.id);

  assert.equal(calls.transcript.length, 1);
  assert.equal(calls.transcript[0]?.text, "hello world");

  assert.equal(calls.action.length, 1);
  assert.equal(calls.action[0]?.status, "running");
  assert.equal(calls.action[0]?.step, "searching for coffee");

  assert.equal(calls.narration.length, 1);
  assert.equal(calls.narration[0]?.text, "I am searching now.");
  assert.equal(calls.narration[0]?.sequence, 0);

  assert.equal(calls.finish.length, 1);
  assert.equal(calls.finish[0]?.status, "completed");
});

test("interrupt finalizes run as interrupted", async () => {
  const ws = new MockWebSocket();
  const { persistence, calls } = createMockPersistence();
  const session = await createSession(ws, persistence);

  ws.emit("message", JSON.stringify({ type: "start_session" }));
  ws.emit("message", JSON.stringify({ type: "interrupt" }));

  await flushAsyncWork();

  assert.equal(calls.finish.length, 1);
  assert.equal(calls.finish[0]?.sessionId, session.id);
  assert.equal(calls.finish[0]?.status, "interrupted");
});

test("error finalizes run as errored with message", async () => {
  const ws = new MockWebSocket();
  const { persistence, calls } = createMockPersistence();
  const session = await createSession(ws, persistence);

  ws.emit("message", JSON.stringify({ type: "start_session" }));
  session.send({ type: "error", message: "Something failed" });

  await flushAsyncWork();

  assert.equal(calls.finish.length, 1);
  assert.equal(calls.finish[0]?.status, "errored");
  assert.equal(calls.finish[0]?.errorMessage, "Something failed");
});

test("close finalizes run as disconnected when no terminal event happened", async () => {
  const ws = new MockWebSocket();
  const { persistence, calls } = createMockPersistence();
  const session = await createSession(ws, persistence);

  ws.emit("message", JSON.stringify({ type: "start_session" }));
  ws.emit("close");

  await flushAsyncWork();

  assert.equal(calls.finish.length, 1);
  assert.equal(calls.finish[0]?.sessionId, session.id);
  assert.equal(calls.finish[0]?.status, "disconnected");
});

test("session disables Supabase persistence after missing-table error", async () => {
  const ws = new MockWebSocket();
  let startCalls = 0;

  const persistence: SessionPersistence = {
    async startSession() {
      startCalls += 1;
      throw new Error(
        "Supabase request failed (POST session_runs): 404 {\"code\":\"PGRST205\",\"message\":\"Could not find the table 'public.session_runs' in the schema cache\"}"
      );
    },
    async appendTranscriptFinal() {},
    async appendActionEvent() {},
    async appendNarrationText() {},
    async finishSession() {},
    async listSessions() {
      return [];
    },
    async getSessionReplay() {
      return null;
    },
  };

  await createSession(ws, persistence);

  ws.emit("message", JSON.stringify({ type: "start_session" }));
  await flushAsyncWork();
  ws.emit("message", JSON.stringify({ type: "start_session" }));
  await flushAsyncWork();

  assert.equal(startCalls, 1);
});
