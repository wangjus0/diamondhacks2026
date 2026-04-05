import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useSessionStore } from "../../store/session";
import { useAudioPlayer } from "../narration/useAudioPlayer";
import { useMicrophone } from "./useMicrophone";
import { resolveVoicePopoverShortcutAction } from "./voicePopoverShortcuts";

const BUSY_TURN_STATES = new Set(["thinking", "acting", "speaking"]);
const BAR_COUNT = 9;
const BASE_BAR_SCALE = [0.34, 0.5, 0.72, 0.9, 0.76, 0.92, 0.7, 0.52, 0.36];

export function VoicePopover() {
  const audioPlayer = useAudioPlayer();
  const { sendStartSession, sendAudioChunk, sendAudioEnd } = useSession(audioPlayer);

  const turnState = useSessionStore((s) => s.turnState);
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);
  const [barScales, setBarScales] = useState<number[]>(BASE_BAR_SCALE);
  const isRecordingRef = useRef(false);

  const micDisabled = BUSY_TURN_STATES.has(turnState);

  const { startRecording, stopRecording, isRecording } = useMicrophone({
    onAudioChunk: sendAudioChunk,
    onStart: sendStartSession,
    onStop: sendAudioEnd,
    onError: setError,
    onAudioLevel: (level) => {
      setBarScales((prev) => {
        return prev.map((prevScale, index) => {
          const base = BASE_BAR_SCALE[index] ?? 0.5;
          const jitter = ((index % 3) - 1) * 0.06;
          const target = Math.max(0.2, Math.min(1.15, base + level * 0.9 + jitter));
          const next = prevScale * 0.68 + target * 0.32;
          return Number(next.toFixed(3));
        });
      });
    },
  });

  const statusMessage = error
    ? error
    : isRecording
      ? "Listening... press Space to stop"
      : micDisabled
        ? "Assistant is busy. Try again in a moment."
        : "Press Space to start listening";

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      setBarScales(BASE_BAR_SCALE);
      return;
    }

    if (micDisabled) {
      return;
    }

    setError(null);
    const started = await startRecording();
    if (started) {
      return;
    }

    setBarScales(BASE_BAR_SCALE);
  }, [isRecording, micDisabled, sendStartSession, setError, startRecording, stopRecording]);

  const closePopover = useCallback(() => {
    window.desktop?.shortcut?.closePopover();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const action = resolveVoicePopoverShortcutAction({
        key: event.key,
        repeat: event.repeat,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        canToggleMic: isRecording || !micDisabled,
      });

      if (action === "close") {
        event.preventDefault();
        closePopover();
        return;
      }

      if (action === "toggle-mic") {
        event.preventDefault();
        void toggleRecording();
      }
    },
    [closePopover, isRecording, micDisabled, toggleRecording]
  );

  useEffect(() => {
    const originalBodyMargin = document.body.style.margin;
    const originalBodyBackground = document.body.style.background;
    const originalRootBackground = document.documentElement.style.background;
    const originalBodyOverflow = document.body.style.overflow;
    const originalRootOverflow = document.documentElement.style.overflow;

    document.body.classList.add("voice-popover-mode");
    document.body.style.margin = "0";
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.classList.remove("voice-popover-mode");
      document.body.style.margin = originalBodyMargin;
      document.body.style.background = originalBodyBackground;
      document.documentElement.style.background = originalRootBackground;
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalRootOverflow;
    };
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (isRecordingRef.current) {
        stopRecording();
      }
      setBarScales(BASE_BAR_SCALE);
      audioPlayer.stop();
    };
  }, [audioPlayer, handleKeyDown, stopRecording]);

  return (
    <div className="voice-popover-screen">
      <section className="voice-popover-shell" aria-live="polite">
        <button
          type="button"
          className={`voice-meter-pill ${isRecording ? "voice-meter-pill-live" : ""} ${error ? "voice-meter-pill-error" : ""}`}
          disabled={micDisabled && !isRecording}
          onClick={() => {
            void toggleRecording();
          }}
          title={error || (isRecording ? "Recording. Press Space to stop." : "Press Space to start recording.")}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          {Array.from({ length: BAR_COUNT }, (_value, index) => (
            <span
              key={index}
              className={`voice-meter-bar ${isRecording ? "voice-meter-bar-live" : ""}`}
              style={{
                ["--meter-index" as string]: String(index),
                ["--bar-scale" as string]: String(barScales[index] ?? BASE_BAR_SCALE[index] ?? 0.5),
              }}
            />
          ))}
        </button>
        <p className={`voice-popover-status ${error ? "voice-popover-status-error" : ""}`}>{statusMessage}</p>
      </section>
    </div>
  );
}
