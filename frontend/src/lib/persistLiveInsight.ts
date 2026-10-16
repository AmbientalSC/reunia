import type { LiveInsightData } from '@/types';
import { INSIGHT_MIN_NEW_SEGMENTS, INSIGHT_MIN_SEGMENTS } from './insight-schedule';
import { liveInsightStore } from './liveInsightStore';

interface PersistLiveInsightParams {
  meetingId: string;
  /** The recording session whose insight is being saved. */
  session: number;
  /** Segments of the finished transcript (after the end-of-recording flush). */
  totalSegments: number;
  save: (meetingId: string, insight: LiveInsightData) => Promise<void>;
  /** Generates an insight from the complete transcript. */
  regenerate: () => Promise<LiveInsightData>;
}

/**
 * Saves the insight of a just-finished recording with its meeting.
 *
 * The periodic insight may predate the end of the recording (late segments and
 * the closing remarks arrive after "stop"), so when it does not cover the final
 * transcript a last one is generated from the complete text; if that fails the
 * periodic one is saved. Best effort: a failure is logged and never affects the
 * meeting itself.
 */
export async function persistLiveInsight(params: PersistLiveInsightParams): Promise<boolean> {
  const { meetingId, session, totalSegments, save, regenerate } = params;

  try {
    await liveInsightStore.settled();
    const stored = liveInsightStore.take(session);

    let insight = stored?.insight ?? null;
    const isStale =
      totalSegments >= INSIGHT_MIN_SEGMENTS &&
      (!stored || totalSegments - stored.analyzedSegments >= INSIGHT_MIN_NEW_SEGMENTS);

    if (isStale) {
      try {
        insight = await regenerate();
      } catch (error) {
        console.warn('Could not generate the final insight; keeping the previous one:', error);
      }
    }

    if (!insight) return false;

    await save(meetingId, insight);
    return true;
  } catch (error) {
    console.warn('Could not save the live insight with the meeting:', error);
    return false;
  }
}
