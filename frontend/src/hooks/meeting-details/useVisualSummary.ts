import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { VisualSummaryData, VisualSummaryResponse } from '@/types';

export type VisualSummaryStatus =
  | 'idle'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface VisualSummaryEventPayload {
  meeting_id: string;
  status: string;
  error?: string | null;
}

function normalizeStatus(status: string): VisualSummaryStatus {
  switch (status.toLowerCase()) {
    case 'pending':
    case 'processing':
      return 'generating';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'idle';
  }
}

/**
 * Loads and tracks the visual summary ("Tela") of a meeting.
 *
 * The backend generates it automatically right after the regular summary
 * completes (chained second dispatch) and emits `visual-summary-update`
 * events; this hook refetches on those events and also exposes a manual
 * trigger for older meetings and retries.
 */
export function useVisualSummary(meetingId: string) {
  const [data, setData] = useState<VisualSummaryData | null>(null);
  const [status, setStatus] = useState<VisualSummaryStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);

  const meetingIdRef = useRef(meetingId);
  // Monotonic version so only the latest in-flight fetch may apply state,
  // even when the user navigates away and back to the same meeting.
  const fetchVersionRef = useRef(0);

  useEffect(() => {
    meetingIdRef.current = meetingId;
  }, [meetingId]);

  const fetchVisualSummary = useCallback(async () => {
    const requestedMeetingId = meetingId;
    const version = fetchVersionRef.current + 1;
    fetchVersionRef.current = version;
    try {
      const response = await invoke<VisualSummaryResponse>('api_get_visual_summary', {
        meetingId: requestedMeetingId,
      });
      if (fetchVersionRef.current !== version || meetingIdRef.current !== requestedMeetingId) {
        return;
      }

      setData(response.data);
      setStatus(normalizeStatus(response.status));
      setError(response.error);
      setUpdatedAt(response.updated_at);
    } catch (err) {
      if (fetchVersionRef.current !== version || meetingIdRef.current !== requestedMeetingId) {
        return;
      }
      console.error('Failed to load visual summary:', err);
      setStatus('idle');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [meetingId]);

  const fetchRef = useRef(fetchVisualSummary);
  useEffect(() => {
    fetchRef.current = fetchVisualSummary;
  }, [fetchVisualSummary]);

  // Load persisted state when the meeting changes
  useEffect(() => {
    setData(null);
    setStatus('idle');
    setError(null);
    setUpdatedAt(null);
    setIsTriggering(false);
    fetchVisualSummary();
  }, [fetchVisualSummary]);

  // React to backend progress events (chained or manual generation).
  // Registered once for the hook's lifetime; the callback reads the current
  // meeting through refs, so no re-subscription on meeting switches.
  useEffect(() => {
    let disposed = false;
    let unlistenFn: (() => void) | null = null;

    listen<VisualSummaryEventPayload>('visual-summary-update', (event) => {
      if (event.payload.meeting_id !== meetingIdRef.current) return;

      if (normalizeStatus(event.payload.status) === 'generating') {
        setStatus('generating');
        setError(null);
        return;
      }
      // completed / failed / cancelled: reload the persisted row
      fetchRef.current();
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      })
      .catch((err) => {
        console.error('Failed to listen for visual summary events:', err);
      });

    return () => {
      disposed = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const generateVisualSummary = useCallback(
    async (provider: string | null, model: string | null) => {
      if (!provider || !model) {
        toast.error('Nenhum modelo de IA configurado', {
          description: 'Configure o modelo nas configurações do resumo.',
        });
        return;
      }

      const requestedMeetingId = meetingId;
      setIsTriggering(true);
      try {
        await invoke('api_generate_visual_summary', {
          meetingId: requestedMeetingId,
          model: provider,
          modelName: model,
        });
        if (meetingIdRef.current !== requestedMeetingId) return;
        setStatus('generating');
        setError(null);
      } catch (err) {
        if (meetingIdRef.current !== requestedMeetingId) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to trigger visual summary generation:', err);
        toast.error('Falha ao gerar a tela visual', { description: message });
      } finally {
        if (meetingIdRef.current === requestedMeetingId) {
          setIsTriggering(false);
        }
      }
    },
    [meetingId]
  );

  return {
    visualData: data,
    visualStatus: status,
    visualError: error,
    visualUpdatedAt: updatedAt,
    isGeneratingVisual: status === 'generating' || isTriggering,
    generateVisualSummary,
    refreshVisualSummary: fetchVisualSummary,
  };
}
