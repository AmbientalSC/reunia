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

export class LiveInsightService {
  async generateLiveInsight(text: string, provider: string, model: string): Promise<LiveInsightData> {
    return invoke<LiveInsightData>('api_generate_live_insight', {
      text,
      model: provider,
      modelName: model,
    });
  }
}

export const liveInsightService = new LiveInsightService();
