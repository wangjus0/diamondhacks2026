import { useMicrophone } from "./useMicrophone";

interface MicButtonProps {
  onAudioChunk: (base64: string) => void;
  onStartSession: () => void;
  onStop: () => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}

export function MicButton({
  onAudioChunk,
  onStartSession,
  onStop,
  onError,
  disabled,
}: MicButtonProps) {
  const { startRecording, stopRecording, isRecording } = useMicrophone({
    onAudioChunk,
    onStart: onStartSession,
    onStop,
    onError,
  });

  const handleClick = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    const started = await startRecording();
    if (started) {
      return;
    }
  };

  return (
    <div className="mic-wrap">
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`button mic-button ${isRecording ? "mic-recording" : "button-primary"}`}
      >
        {isRecording ? "Stop" : "Start"}
      </button>
      <span
        aria-live="polite"
        className={`status-hint ${isRecording ? "status-live" : "status-hidden"}`}
      >
        Listening...
      </span>
    </div>
  );
}
