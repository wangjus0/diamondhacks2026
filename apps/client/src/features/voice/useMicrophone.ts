import { useState, useRef, useCallback } from "react";
import { float32ToPcm16Base64 } from "../../lib/audio-utils";
import {
  getSilentCaptureErrorMessage,
  MICROPHONE_FRAME_WATCHDOG_MS,
  shouldTreatCaptureAsSilent,
} from "./microphoneCaptureHealth";

interface UseMicrophoneOptions {
  onAudioChunk: (base64: string) => void;
  onStop: () => void;
  onError?: (message: string) => void;
  onAudioLevel?: (level: number) => void;
}

function getMicrophoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone access was blocked. Allow mic permissions in your browser and try again.";
    }

    if (error.name === "NotFoundError") {
      return "No microphone was found. Connect a mic and try again.";
    }

    if (error.name === "NotReadableError") {
      return "Your microphone is busy in another app. Close other apps using the mic and retry.";
    }

    if (error.name === "OverconstrainedError") {
      return "Microphone settings are unsupported on this device. Try another input device.";
    }
  }

  return "Unable to start microphone recording. Check browser permissions and try again.";
}

export function useMicrophone({
  onAudioChunk,
  onStop,
  onError,
  onAudioLevel,
}: UseMicrophoneOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const captureStartedAtMsRef = useRef<number | null>(null);
  const hasReceivedAudioFrameRef = useRef(false);
  const hasGrantedSilentCaptureGraceRef = useRef(false);
  const isCaptureActiveRef = useRef(false);
  const captureWatchdogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCaptureWatchdog = useCallback(() => {
    if (captureWatchdogTimeoutRef.current !== null) {
      clearTimeout(captureWatchdogTimeoutRef.current);
      captureWatchdogTimeoutRef.current = null;
    }
  }, []);

  const stopActiveRecording = useCallback(
    (notifyStop: boolean) => {
      const wasActive = isCaptureActiveRef.current;
      if (!wasActive) {
        return;
      }

      isCaptureActiveRef.current = false;
      clearCaptureWatchdog();

      processorRef.current?.disconnect();
      void ctxRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());

      processorRef.current = null;
      ctxRef.current = null;
      streamRef.current = null;
      captureStartedAtMsRef.current = null;
      hasReceivedAudioFrameRef.current = false;
      hasGrantedSilentCaptureGraceRef.current = false;

      setIsRecording(false);
      onAudioLevel?.(0);

      if (notifyStop && wasActive) {
        onStop();
      }
    },
    [clearCaptureWatchdog, onAudioLevel, onStop]
  );

  const scheduleCaptureWatchdog = useCallback(() => {
    clearCaptureWatchdog();

    captureWatchdogTimeoutRef.current = setTimeout(() => {
      const startedAtMs = captureStartedAtMsRef.current;
      if (startedAtMs === null) {
        return;
      }

      const elapsedMs = Date.now() - startedAtMs;
      const shouldFailCapture = shouldTreatCaptureAsSilent({
        elapsedMs,
        hasReceivedAudioFrame: hasReceivedAudioFrameRef.current,
      });
      if (!shouldFailCapture) {
        return;
      }

      // Give capture one extra watchdog window before force-stopping.
      if (!hasGrantedSilentCaptureGraceRef.current) {
        hasGrantedSilentCaptureGraceRef.current = true;
        captureStartedAtMsRef.current = Date.now();
        scheduleCaptureWatchdog();
        return;
      }

      onError?.(getSilentCaptureErrorMessage());
      stopActiveRecording(true);
    }, MICROPHONE_FRAME_WATCHDOG_MS);
  }, [clearCaptureWatchdog, onError, stopActiveRecording]);

  const startRecording = useCallback(async (): Promise<boolean> => {
    const desktopPermissions = window.desktop?.permissions;
    if (desktopPermissions?.requestMicrophoneAccess) {
      const granted = await desktopPermissions.requestMicrophoneAccess();
      if (!granted) {
        onError?.(
          "Microphone access is not enabled. Allow microphone access for Murmur in system privacy settings, then try Start again."
        );
        return false;
      }
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.(
        "Microphone is unavailable in this runtime. Make sure microphone access is enabled for Murmur and try again."
      );
      return false;
    }

    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      ctx = new AudioContext({ sampleRate: 16000 });
      const source = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        hasReceivedAudioFrameRef.current = true;
        const samples = e.inputBuffer.getChannelData(0);
        const meanSquare = samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length;
        const rms = Math.sqrt(meanSquare);
        const normalizedLevel = Math.min(1, rms * 8);
        const base64 = float32ToPcm16Base64(samples);
        onAudioLevel?.(normalizedLevel);
        onAudioChunk(base64);
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      await ctx.resume();

      ctxRef.current = ctx;
      streamRef.current = stream;
      processorRef.current = processor;
      captureStartedAtMsRef.current = Date.now();
      hasReceivedAudioFrameRef.current = false;
      hasGrantedSilentCaptureGraceRef.current = false;
      isCaptureActiveRef.current = true;
      setIsRecording(true);
      onAudioLevel?.(0);

      scheduleCaptureWatchdog();

      return true;
    } catch (error) {
      clearCaptureWatchdog();
      captureStartedAtMsRef.current = null;
      hasReceivedAudioFrameRef.current = false;
      hasGrantedSilentCaptureGraceRef.current = false;
      isCaptureActiveRef.current = false;
      processor?.disconnect();
      await ctx?.close();
      stream?.getTracks().forEach((track) => track.stop());
      onError?.(getMicrophoneErrorMessage(error));
      return false;
    }
  }, [clearCaptureWatchdog, onAudioChunk, onAudioLevel, onError, scheduleCaptureWatchdog]);

  const stopRecording = useCallback(() => {
    stopActiveRecording(true);
  }, [stopActiveRecording]);

  return { startRecording, stopRecording, isRecording };
}
