import { useSession } from "./hooks/useSession";
import { useAudioPlayer } from "./features/narration/useAudioPlayer";
import { StateBadge } from "./features/voice/StateBadge";
import { TranscriptPanel } from "./features/transcript/TranscriptPanel";
import { NarrationPanel } from "./features/narration/NarrationPanel";
import { MicButton } from "./features/voice/MicButton";
import { useSessionStore } from "./store/session";

export function App() {
  const audioPlayer = useAudioPlayer();
  const { sendStartSession, sendAudioChunk, sendAudioEnd, sendInterrupt } =
    useSession(audioPlayer);

  const turnState = useSessionStore((s) => s.turnState);
  const intent = useSessionStore((s) => s.intent);
  const actionStatuses = useSessionStore((s) => s.actionStatuses);
  const error = useSessionStore((s) => s.error);

  const micDisabled =
    turnState === "thinking" || turnState === "acting" || turnState === "speaking";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#11111b",
        color: "#cdd6f4",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "640px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "24px" }}>Diamond Voice Agent</h1>
          <StateBadge />
        </div>

        {/* Transcript */}
        <TranscriptPanel />

        {/* Intent */}
        {intent && (
          <div
            style={{
              padding: "8px 16px",
              background: "#313244",
              borderRadius: "8px",
              fontSize: "14px",
            }}
          >
            Intent: <strong>{intent.intent}</strong> (confidence:{" "}
            {(intent.confidence * 100).toFixed(0)}%)
          </div>
        )}

        {/* Action Status Feed */}
        {actionStatuses.length > 0 && (
          <div
            style={{
              padding: "12px 16px",
              background: "#1e1e2e",
              borderRadius: "8px",
              borderLeft: "3px solid #89b4fa",
            }}
          >
            <h4 style={{ margin: "0 0 8px", color: "#89b4fa", fontSize: "14px" }}>
              Browser Actions
            </h4>
            {actionStatuses.map((msg, i) => (
              <div
                key={i}
                style={{
                  fontSize: "13px",
                  color: "#a6adc8",
                  padding: "2px 0",
                }}
              >
                {msg}
              </div>
            ))}
          </div>
        )}

        {/* Narration */}
        <NarrationPanel isPlaying={audioPlayer.isPlaying} />

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "8px 16px",
              background: "#45243e",
              borderRadius: "8px",
              color: "#f38ba8",
            }}
          >
            {error}
          </div>
        )}

        {/* Controls */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "12px",
            padding: "16px 0",
          }}
        >
          <MicButton
            onAudioChunk={sendAudioChunk}
            onStartSession={sendStartSession}
            onStop={sendAudioEnd}
            disabled={micDisabled}
          />
          {(turnState === "acting" || turnState === "speaking") && (
            <button
              onClick={sendInterrupt}
              style={{
                padding: "16px 32px",
                fontSize: "18px",
                fontWeight: "bold",
                border: "2px solid #f38ba8",
                borderRadius: "50px",
                cursor: "pointer",
                color: "#f38ba8",
                background: "transparent",
              }}
            >
              Interrupt
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
