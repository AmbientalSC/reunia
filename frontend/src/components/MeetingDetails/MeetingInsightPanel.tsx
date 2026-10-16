"use client";

import { useCallback } from 'react';
import { LiveInsightPanel } from '@/components/LiveInsightPanel';
import { useMeetingInsight } from '@/hooks/meeting-details/useMeetingInsight';
import { Transcript } from '@/types';
import { windowAroundTerm } from '@/lib/ask-selection';

interface MeetingInsightPanelProps {
  meetingId: string;
  transcripts: Transcript[];
  provider: string;
  model: string;
}

/** "Insight" tab of a saved meeting: the insight kept from the recording, with keywords and "Perguntar à IA". */
export function MeetingInsightPanel({ meetingId, transcripts, provider, model }: MeetingInsightPanelProps) {
  const { insight, status, error, generate } = useMeetingInsight(meetingId, provider, model);

  // The passage of the transcript that mentions what the user asks about.
  const getTranscriptContext = useCallback(
    (query: string) => windowAroundTerm(transcripts.map((segment) => segment.text).join(' '), query),
    [transcripts]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <LiveInsightPanel
        variant="saved"
        insight={insight}
        status={status}
        error={error}
        hasEnoughTranscript={transcripts.length > 0}
        onRefresh={generate}
        getTranscriptContext={getTranscriptContext}
      />
    </div>
  );
}
