import assert from "node:assert/strict";
import test from "node:test";
import { resampleFloat32 } from "../../apps/client/src/lib/audio-utils.ts";

test("resampleFloat32 down-samples 48k input to 16k", () => {
  const input = new Float32Array(480);
  input.fill(0.5);

  const output = resampleFloat32(input, 48_000, 16_000);

  assert.equal(output.length, 160);
  assert.ok(output.every((value) => value >= 0.49 && value <= 0.51));
});

test("resampleFloat32 returns source array when sample rates match", () => {
  const input = new Float32Array([0, 0.25, -0.25, 1]);
  const output = resampleFloat32(input, 16_000, 16_000);

  assert.equal(output, input);
});
