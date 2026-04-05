import { useEffect, useRef } from "react";
import { useSessionStore } from "../../store/session";

export function ConversationTimeline() {
  const conversationHistory = useSessionStore((s) => s.conversationHistory);
  const turnState = useSessionStore((s) => s.turnState);
  const transcriptPartial = useSessionStore((s) => s.transcriptPartial);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [conversationHistory, transcriptPartial]);

  const hasContent =
    conversationHistory.length > 0 || transcriptPartial.length > 0;

  return (
    <div className="panel stack-panel scroll-panel conversation-timeline">
      <h3 className="panel-heading">Conversation</h3>

      {!hasContent && (
        <p className="conversation-empty">
          Your conversation history will appear here. Start speaking to begin.
        </p>
      )}

      {conversationHistory.map((entry, index) => (
        <div
          key={entry.id}
          className="conversation-entry"
          style={{ ["--item-index" as string]: index }}
        >
          <div className="conversation-question">
            <span className="conversation-role conversation-role-user">You</span>
            <span className="conversation-time">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <p className="conversation-text">{entry.question}</p>
          </div>

          {entry.answer !== null ? (
            <div className="conversation-answer">
              <span className="conversation-role conversation-role-assistant">
                Murmur
              </span>
              <p className="conversation-text">{entry.answer}</p>
            </div>
          ) : (
            <div className="conversation-answer conversation-answer-pending">
              <span className="conversation-role conversation-role-assistant">
                Murmur
              </span>
              <p className="conversation-text conversation-thinking">
                Thinking...
              </p>
            </div>
          )}
        </div>
      ))}

      {transcriptPartial && (
        <div className="conversation-entry conversation-entry-partial">
          <div className="conversation-question">
            <span className="conversation-role conversation-role-user">You</span>
            <p className="conversation-text conversation-partial-text">
              {transcriptPartial}
            </p>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
