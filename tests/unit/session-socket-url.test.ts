import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionSocketUrl } from "../../apps/client/src/hooks/sessionSocketUrl.ts";

test("resolveSessionSocketUrl uses current host for http renderer", () => {
  const result = resolveSessionSocketUrl({
    locationLike: {
      protocol: "http:",
      host: "localhost:5173",
    },
  });

  assert.equal(result, "ws://localhost:5173/ws");
});

test("resolveSessionSocketUrl uses desktop socket URL for file renderer", () => {
  const result = resolveSessionSocketUrl({
    locationLike: {
      protocol: "file:",
      host: "",
    },
    desktopSocketUrl: "ws://localhost:3000/ws",
  });

  assert.equal(result, "ws://localhost:3000/ws");
});

test("resolveSessionSocketUrl falls back to loopback server for file renderer", () => {
  const result = resolveSessionSocketUrl({
    locationLike: {
      protocol: "file:",
      host: "",
    },
  });

  assert.equal(result, "ws://127.0.0.1:3000/ws");
});
