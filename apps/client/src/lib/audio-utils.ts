export function float32ToPcm16Base64(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function resampleFloat32(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Float32Array {
  if (sourceSampleRate === targetSampleRate || input.length === 0) {
    return input;
  }

  if (sourceSampleRate < targetSampleRate) {
    const ratio = targetSampleRate / sourceSampleRate;
    const outputLength = Math.max(1, Math.round(input.length * ratio));
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i += 1) {
      const sourceIndex = i / ratio;
      const lower = Math.floor(sourceIndex);
      const upper = Math.min(input.length - 1, lower + 1);
      const mix = sourceIndex - lower;
      output[i] = input[lower] * (1 - mix) + input[upper] * mix;
    }

    return output;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  let inputIndex = 0;
  for (let i = 0; i < outputLength; i += 1) {
    const nextInputIndex = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let count = 0;

    while (inputIndex < nextInputIndex) {
      sum += input[inputIndex];
      inputIndex += 1;
      count += 1;
    }

    output[i] = count > 0 ? sum / count : output[Math.max(0, i - 1)] ?? 0;
  }

  return output;
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}
