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
  private closingByClient = false;
  private pendingChunks: string[] = [];

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
      this.closingByClient = false;

      this.ws.on("open", () => {
        console.log(`[STT] Connected to ElevenLabs (${this.pendingChunks.length} buffered chunks)`);
        // Flush any audio chunks that arrived before the connection opened
        for (const chunk of this.pendingChunks) {
          this.ws!.send(chunk);
        }
        this.pendingChunks = [];
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
            message?: string;
          };
          const eventType = msg.message_type ?? msg.type;

          if (eventType === "partial_transcript" && msg.text?.trim()) {
            this.callbacks.onPartial(msg.text);
            return;
          }

          if (
            (eventType === "final_transcript" ||
              eventType === "committed_transcript" ||
              eventType === "committed_transcript_with_timestamps") &&
            msg.text?.trim()
          ) {
            this.callbacks.onFinal(msg.text);
            return;
          }

          if (
            eventType?.includes("error") ||
            eventType === "input_error" ||
            eventType === "auth_error" ||
            eventType === "rate_limited"
          ) {
            const errorMessage =
              msg.reason ||
              msg.error ||
              msg.message ||
              "Speech recognition request was rejected.";
            this.callbacks.onError(errorMessage);
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

        if (!this.closingByClient && code !== 1000 && code !== 1001) {
          this.callbacks.onError(`Speech recognition disconnected (${code}: ${reasonText}).`);
        }

        this.ws = null;
      });
    });
  }

  sendAudio(base64Chunk: string): void {
    if (!base64Chunk.length) return;

    const message = JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: base64Chunk,
      sample_rate: AUDIO_SAMPLE_RATE,
    });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      // Buffer chunks until the connection opens
      this.pendingChunks.push(message);
    }
  }

  /**
   * Signal end-of-audio and wait for the final transcript before closing.
   * Returns a promise that resolves once the WebSocket is fully closed.
   */
  closeGracefully(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.ws = null;
        resolve();
        return;
      }

      this.closingByClient = true;

      // Give ElevenLabs time to flush the final transcript before closing
      const timeout = setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.close(1000, "client_closed");
        }
        resolve();
      }, 1500);

      this.ws.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws.close(1000, "client_closed");
    });
  }

  close(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.closingByClient = true;
      this.ws.close(1000, "client_closed");
      return;
    }

    this.ws = null;
  }
}
