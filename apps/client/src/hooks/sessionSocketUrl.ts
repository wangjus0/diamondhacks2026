interface RuntimeLocationLike {
  protocol?: string;
  host?: string;
}

interface SessionSocketUrlInput {
  locationLike: RuntimeLocationLike;
  desktopSocketUrl?: string;
}

function normalizeDesktopSocketUrl(rawValue?: string): string | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveSessionSocketUrl({
  locationLike,
  desktopSocketUrl,
}: SessionSocketUrlInput): string {
  if (locationLike.protocol === "https:" || locationLike.protocol === "http:") {
    const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${locationLike.host}/ws`;
  }

  const normalizedDesktopSocketUrl = normalizeDesktopSocketUrl(desktopSocketUrl);
  if (normalizedDesktopSocketUrl) {
    return normalizedDesktopSocketUrl;
  }

  return "ws://127.0.0.1:3000/ws";
}
