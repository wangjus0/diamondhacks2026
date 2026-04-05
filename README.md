# Murmur

Murmur is a macOS-first Electron desktop app for voice-guided web automation.  
It combines speech input, intent routing, browser actions, and spoken output into one realtime loop.

## Goals

- Build a reliable voice-first assistant for real web tasks.
- Keep user control and transparency high with live status, transcript, and timeline.
- Enforce strict safety constraints for browser automation.
- Support secure auth and onboarding in a desktop-native flow.

## Core Capabilities

- Realtime speech-to-text with partial and final transcript events.
- Turn orchestration with clear lifecycle states (`idle`, `listening`, `thinking`, `acting`, `speaking`).
- Intent routing for MVP workflows (`search`, `form_fill_draft`, fallback clarification).
- Browser automation via Browser Use, including integration-aware credential payloads.
- Narration output with streamed text/audio events.
- Interrupt/cancel support during active execution.
- Integrations workspace for OAuth/API key connection state management.
- Supabase-backed auth, onboarding persistence, and session replay storage.

## Safety Model

- Domain allowlist checks before browser navigation.
- Dangerous-action blocking for submit/pay/checkout/final-confirm style operations.
- Draft-only form-fill behavior in MVP (no final submission).
- Structured status/error events for blocked actions.

## App Flow (v1)

1. Launch desktop app.
2. Sign in with Google OAuth or email/password.
3. Complete onboarding scaffold.
4. Use home workspace and global shortcut voice popover.
5. Speak requests, observe action timeline, and hear narrated results.

## Architecture

- `apps/client`: React + Vite renderer UI.
- `apps/server`: Express + WebSocket realtime backend and orchestration.
- `electron`: Desktop shell, windows, preload bridge, OAuth callback/session IPC.
- `packages/shared`: Shared event types and zod schemas used by client/server.
- `supabase/migrations`: SQL schema migrations for profiles/onboarding/session data.
- `tests`: Unit and integration tests for orchestration, safety, auth, and session flows.

## Local Development

Prerequisites:

- Node.js 20+
- npm
- API keys for Gemini, ElevenLabs, and Browser Use
- Supabase project credentials

Run:

```bash
npm install
npm run dev:electron
```

Useful scripts:

- `npm run dev` (server + client web mode)
- `npm run dev:server`
- `npm run dev:client`
- `npm run build:electron`
- `npm test`

## Environment

Server env expects (at minimum):

- `ELEVEN_LABS_API_KEY`
- `BROWSER_USE_API_KEY`
- `GEMINI_API_KEY`

Optional/feature-dependent:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BROWSER_USE_PROFILE_ID`
- `NAVIGATION_ALLOWLIST`
- `ALLOW_FINAL_FORM_SUBMISSION`

Client/electron auth setup uses:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## Status

This repository is an actively evolving MVP with a focus on:

- Voice UX reliability
- Tooling/integration expansion
- Safety-first automation behavior
- Desktop auth/onboarding polish
