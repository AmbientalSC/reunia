'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveInsightData } from '@/types';
import { liveInsightService } from '@/services/liveInsightService';

export const MIN_SEGMENTS_BEFORE_FIRST_INSIGHT = 6;
const MIN_NEW_SEGMENTS_BETWEEN_RUNS = 6;
const POLL_INTERVAL_MS = 20000;
const MAX_EXCERPT_SEGMENTS = 40;

export type LiveInsightStatus = 'idle' | 'generating' | 'ready' | 'error';

interface TranscriptSegmentLike {
  text: string;
}

/**
 * Periodically generates a lightweight, real-time insight from the most
 * recent finalized transcript segments while a meeting is being recorded.
 * Separate from the post-meeting summary/report pipeline and the "Tela"
 * visual summary — this is a single stateless LLM call per poll, nothing
 * persisted.
 */
export function useLiveInsight(
  segments: TranscriptSegmentLike[],
  isRecording: boolean,
  isPaused: boolean,
  provider: string,
  model: string
) {
  const [insight, setInsight] = useState<LiveInsightData | null>(null);
  const [status, setStatus] = useState<LiveInsightStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const isGeneratingRef = useRef(false);
  const lastAnalyzedCountRef = useRef(0);

  const segmentsRef = useRef(segments);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const providerRef = useRef(provider);
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const generateNow = useCallback(async () => {
    if (isGeneratingRef.current) return;

    const currentSegments = segmentsRef.current;
    if (currentSegments.length === 0) return;
    if (!providerRef.current || !modelRef.current) {
      setError('Nenhum modelo de IA configurado para o resumo.');
      setStatus('error');
      return;
    }

    isGeneratingRef.current = true;
    setStatus('generating');
    setError(null);

    try {
      const excerpt = currentSegments
        .slice(-MAX_EXCERPT_SEGMENTS)
        .map((segment) => segment.text)
        .filter(Boolean)
        .join('\n');

      const result = await liveInsightService.generateLiveInsight(
        excerpt,
        providerRef.current,
        modelRef.current
      );

      lastAnalyzedCountRef.current = currentSegments.length;
      setInsight(result);
      setStatus('ready');
    } catch (err) {
      console.error('Failed to generate live insight:', err);
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    } finally {
      isGeneratingRef.current = false;
    }
  }, []);

  // Periodic polling while actively recording (not paused).
  useEffect(() => {
    if (!isRecording || isPaused) return;

    const interval = setInterval(() => {
      const currentSegments = segmentsRef.current;
      const grownEnough =
        currentSegments.length >= MIN_SEGMENTS_BEFORE_FIRST_INSIGHT &&
        currentSegments.length - lastAnalyzedCountRef.current >= MIN_NEW_SEGMENTS_BETWEEN_RUNS;

      if (grownEnough) {
        void generateNow();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isRecording, isPaused, generateNow]);

  // Reset when a new recording starts.
  const wasRecordingRef = useRef(isRecording);
  useEffect(() => {
    if (isRecording && !wasRecordingRef.current) {
      setInsight(null);
      setStatus('idle');
      setError(null);
      lastAnalyzedCountRef.current = 0;
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording]);

  return { insight, status, error, generateNow };
}
