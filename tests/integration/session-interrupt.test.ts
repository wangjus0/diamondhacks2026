import assert from "node:assert/strict";
import test from "node:test";

process.env.ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY ?? "test-elevenlabs";
process.env.BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY ?? "test-browser-use";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "test-gemini";

type Listener = (...args: unknown[]) => void;

class MockWebSocket {
  readyState = 1;
  readonly sentMessages: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): void {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(listener);
    this.listeners.set(event, bucket);
  }

  send(payload: string): void {
    this.sentMessages.push(payload);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

test("interrupt event cancels the active browser execution and returns idle", async () => {
  const { Session } = await import("../../apps/server/src/ws/session.ts");

  const ws = new MockWebSocket();
  const session = new Session(ws as never, {} as never);

  let cancelled = false;
  session.setBrowserAdapter({
    cancel: () => {
      cancelled = true;
      return Promise.resolve();
    },
  } as never);

  ws.emit("message", JSON.stringify({ type: "interrupt" }));

  assert.equal(cancelled, true);

  const emittedEvents = ws.sentMessages.map(
    (raw) => JSON.parse(raw) as { type: string; state?: string }
  );
  assert.deepEqual(emittedEvents.at(-1), { type: "state", state: "idle" });
});
