/** Segments needed before the first insight is generated (it then runs immediately). */
export const INSIGHT_MIN_SEGMENTS = 6;
/** New segments needed before the insight is refreshed. */
export const INSIGHT_MIN_NEW_SEGMENTS = 4;
/** Minimum gap between two insight runs. */
export const INSIGHT_MIN_INTERVAL_MS = 10_000;
/** A slow model must rest at least this many times the duration of its last run. */
const SLOW_MODEL_REST_FACTOR = 2;

export interface InsightScheduleState {
  segmentCount: number;
  /** Segment count covered by the last successful insight (0 when none yet). */
  analyzedCount: number;
  isGenerating: boolean;
  /** When the last run finished (ms timestamp), or null if none ran yet. */
  lastRunEndedAt: number | null;
  /** How long the last run took, or null if none ran yet. */
  lastDurationMs: number | null;
  now: number;
}

/** Counted as the duration of a failed run, so failures back off instead of retrying at full speed. */
export const INSIGHT_FAILURE_DURATION_MS = 15_000;

/**
 * Decides whether the live insight should be (re)generated now.
 *
 * The first insight runs as soon as there is enough transcript. Later ones wait
 * for new speech. Every run, including a failed one, is followed by a rest that
 * grows with the model's own latency, so a slow local model never competes with
 * the transcription for the machine.
 */
export function shouldRunInsight(state: InsightScheduleState): boolean {
  if (state.isGenerating) return false;
  if (state.segmentCount < INSIGHT_MIN_SEGMENTS) return false;

  const restMs = Math.max(
    INSIGHT_MIN_INTERVAL_MS,
    (state.lastDurationMs ?? 0) * SLOW_MODEL_REST_FACTOR
  );
  const hasRested = state.lastRunEndedAt === null || state.now - state.lastRunEndedAt >= restMs;

  if (state.analyzedCount === 0) return hasRested;

  return state.segmentCount - state.analyzedCount >= INSIGHT_MIN_NEW_SEGMENTS && hasRested;
}
