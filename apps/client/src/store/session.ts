import { create } from "zustand";
import type { TurnState, IntentResult } from "@diamond/shared";

export interface SessionState {
  connected: boolean;
  sessionId: string | null;
  turnState: TurnState;
  transcriptPartial: string;
  transcriptFinals: string[];
  intent: IntentResult | null;
  narrationText: string;
  actionStatuses: string[];
  error: string | null;

  // Actions
  setConnected: (connected: boolean) => void;
  setSessionId: (sessionId: string | null) => void;
  setTurnState: (turnState: TurnState) => void;
  setTranscriptPartial: (text: string) => void;
  addTranscriptFinal: (text: string) => void;
  setIntent: (intent: IntentResult | null) => void;
  setNarrationText: (text: string) => void;
  addActionStatus: (message: string) => void;
  clearActionStatuses: () => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  connected: false,
  sessionId: null,
  turnState: "idle" as TurnState,
  transcriptPartial: "",
  transcriptFinals: [] as string[],
  intent: null,
  narrationText: "",
  actionStatuses: [] as string[],
  error: null,
};

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setConnected: (connected) => set({ connected }),
  setSessionId: (sessionId) => set({ sessionId }),
  setTurnState: (turnState) => set({ turnState }),
  setTranscriptPartial: (text) => set({ transcriptPartial: text }),
  addTranscriptFinal: (text) =>
    set((s) => ({ transcriptFinals: [...s.transcriptFinals, text] })),
  setIntent: (intent) => set({ intent }),
  setNarrationText: (text) => set({ narrationText: text }),
  addActionStatus: (message) =>
    set((s) => ({ actionStatuses: [...s.actionStatuses, message] })),
  clearActionStatuses: () => set({ actionStatuses: [] }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
