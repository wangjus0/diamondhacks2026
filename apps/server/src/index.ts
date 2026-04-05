import { env } from "./config/env.js";
import { GoogleGenAI } from "@google/genai";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { registerReplayRoutes } from "./http/replay-routes.js";
import { buildDesktopOAuthCallbackUrl } from "./http/auth-callback.js";
import { SessionMemoryStore } from "./memory/session-memory-store.js";
import { SessionPersistenceService } from "./modules/session/session-persistence-service.js";
import { SupabaseSessionPersistence } from "./persistence/supabase-session-persistence.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { Session } from "./ws/session.js";

// -- Google GenAI client --
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// -- Express --
const app = express();
const sessionStore = new SessionMemoryStore();
const sessionPersistence = new SessionPersistenceService(sessionStore);

app.use("/sessions", createSessionsRouter(sessionPersistence));

if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  const replayPersistence = new SupabaseSessionPersistence(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  );
  registerReplayRoutes(app, replayPersistence);
} else {
  console.warn("[replay] Supabase env vars missing; replay routes disabled");
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const handleDesktopOAuthCallbackRedirect: RequestHandler = (req, res, next) => {
  const requestUrl = new URL(req.originalUrl, `http://${req.headers.host ?? `localhost:${env.PORT}`}`);
  const desktopCallbackUrl = buildDesktopOAuthCallbackUrl(requestUrl);
  if (!desktopCallbackUrl) {
    next();
    return;
  }

  res.redirect(302, desktopCallbackUrl);
};

app.get("/", handleDesktopOAuthCallbackRedirect);
app.get("/auth/callback", handleDesktopOAuthCallbackRedirect);

// -- HTTP + WebSocket server --
const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  const rawUserAgent = req.headers["user-agent"];
  const connection = {
    ip: req.socket.remoteAddress ?? null,
    userAgent: Array.isArray(rawUserAgent)
      ? rawUserAgent.join(";")
      : (rawUserAgent ?? null),
  };

  let replayPersistence;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    replayPersistence = new SupabaseSessionPersistence(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  const session = new Session(ws, ai, replayPersistence, connection, sessionPersistence);
  console.log(`[ws] New connection -> session ${session.id}`);
});

// -- Start --
server.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});
