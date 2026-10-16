'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveInsightData } from '@/types';
import { liveInsightService } from '@/services/liveInsightService';
import { liveInsightStore } from '@/lib/liveInsightStore';
import { buildInsightExcerpt } from '@/lib/insight-excerpt';
import { INSIGHT_FAILURE_DURATION_MS, shouldRunInsight } from '@/lib/insight-schedule';

/** How often the schedule is re-checked while recording (the rest period may have ended). */
const SCHEDULE_CHECK_MS = 3000;

export type LiveInsightStatus = 'idle' | 'generating' | 'ready' | 'error';

interface TranscriptSegmentLike {
  text: string;
}

/**
 * Generates a lightweight, real-time insight from the most recent finalized
 * transcript segments while a meeting is being recorded. Separate from the
 * post-meeting summary/report pipeline and the "Tela" visual summary — this is
 * a single stateless LLM call per run.
 *
 * Runs as soon as there is enough transcript and then whenever there is new
 * speech (see `shouldRunInsight`). The latest insight is mirrored into
 * `liveInsightStore` so it survives this component being unmounted; when the
 * recording is saved, `persistLiveInsight` completes it with the final
 * transcript and stores it with the meeting.
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
  const lastRunEndedAtRef = useRef<number | null>(null);
  const lastDurationMsRef = useRef<number | null>(null);

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

  const runGeneration = useCallback(async () => {
    const currentSegments = segmentsRef.current;
    if (currentSegments.length === 0) return;
    if (!providerRef.current || !modelRef.current) {
      setError('Nenhum modelo de IA configurado para o resumo.');
      setStatus('error');
      return;
    }

    // A slow model can finish after the recording ended and another one started:
    // such a result belongs to a session that no longer exists and is dropped.
    const runSession = liveInsightStore.session();
    const isStale = () => runSession !== liveInsightStore.session();

    isGeneratingRef.current = true;
    setStatus('generating');
    setError(null);

    const startedAt = Date.now();
    let failed = false;
    try {
      const result = await liveInsightService.generateLiveInsight(
        buildInsightExcerpt(currentSegments),
        providerRef.current,
        modelRef.current
      );
      if (isStale()) return;

      lastAnalyzedCountRef.current = currentSegments.length;
      liveInsightStore.set(result, runSession, currentSegments.length);
      setInsight(result);
      setStatus('ready');
    } catch (err) {
      if (isStale()) return;

      failed = true;
      console.error('Failed to generate live insight:', err);
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    } finally {
      // A stale run must not touch the flags: the new session already reset them
      // and may have a run of its own in flight.
      if (!isStale()) {
        isGeneratingRef.current = false;
        lastRunEndedAtRef.current = Date.now();
        const duration = lastRunEndedAtRef.current - startedAt;
        lastDurationMsRef.current = failed
          ? Math.max(duration, INSIGHT_FAILURE_DURATION_MS)
          : duration;
      }
    }
  }, []);

  /** Manual refresh and scheduled runs: never overlaps another run. */
  const generateNow = useCallback((): Promise<void> => {
    if (isGeneratingRef.current) return Promise.resolve();

    const run = runGeneration();
    liveInsightStore.track(run);
    return run;
  }, [runGeneration]);

  const runIfDue = useCallback(() => {
    const due = shouldRunInsight({
      segmentCount: segmentsRef.current.length,
      analyzedCount: lastAnalyzedCountRef.current,
      isGenerating: isGeneratingRef.current,
      lastRunEndedAt: lastRunEndedAtRef.current,
      lastDurationMs: lastDurationMsRef.current,
      now: Date.now(),
    });

    if (due) void generateNow();
  }, [generateNow]);

  // React to new speech right away (the first insight must not wait for a timer)...
  const segmentCount = segments.length;
  useEffect(() => {
    if (isRecording && !isPaused) runIfDue();
  }, [segmentCount, isRecording, isPaused, runIfDue]);

  // ...and re-check periodically, since the rest period after a run may have ended.
  useEffect(() => {
    if (!isRecording || isPaused) return;

    const interval = setInterval(runIfDue, SCHEDULE_CHECK_MS);
    return () => clearInterval(interval);
  }, [isRecording, isPaused, runIfDue]);

  // A new recording starts clean: a new store session, so a generation that is
  // still running from the previous recording can no longer write into this one.
  const wasRecordingRef = useRef(isRecording);
  useEffect(() => {
    if (isRecording && !wasRecordingRef.current) {
      liveInsightStore.startSession();
      isGeneratingRef.current = false;
      setInsight(null);
      setStatus('idle');
      setError(null);
      lastAnalyzedCountRef.current = 0;
      lastRunEndedAtRef.current = null;
      lastDurationMsRef.current = null;
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording]);

  return { insight, status, error, generateNow };
}
