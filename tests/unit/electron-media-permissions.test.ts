import assert from "node:assert/strict";
import test from "node:test";
import {
  isMicrophonePermission,
  isTrustedMicrophoneRequest,
  isTrustedRendererUrl,
} from "../../electron/permissions/mediaPermissions.ts";

test("isMicrophonePermission accepts microphone aliases", () => {
  assert.equal(isMicrophonePermission("audioCapture"), true);
  assert.equal(isMicrophonePermission("microphone"), true);
  assert.equal(isMicrophonePermission("media"), true);
  assert.equal(isMicrophonePermission("camera"), false);
});

test("isTrustedRendererUrl allows trusted dev and packaged renderer URLs", () => {
  assert.equal(isTrustedRendererUrl("http://localhost:5173/#/voice-popover"), true);
  assert.equal(isTrustedRendererUrl("file:///Applications/Murmur.app/Contents/Resources/app/index.html"), true);
});

test("isTrustedMicrophoneRequest falls back to webContents URL when requesting URL is missing", () => {
  const trusted = isTrustedMicrophoneRequest({
    requestingUrl: "",
    requestingOrigin: "",
    webContentsUrl: "file:///Applications/Murmur.app/Contents/Resources/app/index.html",
  });

  assert.equal(trusted, true);
});

test("isTrustedMicrophoneRequest denies untrusted origins", () => {
  const trusted = isTrustedMicrophoneRequest({
    requestingUrl: "https://malicious.example/iframe",
    requestingOrigin: "https://malicious.example",
    webContentsUrl: "https://malicious.example/app",
  });

  assert.equal(trusted, false);
});

test("isTrustedMicrophoneRequest rejects untrusted request URL even on trusted renderer", () => {
  const trusted = isTrustedMicrophoneRequest({
    requestingUrl: "https://malicious.example/iframe",
    requestingOrigin: "",
    webContentsUrl: "http://localhost:5173/#/voice-popover",
  });

  assert.equal(trusted, false);
});
