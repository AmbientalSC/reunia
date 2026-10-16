import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LiveInsightData, Transcript } from '@/types';
import { liveInsightService } from '@/services/liveInsightService';
import type { LiveInsightStatus } from '@/hooks/useLiveInsight';

/** Upper bound of segments read when generating an insight for a saved meeting. */
const MAX_SEGMENTS = 20000;
const NO_TRANSCRIPT_ERROR = 'Esta reunião não tem transcrição para gerar o insight.';
const NO_MODEL_ERROR = 'Nenhum modelo de IA configurado para o resumo.';

async function fetchTranscriptText(meetingId: string): Promise<string> {
  const page = (await invoke('api_get_meeting_transcripts', {
    meetingId,
    limit: MAX_SEGMENTS,
    offset: 0,
  })) as { transcripts: Transcript[] };

  return page.transcripts
    .map((segment) => segment.text)
    .filter(Boolean)
    .join('\n');
}

/**
 * The insight of a saved meeting: loads the one saved when the recording ended
 * and can generate a new one from the whole transcript (for older meetings or
 * to refresh it). Generated insights are saved back with the meeting.
 */
export function useMeetingInsight(meetingId: string, provider: string, model: string) {
  const [insight, setInsight] = useState<LiveInsightData | null>(null);
  const [status, setStatus] = useState<LiveInsightStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Drops answers that arrive after the user moved to another meeting.
  const versionRef = useRef(0);
  const isGeneratingRef = useRef(false);

  useEffect(() => {
    const version = ++versionRef.current;
    // A generation started for the previous meeting must not block this one.
    isGeneratingRef.current = false;
    setInsight(null);
    setStatus('idle');
    setError(null);

    liveInsightService
      .getSaved(meetingId)
      .then((saved) => {
        if (version !== versionRef.current || !saved) return;
        setInsight(saved.data);
        setStatus('ready');
      })
      .catch((e) => console.error('Failed to load the saved insight:', e));
  }, [meetingId]);

  const generate = useCallback(async () => {
    if (isGeneratingRef.current) return;
    if (!provider || !model) {
      setError(NO_MODEL_ERROR);
      setStatus('error');
      return;
    }

    const version = versionRef.current;
    isGeneratingRef.current = true;
    setStatus('generating');
    setError(null);

    try {
      const text = await fetchTranscriptText(meetingId);
      if (!text.trim()) throw new Error(NO_TRANSCRIPT_ERROR);

      const result = await liveInsightService.generateLiveInsight(text, provider, model, true);
      if (version !== versionRef.current) return;

      setInsight(result);
      setStatus('ready');

      // The insight is already on screen; failing to save it only means it is lost on reload.
      liveInsightService
        .save(meetingId, result)
        .catch((e) => console.warn('Could not save the insight with the meeting:', e));
    } catch (e) {
      if (version !== versionRef.current) return;
      console.error('Failed to generate the meeting insight:', e);
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    } finally {
      if (version === versionRef.current) isGeneratingRef.current = false;
    }
  }, [meetingId, provider, model]);

  return { insight, status, error, generate };
}
