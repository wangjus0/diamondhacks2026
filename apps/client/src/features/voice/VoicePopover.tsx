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
  const { sendStartSession, sendAudioChunk, sendAudioEnd, sendInterrupt } = useSession(audioPlayer);

  const turnState = useSessionStore((s) => s.turnState);
  const narrationText = useSessionStore((s) => s.narrationText);
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);
  const [barScales, setBarScales] = useState<number[]>(FLAT_SCALE);
  const [workingElapsed, setWorkingElapsed] = useState(0);
  const [entered, setEntered] = useState(false);
  const [statusKey, setStatusKey] = useState(0);
  const isRecordingRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const prevStatusRef = useRef("");

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
          const target = Math.max(0.08, Math.min(1.2, 0.08 + level * base * 1.5 + jitter));
          const smoothing = level > prevScale ? 0.65 : 0.3;
          const next = prevScale * (1 - smoothing) + target * smoothing;
          return Number(next.toFixed(3));
        });
      });
    },
  });

  // Keep stopRecording ref current for the silence auto-stop
  stopRecordingRef.current = stopRecording;

  const responseCardRef = useRef<HTMLDivElement>(null);

  // Show response card when narration text exists and we're speaking or just finished
  const showResponseCard = Boolean(narrationText) && (effectiveState === "speaking" || effectiveState === "idle") && !isRecording;

  const workingLabel =
    workingElapsed < 6 ? "Investigating..." :
    workingElapsed < 18 ? "Working on it..." :
    "Almost done...";

  const statusMessage = error
    ? error
    : isRecording
      ? "Listening..."
      : effectiveState === "thinking"
        ? workingLabel
        : effectiveState === "acting"
          ? workingLabel
          : effectiveState === "speaking"
            ? "Responding..."
            : effectiveState === "listening"
              ? "Processing..."
              : "Press Space to start";

  // Bump statusKey to re-trigger fade animation when text changes
  useEffect(() => {
    if (statusMessage !== prevStatusRef.current) {
      prevStatusRef.current = statusMessage;
      setStatusKey((k) => k + 1);
    }
  }, [statusMessage]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Entrance animation on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Auto-show overlay when the response card becomes visible
  useEffect(() => {
    if (showResponseCard) {
      window.desktop?.shortcut?.showPopover?.();
    }
  }, [showResponseCard]);

  // Auto-scroll response card to bottom as narration text streams in
  useEffect(() => {
    if (responseCardRef.current) {
      responseCardRef.current.scrollTop = responseCardRef.current.scrollHeight;
    }
  }, [narrationText]);

  // Resize window when response card shows/hides
  useEffect(() => {
    if (showResponseCard) {
      window.desktop?.shortcut?.resizePopover?.(430, 300);
    } else {
      window.desktop?.shortcut?.resizePopover?.(430, 130);
    }
  }, [showResponseCard]);

  // Animate bars when speaking, go flat when idle
  useEffect(() => {
    if (effectiveState === "speaking") {
      window.desktop?.shortcut?.repositionPopover?.("center");
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
      setWorkingElapsed(0);
      const startTime = Date.now();
      const elapsedId = setInterval(() => {
        setWorkingElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      window.desktop?.shortcut?.repositionPopover?.("top-right");
      const id = setInterval(() => {
        const t = Date.now() / 1000;
        setBarScales(
          FLAT_SCALE.map((base, i) => {
            const wave = Math.sin(t * 4 - i * 0.6) * 0.08 + 0.04;
            return Number((base + Math.max(0, wave)).toFixed(3));
          })
        );
      }, 40);
      return () => { clearInterval(id); clearInterval(elapsedId); };
    }

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
      <section className={`voice-popover-shell ${entered ? "voice-popover-shell--entered" : ""}`} aria-live="polite">
        <div className="voice-pill-wrapper">
          <button
            type="button"
            className={`voice-meter-pill ${isRecording ? "voice-meter-pill--recording" : ""} ${effectiveState === "speaking" ? "voice-meter-pill--speaking" : ""} ${(effectiveState === "thinking" || effectiveState === "acting") ? "voice-meter-pill--working" : ""} ${error ? "voice-meter-pill-error" : ""}`}
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
          {(effectiveState === "thinking" || effectiveState === "acting") && (
            <button
              type="button"
              className="voice-cancel-btn"
              onClick={sendInterrupt}
              title="Cancel task"
              aria-label="Cancel task"
            >
              ✕
            </button>
          )}
          {effectiveState === "speaking" && (
            <button
              type="button"
              className="voice-cancel-btn"
              onClick={() => audioPlayer.stop()}
              title="Stop response"
              aria-label="Stop response"
            >
              ■
            </button>
          )}
        </div>
        <p
          key={statusKey}
          className={`voice-popover-status ${error ? "voice-popover-status-error" : ""}`}
        >
          {statusMessage}
        </p>
        {showResponseCard && (
          <div className="voice-response-card">
            <div className="voice-response-scroll" ref={responseCardRef}>
              <p className="voice-response-text">{narrationText}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
