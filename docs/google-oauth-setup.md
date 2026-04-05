# Google OAuth Setup (Supabase + Electron)

This app uses Supabase Auth for Google sign-in and finishes the desktop flow with a deep link callback (`murmur://auth/callback`).

## 1) Google Cloud OAuth client

Create a **Web application** OAuth client in Google Cloud and set the redirect URI to:

`https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`

For this repository's Supabase project, that is:

`https://widbrlxfiolngkncgbkm.supabase.co/auth/v1/callback`

## 2) Supabase Auth provider config

In Supabase dashboard:

1. Open `Authentication` -> `Providers` -> `Google`
2. Enable Google provider
3. Paste your Google OAuth client ID and client secret
4. Save

## 3) Supabase redirect allowlist

In Supabase dashboard:

1. Open `Authentication` -> `URL Configuration`
2. Add this redirect URL to the allowlist:

`murmur://auth/callback`

## 4) Local env values

Store these values in `apps/server/.env`:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

The Electron app already reads Supabase public config from the same env source when running `npm run dev:electron`.

## 5) Run and verify

1. Start app: `npm run dev:electron`
2. Click `Continue with Google`
3. Complete Google consent in browser
4. Confirm app receives callback and signs in

If sign-up or OAuth returns redirect allowlist errors, verify `murmur://auth/callback` is present in Supabase redirect URLs.
