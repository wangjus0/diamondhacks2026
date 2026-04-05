import { WebSocket, type RawData } from "ws";
import { STT_MODEL_ID, AUDIO_FORMAT, AUDIO_SAMPLE_RATE } from "@murmur/shared";

interface SttCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}

export class SttAdapter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private callbacks: SttCallbacks;

  constructor(apiKey: string, callbacks: SttCallbacks) {
    this.apiKey = apiKey;
    this.callbacks = callbacks;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
      url.searchParams.set("model_id", STT_MODEL_ID);
      url.searchParams.set("audio_format", AUDIO_FORMAT);
      url.searchParams.set("commit_strategy", "vad");
      url.searchParams.set("language_code", "en");

      this.ws = new WebSocket(url.toString(), {
        headers: { "xi-api-key": this.apiKey },
      });

      this.ws.on("open", () => {
        console.log("[STT] Connected to ElevenLabs");
        resolve();
      });

      this.ws.on("message", (data: RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            type?: string;
            message_type?: string;
            text?: string;
            reason?: string;
            error?: string;
          };
          const eventType = msg.message_type ?? msg.type;

          if (eventType === "partial_transcript" && msg.text?.trim()) {
            this.callbacks.onPartial(msg.text);
            return;
          }

          if (
            (eventType === "committed_transcript" ||
              eventType === "committed_transcript_with_timestamps" ||
              eventType === "final_transcript") &&
            msg.text?.trim()
          ) {
            this.callbacks.onFinal(msg.text);
            return;
          }

          if (eventType?.includes("error")) {
            const reason = msg.reason || msg.error || "Unknown STT error";
            this.callbacks.onError(reason);
          }
        } catch (err) {
          console.error("[STT] Failed to parse message:", err);
        }
      });

      this.ws.on("error", (err: Error) => {
        console.error("[STT] WebSocket error:", err.message);
        this.callbacks.onError(err.message);
        reject(err);
      });

      this.ws.on("close", (code, reasonBuffer) => {
        const reasonText = reasonBuffer.toString() || "no reason provided";
        console.log(`[STT] Connection closed (code=${code}, reason=${reasonText})`);
        if (code !== 1000 && code !== 1001) {
          this.callbacks.onError(reasonText);
        }
        this.ws = null;
      });
    });
  }

  sendAudio(base64Chunk: string): void {
    if (this.ws?.readyState === WebSocket.OPEN && base64Chunk.length > 0) {
      this.ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: base64Chunk,
          sample_rate: AUDIO_SAMPLE_RATE,
        })
      );
    }
  }

  close(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "client_closed");
    }
    this.ws = null;
  }
}
