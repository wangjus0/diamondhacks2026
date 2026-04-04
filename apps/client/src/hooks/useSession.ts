import { useEffect, useRef, useCallback } from "react";
import { createSocket, type Socket } from "../lib/ws";
import { useSessionStore } from "../store/session";
import type { useAudioPlayer } from "../features/narration/useAudioPlayer";

export function useSession(
  audioPlayer: ReturnType<typeof useAudioPlayer>
) {
  const socketRef = useRef<Socket | null>(null);
  const store = useSessionStore;

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;
    const socket = createSocket(url);
    socketRef.current = socket;

    socket.onEvent((event) => {
      switch (event.type) {
        case "session_started":
          store.getState().setSessionId(event.sessionId);
          store.getState().setConnected(true);
          break;
        case "state":
          store.getState().setTurnState(event.state);
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
          break;
        case "action_status":
          store.getState().addActionStatus(event.message);
          break;
        case "narration_text":
          store.getState().setNarrationText(event.text);
          break;
        case "narration_audio":
          audioPlayer.enqueue(event.audio);
          break;
        case "done":
          store.getState().setTurnState("idle");
          store.getState().clearActionStatuses();
          break;
        case "error":
          store.getState().setError(event.message);
          break;
      }
    });

    return () => {
      socket.close();
    };
  }, []);

  const sendStartSession = useCallback(() => {
    socketRef.current?.send({ type: "start_session" });
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
