import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useSessionStore } from "../../store/session";
import { useAudioPlayer } from "../narration/useAudioPlayer";
import { useMicrophone } from "./useMicrophone";
const BUSY_TURN_STATES = new Set(["thinking", "acting", "speaking"]);
const BAR_COUNT = 9;
const BASE_BAR_SCALE = [0.34, 0.5, 0.72, 0.9, 0.76, 0.92, 0.7, 0.52, 0.36];
const FLAT_SCALE = new Array(BAR_COUNT).fill(0.12);
const SILENCE_THRESHOLD = 0.12;
const SILENCE_TIMEOUT_MS = 3000;

export function VoicePopover() {
  const audioPlayer = useAudioPlayer();
  const { sendStartSession, sendAudioChunk, sendAudioEnd } = useSession(audioPlayer);

  const turnState = useSessionStore((s) => s.turnState);
  const narrationText = useSessionStore((s) => s.narrationText);
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);
  const [barScales, setBarScales] = useState<number[]>(FLAT_SCALE);
  const isRecordingRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);
  const stopRecordingRef = useRef<(() => void) | null>(null);

  // Treat audio playback as effectively "speaking" even after server sends idle
  const effectiveState = audioPlayer.isPlaying && turnState === "idle" ? "speaking" : turnState;
  const micDisabled = BUSY_TURN_STATES.has(effectiveState);

  const { startRecording, stopRecording, isRecording } = useMicrophone({
    onAudioChunk: sendAudioChunk,
    onStart: sendStartSession,
    onStop: sendAudioEnd,
    onError: setError,
    onAudioLevel: (level) => {
      // Auto-stop after 3s of silence (only after user has spoken)
      if (isRecordingRef.current) {
        if (level > SILENCE_THRESHOLD) {
          hasSpokenRef.current = true;
          silenceStartRef.current = null;
        } else if (hasSpokenRef.current) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current >= SILENCE_TIMEOUT_MS) {
            stopRecordingRef.current?.();
            setBarScales(FLAT_SCALE);
            return;
          }
        }
      }

      setBarScales((prev) => {
        return prev.map((prevScale, index) => {
          const base = BASE_BAR_SCALE[index] ?? 0.5;
          const jitter = ((index % 3) - 1) * 0.04;
          // Quiet → very small (0.08), loud → full height (1.2)
          const target = Math.max(0.08, Math.min(1.2, 0.08 + level * base * 1.5 + jitter));
          // Fast attack, moderate decay
          const smoothing = level > prevScale ? 0.6 : 0.35;
          const next = prevScale * (1 - smoothing) + target * smoothing;
          return Number(next.toFixed(3));
        });
      });
    },
  });

  // Keep stopRecording ref current for the silence auto-stop
  stopRecordingRef.current = stopRecording;

  // Show response card when narration text exists and we're speaking or just finished
  const showResponseCard = Boolean(narrationText) && (effectiveState === "speaking" || effectiveState === "idle") && !isRecording;

  const statusMessage = error
    ? error
    : isRecording
      ? "Listening..."
      : effectiveState === "thinking"
        ? "Processing..."
        : effectiveState === "acting"
          ? "Working..."
          : effectiveState === "speaking"
            ? "Responding..."
            : "Press Space to start";

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Resize window when response card shows/hides
  useEffect(() => {
    if (showResponseCard) {
      window.desktop?.shortcut?.resizePopover?.(430, 260);
    } else {
      window.desktop?.shortcut?.resizePopover?.(430, 86);
    }
  }, [showResponseCard]);

  // Animate bars when speaking, go flat when idle
  // Move pill to top-right when waiting, back to center when recording
  useEffect(() => {
    console.log("[VoicePopover] effectiveState:", effectiveState);

    if (effectiveState === "speaking") {
      window.desktop?.shortcut?.repositionPopover?.("center");
      // Wave animation during TTS playback
      const id = setInterval(() => {
        const t = Date.now() / 1000;
        setBarScales(
          BASE_BAR_SCALE.map((base, i) => {
            const wave = Math.sin(t * 3.5 + i * 0.7) * 0.3 + 0.15;
            return Number((base * 0.5 + wave).toFixed(3));
          })
        );
      }, 40);
      return () => clearInterval(id);
    }

    if (effectiveState === "thinking" || effectiveState === "acting") {
      window.desktop?.shortcut?.repositionPopover?.("top-right");
      // Subtle loading wave — bars stay small but ripple left to right
      const id = setInterval(() => {
        const t = Date.now() / 1000;
        setBarScales(
          FLAT_SCALE.map((base, i) => {
            const wave = Math.sin(t * 4 - i * 0.6) * 0.08 + 0.04;
            return Number((base + Math.max(0, wave)).toFixed(3));
          })
        );
      }, 40);
      return () => clearInterval(id);
    }

    // Back to center when idle (ready for next recording)
    if (effectiveState === "idle" && !isRecordingRef.current) {
      window.desktop?.shortcut?.repositionPopover?.("center");
      setBarScales(FLAT_SCALE);
    }
  }, [effectiveState]);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      setBarScales(FLAT_SCALE);
      return;
    }
    setError(null);
    useSessionStore.getState().setNarrationText("");
    silenceStartRef.current = null;
    hasSpokenRef.current = false;
    const started = await startRecording();
    if (!started) {
      setBarScales(FLAT_SCALE);
    }
  }, [isRecording, setError, startRecording, stopRecording]);

  const closePopover = useCallback(() => {
    window.desktop?.shortcut?.closePopover();
  }, []);

  const handleKeyDownRef = useRef<(event: KeyboardEvent) => void>();
  handleKeyDownRef.current = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (isRecording) stopRecording();
      closePopover();
      return;
    }

    if (event.key === " " && !event.repeat) {
      event.preventDefault();
      void toggleRecording();
    }
  };

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
    const listener = (event: KeyboardEvent) => {
      handleKeyDownRef.current?.(event);
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      if (isRecordingRef.current) {
        stopRecording();
      }
      setBarScales(FLAT_SCALE);
      audioPlayer.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="voice-popover-screen">
      <section className="voice-popover-shell" aria-live="polite">
        <button
          type="button"
          className={`voice-meter-pill ${isRecording || effectiveState === "speaking" ? "voice-meter-pill-live" : ""} ${error ? "voice-meter-pill-error" : ""}`}
          disabled={!isRecording && micDisabled}
          onClick={() => { void toggleRecording(); }}
          title={error || (isRecording ? "Recording. Press Space to stop." : "Press Space to start.")}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          {Array.from({ length: BAR_COUNT }, (_value, index) => (
            <span
              key={index}
              className="voice-meter-bar"
              style={{
                height: `${Math.round((barScales[index] ?? 0.5) * 27)}px`,
              }}
            />
          ))}
        </button>
        <p className={`voice-popover-status ${error ? "voice-popover-status-error" : ""}`}>{statusMessage}</p>
        {showResponseCard && (
          <div className="voice-response-card">
            <p className="voice-response-text">{narrationText}</p>
          </div>
        )}
      </section>
    </div>
  );
}
