import test from "node:test";
import assert from "node:assert/strict";
import type { Express } from "express";

import { registerReplayRoutes } from "../../apps/server/src/http/replay-routes.ts";
import type { SessionPersistence } from "../../apps/server/src/persistence/session-persistence.ts";

type RouteHandler = (req: any, res: any) => void | Promise<void>;

function createPersistenceMock(): Pick<SessionPersistence, "listSessions" | "getSessionReplay"> {
  return {
    async listSessions(limit) {
      return [
        {
          sessionId: "session-1",
          userId: "11111111-1111-4111-8111-111111111111",
          startedAt: "2026-04-04T20:00:00.000Z",
          endedAt: null,
          status: "active",
          errorMessage: null,
          createdAt: "2026-04-04T20:00:00.000Z",
          updatedAt: "2026-04-04T20:00:00.000Z",
        },
      ].slice(0, limit);
    },
    async getSessionReplay(sessionId) {
      if (sessionId !== "session-1") {
        return null;
      }

      return {
        session: {
          sessionId: "session-1",
          userId: "11111111-1111-4111-8111-111111111111",
          startedAt: "2026-04-04T20:00:00.000Z",
          endedAt: "2026-04-04T20:03:00.000Z",
          status: "completed",
          errorMessage: null,
          createdAt: "2026-04-04T20:00:00.000Z",
          updatedAt: "2026-04-04T20:03:00.000Z",
        },
        transcripts: [
          {
            id: "t1",
            sessionId: "session-1",
            text: "find pizza",
            createdAt: "2026-04-04T20:01:00.000Z",
          },
        ],
        actions: [
          {
            id: "a1",
            sessionId: "session-1",
            status: "running",
            step: "search",
            detail: null,
            createdAt: "2026-04-04T20:02:00.000Z",
          },
        ],
        narration: [
          {
            id: "n1",
            sessionId: "session-1",
            text: "I found results.",
            sequence: 0,
            createdAt: "2026-04-04T20:03:00.000Z",
          },
        ],
      };
    },
  };
}

function createRouteHarness() {
  const handlers = new Map<string, RouteHandler>();
  const app = {
    get(path: string, handler: RouteHandler) {
      handlers.set(path, handler);
      return this;
    },
  } as unknown as Express;

  registerReplayRoutes(app, createPersistenceMock());
  return handlers;
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

test("GET /api/sessions returns sessions with requested limit", async () => {
  const handlers = createRouteHarness();
  const listHandler = handlers.get("/api/sessions");
  assert.ok(listHandler);

  const response = createResponseRecorder();
  await listHandler(
    {
      query: { limit: "1" },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    sessions: [
      {
        sessionId: "session-1",
        userId: "11111111-1111-4111-8111-111111111111",
        startedAt: "2026-04-04T20:00:00.000Z",
        endedAt: null,
        status: "active",
        errorMessage: null,
        createdAt: "2026-04-04T20:00:00.000Z",
        updatedAt: "2026-04-04T20:00:00.000Z",
      },
    ],
  });
});

test("GET /api/sessions/:sessionId returns replay payload and 404 for unknown session", async () => {
  const handlers = createRouteHarness();
  const detailHandler = handlers.get("/api/sessions/:sessionId");
  assert.ok(detailHandler);

  const successResponse = createResponseRecorder();
  await detailHandler(
    {
      params: { sessionId: "session-1" },
    },
    successResponse
  );

  assert.equal(successResponse.statusCode, 200);
  assert.equal((successResponse.body as any).session.sessionId, "session-1");
  assert.equal((successResponse.body as any).transcripts.length, 1);
  assert.equal((successResponse.body as any).actions.length, 1);
  assert.equal((successResponse.body as any).narration.length, 1);

  const missingResponse = createResponseRecorder();
  await detailHandler(
    {
      params: { sessionId: "does-not-exist" },
    },
    missingResponse
  );
  assert.equal(missingResponse.statusCode, 404);
});
