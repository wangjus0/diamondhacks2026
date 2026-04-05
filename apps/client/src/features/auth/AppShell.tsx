import { useEffect, useMemo, useState } from "react";
import { App } from "../../App";
import { getSupabaseClient } from "../../lib/supabase";
import { persistBrowserProfileId } from "../../lib/browser-profile";
import { useAuth } from "./AuthProvider";
import { AuthScreen } from "./AuthScreen";
import { resolveGuardDestination } from "./guard";
import { OnboardingGateScaffold } from "./OnboardingGateScaffold";
import { mergePersistedOnboardingData } from "./onboardingSchema";

type OnboardingStatus = {
  isLoading: boolean;
  isCompleted: boolean;
  loadError: string | null;
};

type OnboardingLookup = {
  completed: boolean;
  responses: unknown;
};

const INITIAL_ONBOARDING_STATUS: OnboardingStatus = {
  isLoading: true,
  isCompleted: false,
  loadError: null,
};

export function AppShell() {
  const { user, isLoading } = useAuth();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>(INITIAL_ONBOARDING_STATUS);

  useEffect(() => {
    let isActive = true;

    const loadOnboardingStatus = async () => {
      if (!user) {
        if (isActive) {
          setOnboardingStatus({
            isLoading: false,
            isCompleted: false,
            loadError: null,
          });
        }
        return;
      }

      if (isActive) {
        setOnboardingStatus((previous) => ({
          ...previous,
          isLoading: true,
          loadError: null,
        }));
      }

      const { data, error } = await supabase
        .from("onboarding_responses")
        .select("completed,responses")
        .eq("user_id", user.id)
        .maybeSingle<OnboardingLookup>();

      if (!isActive) {
        return;
      }

      if (error) {
        setOnboardingStatus({
          isLoading: false,
          isCompleted: false,
          loadError: error.message,
        });
        return;
      }

      if (data?.responses) {
        const merged = mergePersistedOnboardingData(data.responses);
        await persistBrowserProfileId(merged.permissions.browserProfileId.trim() || null);
      }

      setOnboardingStatus({
        isLoading: false,
        isCompleted: data?.completed === true,
        loadError: null,
      });
    };

    void loadOnboardingStatus();

    return () => {
      isActive = false;
    };
  }, [supabase, user]);

  if (isLoading || (user && onboardingStatus.isLoading)) {
    return (
      <div className="screen">
        <div className="panel status-card center-status">Checking session...</div>
      </div>
    );
  }

  const destination = resolveGuardDestination(
    user,
    onboardingStatus.isCompleted,
  );
  if (destination === "auth") {
    return <AuthScreen />;
  }

  if (destination === "onboarding") {
    return (
      <OnboardingGateScaffold
        initialLoadError={onboardingStatus.loadError}
        onCompleted={() => {
          setOnboardingStatus({
            isLoading: false,
            isCompleted: true,
            loadError: null,
          });
        }}
      />
    );
  }

  return <App />;
}
