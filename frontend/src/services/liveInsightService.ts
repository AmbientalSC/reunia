/**
 * Live Insight Service
 *
 * Thin wrapper around the `api_generate_live_insight` Tauri command: a single,
 * stateless LLM call over a recent window of the in-progress transcript.
 * Separate from the post-meeting summary/report pipeline (transcriptService /
 * useSummaryGeneration) and from the "Tela" visual summary (useVisualSummary).
 */
import { invoke } from '@tauri-apps/api/core';
import { LiveInsightData } from '@/types';

/** Insight kept with a saved meeting. */
export interface SavedLiveInsight {
  data: LiveInsightData;
  updated_at: string;
}

export class LiveInsightService {
  /** `completed`: the meeting already ended, so the whole transcript is analyzed instead of the latest speech. */
  async generateLiveInsight(
    text: string,
    provider: string,
    model: string,
    completed = false
  ): Promise<LiveInsightData> {
    return invoke<LiveInsightData>('api_generate_live_insight', {
      text,
      model: provider,
      modelName: model,
      completed,
    });
  }

  async getSaved(meetingId: string): Promise<SavedLiveInsight | null> {
    return invoke<SavedLiveInsight | null>('api_get_live_insight', { meetingId });
  }

  async save(meetingId: string, insight: LiveInsightData): Promise<void> {
    return invoke<void>('api_save_live_insight', { meetingId, insight });
  }
}

export const liveInsightService = new LiveInsightService();
