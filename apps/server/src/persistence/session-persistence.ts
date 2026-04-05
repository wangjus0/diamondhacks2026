export type SessionTerminalStatus =
  | "completed"
  | "interrupted"
  | "errored"
  | "disconnected";

export interface StartSessionInput {
  sessionId: string;
  userId?: string;
  startedAt?: string;
}

export interface TranscriptFinalInput {
  sessionId: string;
  text: string;
  createdAt?: string;
}

export interface ActionEventInput {
  sessionId: string;
  status: string;
  step: string;
  detail?: string;
  createdAt?: string;
}

export interface NarrationTextInput {
  sessionId: string;
  text: string;
  sequence?: number;
  createdAt?: string;
}

export interface FinishSessionInput {
  sessionId: string;
  status: SessionTerminalStatus;
  errorMessage?: string;
  endedAt?: string;
}

export interface SessionRunRecord {
  sessionId: string;
  userId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionTranscriptRecord {
  id: string;
  sessionId: string;
  text: string;
  createdAt: string;
}

export interface SessionActionEventRecord {
  id: string;
  sessionId: string;
  status: string;
  step: string;
  detail: string | null;
  createdAt: string;
}

export interface SessionNarrationEventRecord {
  id: string;
  sessionId: string;
  text: string;
  sequence: number | null;
  createdAt: string;
}

export interface SessionReplayRecord {
  session: SessionRunRecord;
  transcripts: SessionTranscriptRecord[];
  actions: SessionActionEventRecord[];
  narration: SessionNarrationEventRecord[];
}

export interface SessionPersistence {
  startSession(input: StartSessionInput): Promise<void>;
  appendTranscriptFinal(input: TranscriptFinalInput): Promise<void>;
  appendActionEvent(input: ActionEventInput): Promise<void>;
  appendNarrationText(input: NarrationTextInput): Promise<void>;
  finishSession(input: FinishSessionInput): Promise<void>;
  listSessions(limit: number): Promise<SessionRunRecord[]>;
  getSessionReplay(sessionId: string): Promise<SessionReplayRecord | null>;
}
