import { useEffect, useRef } from "react";
import { useSessionStore } from "../../store/session";

export function TranscriptPanel() {
  const transcriptFinals = useSessionStore((s) => s.transcriptFinals);
  const transcriptPartial = useSessionStore((s) => s.transcriptPartial);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
  }, [transcriptFinals, transcriptPartial]);

  return (
    <div className="panel stack-panel scroll-panel transcript-panel">
      <h3 className="panel-heading">Transcript</h3>
      {transcriptFinals.map((text, i) => (
        <p
          key={i}
          className="transcript-line"
          style={{ ["--item-index" as string]: i }}
        >
          {text}
        </p>
      ))}
      {transcriptPartial && (
        <p className="transcript-partial transcript-line transcript-line-partial">
          {transcriptPartial}
        </p>
      )}
      {transcriptFinals.length === 0 && !transcriptPartial && (
        <p className="transcript-empty">
          Click Start and speak to begin...
        </p>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
