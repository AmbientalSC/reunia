import { useState, useEffect, useCallback } from 'react';

export interface TranscriptionSegment {
  speaker: 'mic' | 'system' | 'unknown';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

/**
 * Hook to receive real-time transcription segments from the main process.
 */
export function useTranscription() {
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [latestSegment, setLatestSegment] = useState<TranscriptionSegment | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const cleanup = (window as any).electronAPI?.onTranscription(
      (segment: TranscriptionSegment) => {
        setSegments((prev) => [...prev, segment]);
        setLatestSegment(segment);
        if (!isConnected) setIsConnected(true);
      }
    );

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const clearTranscription = useCallback(() => {
    setSegments([]);
    setLatestSegment(null);
  }, []);

  /**
   * Get the full transcript as a continuous string.
   */
  const getFullTranscript = useCallback((): string => {
    return segments.map((s) => s.text).join(' ');
  }, [segments]);

  /**
   * Get transcript grouped by speaker.
   */
  const getTranscriptBySpeaker = useCallback(() => {
    const mic: string[] = [];
    const system: string[] = [];
    const unknown: string[] = [];

    for (const seg of segments) {
      switch (seg.speaker) {
        case 'mic':
          mic.push(seg.text);
          break;
        case 'system':
          system.push(seg.text);
          break;
        default:
          unknown.push(seg.text);
      }
    }

    return { mic: mic.join(' '), system: system.join(' '), unknown: unknown.join(' ') };
  }, [segments]);

  return {
    segments,
    latestSegment,
    isConnected,
    clearTranscription,
    getFullTranscript,
    getTranscriptBySpeaker,
  };
}
