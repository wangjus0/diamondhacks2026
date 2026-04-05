import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../lib/supabase";
import { parseOAuthCallback } from "./oauth";
import {
  buildRedirectConfigurationError,
  enforceOAuthRedirectTarget,
  isRedirectConfigurationError,
  resolveAuthRedirectUrl,
} from "./redirect";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const GOOGLE_OAUTH_CALLBACK_TTL_MS = 5 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const authRedirectUrl = useMemo(() => resolveAuthRedirectUrl(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const activeGoogleOAuthStartAtRef = useRef<number | null>(null);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const resolveOAuthErrorMessage = useCallback(
    (rawMessage: string) => {
      if (isRedirectConfigurationError(rawMessage)) {
        return buildRedirectConfigurationError(authRedirectUrl);
      }

      if (/(access_denied|consent denied|user denied)/i.test(rawMessage)) {
        return "Google sign-in was canceled.";
      }

      if (/(provider|oauth).*(disabled|not enabled|not configured|unsupported)/i.test(rawMessage)) {
        return "Google sign-in is not configured in Supabase. Enable Google under Authentication > Providers.";
      }

      if (/(invalid_client|unauthorized_client|access_denied)/i.test(rawMessage)) {
        return "Google OAuth client configuration is invalid. Confirm your Google OAuth client ID/secret in Supabase.";
      }

      return rawMessage;
    },
    [authRedirectUrl],
  );

  const beginGoogleOAuthFlow = useCallback(() => {
    activeGoogleOAuthStartAtRef.current = Date.now();
  }, []);

  const clearGoogleOAuthFlow = useCallback(() => {
    activeGoogleOAuthStartAtRef.current = null;
  }, []);

  const consumeGoogleOAuthFlowIfActive = useCallback(() => {
    const startedAt = activeGoogleOAuthStartAtRef.current;
    activeGoogleOAuthStartAtRef.current = null;

    if (startedAt === null) {
      return false;
    }

    return Date.now() - startedAt <= GOOGLE_OAUTH_CALLBACK_TTL_MS;
  }, []);

  const applyOAuthCallback = useCallback(
    async (callbackUrl: string) => {
      const parsed = parseOAuthCallback(callbackUrl);
      if (parsed.type === "ignored") {
        return;
      }

      if (parsed.type === "error") {
        clearGoogleOAuthFlow();
        setAuthError(resolveOAuthErrorMessage(parsed.message));
        return;
      }

      if (parsed.type === "session") {
        const isFromActiveGoogleFlow = consumeGoogleOAuthFlowIfActive();
        if (!isFromActiveGoogleFlow) {
          setAuthError("Unexpected OAuth callback. Start Google sign-in from the app and try again.");
          return;
        }

        const { data, error } = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });
        if (error) {
          setAuthError(resolveOAuthErrorMessage(error.message));
        } else {
          setAuthError(null);
          setUser(data.user ?? null);
        }
        return;
      }

      if (parsed.type === "otp") {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.otpType,
        });
        if (error) {
          setAuthError(resolveOAuthErrorMessage(error.message));
        } else {
          setAuthError(null);
          setUser(data.user ?? null);
        }
        return;
      }

      const isFromActiveGoogleFlow = consumeGoogleOAuthFlowIfActive();
      if (!isFromActiveGoogleFlow) {
        setAuthError("Unexpected OAuth callback. Start Google sign-in from the app and try again.");
        return;
      }

      const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.code);
      if (error) {
        setAuthError(resolveOAuthErrorMessage(error.message));
      } else {
        setAuthError(null);
        setUser(data.user ?? null);
      }
    },
    [clearGoogleOAuthFlow, consumeGoogleOAuthFlowIfActive, resolveOAuthErrorMessage, supabase],
  );

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!active) {
        return;
      }

      if (error) {
        setAuthError(error.message);
        setUser(null);
      } else {
        setUser(data.user ?? null);
      }
      setIsLoading(false);
    };

    void hydrate();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }

      setUser(session?.user ?? null);
    });

    const authApi = window.desktop?.auth;
    let cleanupCallbackListener: (() => void) | undefined;

    if (authApi) {
      void authApi.consumePendingOAuthCallback().then((pendingUrl) => {
        if (!pendingUrl || !active) {
          return;
        }

        void applyOAuthCallback(pendingUrl);
      });

      cleanupCallbackListener = authApi.onOAuthCallback((callbackUrl) => {
        void applyOAuthCallback(callbackUrl);
      });
    }

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      cleanupCallbackListener?.();
    };
  }, [applyOAuthCallback, supabase]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      setAuthError(null);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setAuthError(error.message);
        throw new Error(error.message);
      }
    },
    [supabase],
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string) => {
      setAuthError(null);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: authRedirectUrl,
        },
      });

      if (error) {
        if (isRedirectConfigurationError(error.message)) {
          const message = buildRedirectConfigurationError(authRedirectUrl);
          setAuthError(message);
          throw new Error(message);
        }

        setAuthError(error.message);
        throw new Error(error.message);
      }
    },
    [authRedirectUrl, supabase],
  );

  const sendPasswordReset = useCallback(
    async (email: string) => {
      setAuthError(null);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authRedirectUrl,
      });
      if (error) {
        setAuthError(error.message);
        throw new Error(error.message);
      }
    },
    [authRedirectUrl, supabase],
  );

  const signInWithGoogle = useCallback(async () => {
    const authApi = window.desktop?.auth;
    if (!authApi) {
      setAuthError("Desktop OAuth bridge is not available.");
      return;
    }

    setAuthError(null);
    beginGoogleOAuthFlow();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      clearGoogleOAuthFlow();
      setAuthError(resolveOAuthErrorMessage(error.message));
      return;
    }

    if (!data.url) {
      clearGoogleOAuthFlow();
      setAuthError("Missing Google OAuth URL from Supabase.");
      return;
    }

    try {
      const oauthUrl = enforceOAuthRedirectTarget(data.url, authRedirectUrl);
      await authApi.startGoogleOAuth(oauthUrl);
    } catch (error) {
      clearGoogleOAuthFlow();
      const message = error instanceof Error ? error.message : "Failed to open Google OAuth flow.";
      setAuthError(resolveOAuthErrorMessage(message));
    }
  }, [authRedirectUrl, beginGoogleOAuthFlow, clearGoogleOAuthFlow, resolveOAuthErrorMessage, supabase]);

  const signOut = useCallback(async () => {
    setAuthError(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(error.message);
    }
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      authError,
      clearAuthError,
      signInWithPassword,
      signUpWithPassword,
      sendPasswordReset,
      signInWithGoogle,
      signOut,
    }),
    [
      authError,
      clearAuthError,
      isLoading,
      sendPasswordReset,
      signInWithGoogle,
      signInWithPassword,
      signOut,
      signUpWithPassword,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
