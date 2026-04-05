interface LocationLike {
  protocol?: string;
  host?: string;
}

export function resolveServerHttpOrigin(
  locationLike: LocationLike,
  desktopSocketUrl?: string
): string {
  if (locationLike.protocol === "https:" || locationLike.protocol === "http:") {
    return `${locationLike.protocol}//${locationLike.host}`;
  }

  if (desktopSocketUrl) {
    try {
      const parsed = new URL(desktopSocketUrl);
      if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
        const protocol = parsed.protocol === "wss:" ? "https:" : "http:";
        return `${protocol}//${parsed.host}`;
      }
    } catch {
      // ignore invalid desktop ws url and fallback below
    }
  }

  return "http://127.0.0.1:3000";
}
