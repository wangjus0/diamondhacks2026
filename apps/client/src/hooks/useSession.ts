import { useEffect, useRef, useCallback } from "react";
import { createSocket, type Socket } from "../lib/ws";
import {
  getStoredBrowserProfileId,
  getStoredBrowserUseApiKey,
} from "../lib/browser-profile";
import { useSessionStore } from "../store/session";
import type { useAudioPlayer } from "../features/narration/useAudioPlayer";
import { resolveSessionSocketUrl } from "./sessionSocketUrl";

export function useSession(
  audioPlayer: ReturnType<typeof useAudioPlayer>
) {
  const socketRef = useRef<Socket | null>(null);
  const store = useSessionStore;

  useEffect(() => {
    const url = resolveSessionSocketUrl({
      locationLike: window.location,
      desktopSocketUrl: window.desktop?.getRealtimeWebSocketUrl?.(),
    });
    const socket = createSocket(url);
    socketRef.current = socket;

    socket.onEvent((event) => {
      switch (event.type) {
        case "session_started":
          store.getState().clearActionTimeline();
          store.getState().setSessionId(event.sessionId);
          store.getState().setConnected(true);
          store.getState().addActionTimelineItem({
            kind: "session",
            message: `Session started (${event.sessionId})`,
          });
          break;
        case "state":
          store.getState().setTurnState(event.state);
          store.getState().addActionTimelineItem({
            kind: "state",
            message: `State changed to ${event.state}`,
          });
          break;
        case "transcript_partial":
          store.getState().setTranscriptPartial(event.text);
          break;
        case "transcript_final":
          store.getState().setTranscriptPartial("");
          store.getState().addTranscriptFinal(event.text);
          break;
        case "intent":
          store.getState().setIntent(event.intent);
          store.getState().addActionTimelineItem({
            kind: "intent",
            message: `Intent detected: ${event.intent.intent} (${Math.round(event.intent.confidence * 100)}%)`,
          });
          break;
        case "action_status":
          store.getState().addActionTimelineItem({
            kind: "action",
            message: event.message,
          });
          store.getState().addActionStatus(event.message);
          break;
        case "narration_text":
          store.getState().setNarrationText(event.text);
          store.getState().addActionTimelineItem({
            kind: "narration",
            message: event.text,
          });
          break;
        case "narration_audio":
          audioPlayer.enqueue(event.audio);
          break;
        case "done":
          store.getState().setTurnState("idle");
          store.getState().clearActionStatuses();
          store.getState().addActionTimelineItem({
            kind: "done",
            message: "Turn completed",
          });
          break;
        case "error":
          store.getState().setError(event.message);
          store.getState().addActionTimelineItem({
            kind: "error",
            message: event.message,
          });
          break;
      }
    });

    return () => {
      socket.close();
    };
  }, []);

  const sendStartSession = useCallback(() => {
    const profileId = getStoredBrowserProfileId();
    const browserUseApiKey = getStoredBrowserUseApiKey();
    socketRef.current?.send({
      type: "start_session",
      ...(profileId ? { profileId } : {}),
      ...(browserUseApiKey ? { browserUseApiKey } : {}),
    });
  }, []);

  const sendAudioChunk = useCallback((data: string) => {
    socketRef.current?.send({ type: "audio_chunk", data });
  }, []);

  const sendAudioEnd = useCallback(() => {
    socketRef.current?.send({ type: "audio_end" });
  }, []);

  const sendInterrupt = useCallback(() => {
    socketRef.current?.send({ type: "interrupt" });
  }, []);

  return { sendStartSession, sendAudioChunk, sendAudioEnd, sendInterrupt };
}
