export const MICROPHONE_FRAME_WATCHDOG_MS = 1800;

interface SilentCaptureInput {
  elapsedMs: number;
  hasReceivedAudioFrame: boolean;
  watchdogMs?: number;
}

export function shouldTreatCaptureAsSilent({
  elapsedMs,
  hasReceivedAudioFrame,
  watchdogMs = MICROPHONE_FRAME_WATCHDOG_MS,
}: SilentCaptureInput): boolean {
  return elapsedMs >= watchdogMs && !hasReceivedAudioFrame;
}

export function getSilentCaptureErrorMessage(): string {
  return "Murmur can access your microphone, but no audio input was detected. Check your input device and system mic settings, then try again.";
}
