import { Router } from "express";

const BROWSER_USE_V3_BASE_URL = "https://api.browser-use.com/api/v3";
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface BrowserUseProfileLookupResponse {
  id: string;
  name?: string | null;
  userId?: string | null;
  lastUsedAt?: string | null;
}

export function createBrowserUseProfilesRouter(apiKey: string): Router {
  const router = Router();

  router.get("/:profileId/validate", async (req, res) => {
    const profileId = String(req.params.profileId ?? "").trim();
    if (!PROFILE_ID_PATTERN.test(profileId)) {
      res.status(400).json({
        valid: false,
        message: "Invalid profile ID format. Expected a UUID.",
      });
      return;
    }

    try {
      const overrideApiKey = normalizeBrowserUseApiKeyHeader(
        req.header("x-murmur-browser-use-api-key")
      );
      const effectiveApiKey = overrideApiKey ?? apiKey;
      const response = await fetch(
        `${BROWSER_USE_V3_BASE_URL}/profiles/${encodeURIComponent(profileId)}`,
        {
          headers: {
            "X-Browser-Use-API-Key": effectiveApiKey,
          },
        }
      );

      if (response.status === 404) {
        res.status(404).json({
          valid: false,
          message: "Profile not found.",
        });
        return;
      }

      if (!response.ok) {
        const details = await response.text();
        res.status(502).json({
          valid: false,
          message: "Browser Use profile lookup failed.",
          details,
        });
        return;
      }

      const payload = (await response.json()) as BrowserUseProfileLookupResponse;
      res.json({
        valid: true,
        profileId: payload.id,
        name: payload.name ?? null,
        userId: payload.userId ?? null,
        lastUsedAt: payload.lastUsedAt ?? null,
      });
    } catch (error) {
      res.status(502).json({
        valid: false,
        message: "Browser Use profile lookup request failed.",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

function normalizeBrowserUseApiKeyHeader(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!/^bu_[A-Za-z0-9_-]{8,}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}
