import { useState } from "react";
import { useSession } from "./hooks/useSession";
import { useAudioPlayer } from "./features/narration/useAudioPlayer";
import { StateBadge } from "./features/voice/StateBadge";
import { TranscriptPanel } from "./features/transcript/TranscriptPanel";
import { NarrationPanel } from "./features/narration/NarrationPanel";
import { MicButton } from "./features/voice/MicButton";
import { ActionTimeline } from "./features/browser/ActionTimeline";
import { useAuth } from "./features/auth/AuthProvider";
import { useSessionStore } from "./store/session";

export function App() {
  const { signOut, authError, clearAuthError } = useAuth();
  const audioPlayer = useAudioPlayer();
  const { sendStartSession, sendAudioChunk, sendAudioEnd, sendInterrupt } =
    useSession(audioPlayer);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const turnState = useSessionStore((s) => s.turnState);
  const intent = useSessionStore((s) => s.intent);
  const actionStatuses = useSessionStore((s) => s.actionStatuses);
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);

  const micDisabled =
    turnState === "thinking" || turnState === "acting" || turnState === "speaking";
  const canInterrupt = turnState === "acting" || turnState === "speaking";

  const handleSignOut = async () => {
    clearAuthError();
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="screen app-screen">
      <div className="app-frame">
        <aside className="app-rail" aria-label="Primary navigation">
          <div className="rail-logo" aria-hidden="true">MU</div>
          <button className="rail-item rail-item-active" aria-label="Home" type="button">H</button>
          <button className="rail-item" aria-label="Timeline" type="button">T</button>
          <button className="rail-item" aria-label="Actions" type="button">A</button>
          <button className="rail-item" aria-label="Settings" type="button">S</button>
        </aside>

        <div className="app-workspace">
          <header className="app-topbar">
            <div className="app-title-group">
              <p className="app-titlebar-label">Murmur</p>
              <p className="app-titlebar-subtitle">Voice ops dashboard</p>
            </div>

            <div className="search-wrap" role="search">
              <span className="search-icon" aria-hidden="true">◦</span>
              <input
                className="search-input"
                type="search"
                placeholder="Search commands, intents, or sessions"
                aria-label="Search"
              />
            </div>

            <div className="topbar-actions">
              <StateBadge />
              <button
                type="button"
                onClick={() => {
                  void handleSignOut();
                }}
                disabled={isSigningOut}
                className="button button-secondary"
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </header>

          <div className="app-dashboard">
            <section className="panel stack-panel hero-card">
              <p className="eyebrow">Voice Operations Console</p>
              <h1 className="app-title">Murmur Voice Agent</h1>
              <p className="subtitle">
                Speak naturally and the assistant transcribes, reasons, and executes browser actions in real time.
              </p>

              <div className="utility-grid">
                <div className="utility-metric">
                  <span className="utility-label">Turn State</span>
                  <strong className="utility-value">{turnState}</strong>
                </div>
                <div className="utility-metric">
                  <span className="utility-label">Queued Actions</span>
                  <strong className="utility-value">{actionStatuses.length}</strong>
                </div>
              </div>

              {intent && (
                <div className="alert alert-info">
                  Intent: <strong>{intent.intent}</strong> (confidence: {(intent.confidence * 100).toFixed(0)}%)
                </div>
              )}

              {authError && <div className="alert alert-danger">{authError}</div>}
              {error && <div className="alert alert-danger">{error}</div>}

              <div className="control-row">
                <MicButton
                  onAudioChunk={sendAudioChunk}
                  onStartSession={sendStartSession}
                  onStop={sendAudioEnd}
                  onError={setError}
                  disabled={micDisabled}
                />
                <button onClick={sendInterrupt} disabled={!canInterrupt} className="button button-danger">
                  Interrupt
                </button>
              </div>
            </section>

            <TranscriptPanel />
            <ActionTimeline />

            {actionStatuses.length > 0 && (
              <div className="panel stack-panel actions-panel">
                <h4 className="panel-heading">Browser Actions</h4>
                <div className="event-list">
                  {actionStatuses.map((msg, i) => (
                    <div key={i} className="event-item">{msg}</div>
                  ))}
                </div>
              </div>
            )}

            <NarrationPanel isPlaying={audioPlayer.isPlaying} />

            <section className="panel stack-panel utility-card">
              <h4 className="panel-heading">Session Status</h4>
              <p className="status-note">Realtime assistant session</p>
              <div className="utility-grid">
                <div className="utility-metric">
                  <span className="utility-label">Turn State</span>
                  <strong className="utility-value">{turnState}</strong>
                </div>
                <div className="utility-metric">
                  <span className="utility-label">Queued Actions</span>
                  <strong className="utility-value">{actionStatuses.length}</strong>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
