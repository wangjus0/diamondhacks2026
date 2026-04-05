const TRUSTED_RENDERER_ORIGINS = new Set(["http://localhost:5173"]);

function normalizeCandidateUrl(rawValue: string | undefined): string | null {
  if (!rawValue) {
    return null;
  }

  const trimmedValue = rawValue.trim();
  if (!trimmedValue || trimmedValue === "null") {
    return null;
  }

  return trimmedValue;
}

export function isMicrophonePermission(permission: string): boolean {
  return permission === "audioCapture" || permission === "microphone" || permission === "media";
}

export function isTrustedRendererUrl(rawUrl: string | undefined): boolean {
  const candidateUrl = normalizeCandidateUrl(rawUrl);
  if (!candidateUrl) {
    return false;
  }

  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol === "file:") {
      return true;
    }

    return TRUSTED_RENDERER_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

interface MicrophoneRequestContext {
  requestingUrl?: string;
  requestingOrigin?: string;
  webContentsUrl?: string;
}

export function isTrustedMicrophoneRequest(context: MicrophoneRequestContext): boolean {
  const requestSpecificUrl = normalizeCandidateUrl(context.requestingUrl);
  if (requestSpecificUrl) {
    return isTrustedRendererUrl(requestSpecificUrl);
  }

  const requestSpecificOrigin = normalizeCandidateUrl(context.requestingOrigin);
  if (requestSpecificOrigin) {
    return isTrustedRendererUrl(requestSpecificOrigin);
  }

  return isTrustedRendererUrl(context.webContentsUrl);
}
