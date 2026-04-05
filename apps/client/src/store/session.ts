import { create } from "zustand";
import type { TurnState, IntentResult } from "@murmur/shared";

export type ActionTimelineKind =
  | "session"
  | "state"
  | "action"
  | "intent"
  | "narration"
  | "done"
  | "error";

export interface ActionTimelineItem {
  id: string;
  kind: ActionTimelineKind;
  message: string;
  createdAt: number;
}

export interface ConversationHistoryEntry {
  id: string;
  timestamp: number;
  question: string;
  answer: string | null;
}

export interface SessionState {
  connected: boolean;
  sessionId: string | null;
  turnState: TurnState;
  transcriptPartial: string;
  transcriptFinals: string[];
  conversationHistory: ConversationHistoryEntry[];
  actionTimeline: ActionTimelineItem[];
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
  addConversationQuestion: (question: string) => void;
  setLatestConversationAnswer: (answer: string) => void;
  clearConversationHistory: () => void;
  addActionTimelineItem: (entry: Omit<ActionTimelineItem, "id" | "createdAt">) => void;
  clearActionTimeline: () => void;
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
  conversationHistory: [] as ConversationHistoryEntry[],
  actionTimeline: [] as ActionTimelineItem[],
  intent: null,
  narrationText: "",
  actionStatuses: [] as string[],
  error: null,
};

const TIMELINE_MAX_ITEMS = 200;

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setConnected: (connected) => set({ connected }),
  setSessionId: (sessionId) => set({ sessionId }),
  setTurnState: (turnState) => set({ turnState }),
  setTranscriptPartial: (text) => set({ transcriptPartial: text }),
  addTranscriptFinal: (text) =>
    set((s) => ({ transcriptFinals: [...s.transcriptFinals, text] })),
  addConversationQuestion: (question) =>
    set((s) => ({
      conversationHistory: [
        ...s.conversationHistory,
        {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          question,
          answer: null,
        },
      ],
    })),
  setLatestConversationAnswer: (answer) =>
    set((s) => {
      const next = [...s.conversationHistory];
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (next[index]?.answer === null) {
          next[index] = {
            ...next[index],
            answer,
          };
          return { conversationHistory: next };
        }
      }

      return {
        conversationHistory: [
          ...next,
          {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            question: "",
            answer,
          },
        ],
      };
    }),
  clearConversationHistory: () => set({ conversationHistory: [] }),
  addActionTimelineItem: (entry) =>
    set((s) => {
      const nextTimeline = [
        ...s.actionTimeline,
        {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          ...entry,
        },
      ];

      return {
        actionTimeline: nextTimeline.slice(-TIMELINE_MAX_ITEMS),
      };
    }),
  clearActionTimeline: () => set({ actionTimeline: [] }),
  setIntent: (intent) => set({ intent }),
  setNarrationText: (text) => set({ narrationText: text }),
  addActionStatus: (message) =>
    set((s) => ({ actionStatuses: [...s.actionStatuses, message] })),
  clearActionStatuses: () => set({ actionStatuses: [] }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
