import { useState, useRef, useCallback } from "react";
import { AUDIO_SAMPLE_RATE } from "@murmur/shared";
import { float32ToPcm16Base64, resampleFloat32 } from "../../lib/audio-utils";
import {
  getSilentCaptureErrorMessage,
  MICROPHONE_FRAME_WATCHDOG_MS,
  shouldTreatCaptureAsSilent,
} from "./microphoneCaptureHealth";

interface UseMicrophoneOptions {
  onAudioChunk: (base64: string) => void;
  onStop: () => void;
  onStart?: () => void;
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
  onStart,
  onError,
  onAudioLevel,
}: UseMicrophoneOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterAnimationFrameRef = useRef<number | null>(null);
  const recordingActiveRef = useRef(false);
  const captureStartedAtMsRef = useRef<number | null>(null);
  const hasReceivedAudioFrameRef = useRef(false);
  const hasGrantedSilentCaptureGraceRef = useRef(false);
  const captureWatchdogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCaptureWatchdog = useCallback(() => {
    if (captureWatchdogTimeoutRef.current !== null) {
      clearTimeout(captureWatchdogTimeoutRef.current);
      captureWatchdogTimeoutRef.current = null;
    }
  }, []);

  const stopActiveRecording = useCallback(
    (notifyStop: boolean) => {
      if (!recordingActiveRef.current) {
        return;
      }
      recordingActiveRef.current = false;

      clearCaptureWatchdog();

      if (meterAnimationFrameRef.current !== null) {
        cancelAnimationFrame(meterAnimationFrameRef.current);
        meterAnimationFrameRef.current = null;
      }

      processorRef.current?.disconnect();
      analyserRef.current?.disconnect();
      void ctxRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());

      processorRef.current = null;
      analyserRef.current = null;
      ctxRef.current = null;
      streamRef.current = null;
      captureStartedAtMsRef.current = null;
      hasReceivedAudioFrameRef.current = false;
      hasGrantedSilentCaptureGraceRef.current = false;

      setIsRecording(false);
      onAudioLevel?.(0);

      if (notifyStop) {
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
    let analyser: AnalyserNode | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      processor = ctx.createScriptProcessor(4096, 1, 1);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      const processMeterLevel = () => {
        const activeAnalyser = analyserRef.current;
        if (!recordingActiveRef.current || !activeAnalyser) {
          return;
        }

        const timeDomain = new Uint8Array(activeAnalyser.fftSize);
        activeAnalyser.getByteTimeDomainData(timeDomain);
        let sumSquares = 0;
        for (let i = 0; i < timeDomain.length; i += 1) {
          const normalized = (timeDomain[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }

        const rms = Math.sqrt(sumSquares / timeDomain.length);
        onAudioLevel?.(Math.min(1, rms * 10));
        meterAnimationFrameRef.current = requestAnimationFrame(processMeterLevel);
      };

      processor.onaudioprocess = (e) => {
        hasReceivedAudioFrameRef.current = true;
        const samples = e.inputBuffer.getChannelData(0);
        const normalizedSamples =
          ctx && ctx.sampleRate !== AUDIO_SAMPLE_RATE
            ? resampleFloat32(samples, ctx.sampleRate, AUDIO_SAMPLE_RATE)
            : samples;
        const base64 = float32ToPcm16Base64(normalizedSamples);
        onAudioChunk(base64);
      };

      onStart?.();

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);
      await ctx.resume();

      ctxRef.current = ctx;
      streamRef.current = stream;
      processorRef.current = processor;
      analyserRef.current = analyser;
      captureStartedAtMsRef.current = Date.now();
      hasReceivedAudioFrameRef.current = false;
      hasGrantedSilentCaptureGraceRef.current = false;
      recordingActiveRef.current = true;
      setIsRecording(true);
      onAudioLevel?.(0);
      meterAnimationFrameRef.current = requestAnimationFrame(processMeterLevel);

      scheduleCaptureWatchdog();

      return true;
    } catch (error) {
      clearCaptureWatchdog();
      recordingActiveRef.current = false;
      captureStartedAtMsRef.current = null;
      hasReceivedAudioFrameRef.current = false;
      hasGrantedSilentCaptureGraceRef.current = false;
      if (meterAnimationFrameRef.current !== null) {
        cancelAnimationFrame(meterAnimationFrameRef.current);
        meterAnimationFrameRef.current = null;
      }
      processor?.disconnect();
      analyser?.disconnect();
      await ctx?.close();
      stream?.getTracks().forEach((track) => track.stop());
      onError?.(getMicrophoneErrorMessage(error));
      return false;
    }
  }, [
    clearCaptureWatchdog,
    onAudioChunk,
    onAudioLevel,
    onError,
    onStart,
    scheduleCaptureWatchdog,
    stopActiveRecording,
  ]);

  const stopRecording = useCallback(() => {
    stopActiveRecording(true);
  }, [stopActiveRecording]);

  return { startRecording, stopRecording, isRecording };
}
