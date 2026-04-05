import type { MicrophoneAccessStatus } from "./onboardingSchema";

export function normalizeMicrophoneAccessStatus(status: unknown): MicrophoneAccessStatus {
  if (status === "granted") {
    return "granted";
  }

  if (status === "denied") {
    return "denied";
  }

  if (status === "restricted") {
    return "restricted";
  }

  if (status === "not-determined" || status === "prompt") {
    return "not-determined";
  }

  if (status === "unsupported") {
    return "unsupported";
  }

  return "unknown";
}

export function isMicrophoneAccessSatisfied(status: MicrophoneAccessStatus): boolean {
  return status === "granted" || status === "unsupported";
}
