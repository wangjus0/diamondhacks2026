import { useState, useRef, useCallback } from "react";
import { base64ToBlob } from "../../lib/audio-utils";

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);

  const cleanupCurrentAudio = useCallback(() => {
    const currentAudio = audioRef.current;
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      audioRef.current = null;
    }

    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      cleanupCurrentAudio();
      return;
    }

    isPlayingRef.current = true;
    setIsPlaying(true);

    const base64 = queueRef.current.shift()!;
    const blob = base64ToBlob(base64, "audio/mpeg");
    const url = URL.createObjectURL(blob);

    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onended = () => {
      if (audioRef.current !== audio) {
        return;
      }
      audioRef.current = null;
      playNext();
    };

    audio.onerror = () => {
      if (audioRef.current !== audio) {
        return;
      }
      audioRef.current = null;
      playNext();
    };

    audio.play().catch((err) => {
      if (audioRef.current !== audio) {
        return;
      }
      console.error("[AudioPlayer] Playback failed:", err);
      audioRef.current = null;
      playNext();
    });
  }, [cleanupCurrentAudio]);

  const enqueue = useCallback(
    (base64Audio: string) => {
      queueRef.current.push(base64Audio);
      if (!isPlayingRef.current) {
        playNext();
      }
    },
    [playNext]
  );

  const stop = useCallback(() => {
    queueRef.current = [];
    isPlayingRef.current = false;
    cleanupCurrentAudio();
    setIsPlaying(false);
  }, [cleanupCurrentAudio]);

  return { enqueue, stop, isPlaying };
}
