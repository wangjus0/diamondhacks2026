import { useSessionStore } from "../../store/session";

interface NarrationPanelProps {
  isPlaying: boolean;
}

export function NarrationPanel({ isPlaying }: NarrationPanelProps) {
  const narrationText = useSessionStore((s) => s.narrationText);

  if (!narrationText) return null;

  return (
    <div className="panel stack-panel narration-panel narration-panel-live">
      <div className="narration-header">
        <h3 className="panel-heading">Narration</h3>
        {isPlaying && (
          <span className="badge badge-listening">
            Speaking...
          </span>
        )}
      </div>
      <p>{narrationText}</p>
    </div>
  );
}
