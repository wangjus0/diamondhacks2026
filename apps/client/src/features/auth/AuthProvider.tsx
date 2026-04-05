import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../lib/supabase";
import { parseOAuthCallback } from "./oauth";
import {
  buildRedirectConfigurationError,
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const authRedirectUrl = useMemo(() => resolveAuthRedirectUrl(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const applyOAuthCallback = useCallback(
    async (callbackUrl: string) => {
      const parsed = parseOAuthCallback(callbackUrl);
      if (parsed.type === "ignored") {
        return;
      }

      if (parsed.type === "error") {
        setAuthError(parsed.message);
        return;
      }

      if (parsed.type === "session") {
        const { error } = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });
        if (error) {
          setAuthError(error.message);
        } else {
          setAuthError(null);
        }
        return;
      }

      if (parsed.type === "otp") {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.otpType,
        });
        if (error) {
          setAuthError(error.message);
        } else {
          setAuthError(null);
        }
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
      if (error) {
        setAuthError(error.message);
      } else {
        setAuthError(null);
      }
    },
    [supabase],
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
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      setAuthError(error.message);
      return;
    }

    if (!data.url) {
      setAuthError("Missing Google OAuth URL from Supabase.");
      return;
    }

    try {
      await authApi.startGoogleOAuth(data.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open Google OAuth flow.";
      setAuthError(message);
    }
  }, [authRedirectUrl, supabase]);

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
