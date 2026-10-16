import type { LiveInsightData } from '@/types';

/** The stored insight and how many transcript segments it was generated from. */
export interface StoredInsight {
  insight: LiveInsightData;
  analyzedSegments: number;
}

/**
 * Holds the latest live insight outside of React.
 *
 * The Insight tab lives in the recording screen, which is unmounted as soon as
 * the recording stops and the app navigates to the saved meeting. The meeting id
 * only exists after saving, so the insight has to survive until then.
 *
 * Each recording is a "session": starting a new one discards the previous
 * insight, a generation that finishes after its session ended is ignored, and a
 * late save that still refers to an old session gets nothing. So an insight is
 * never attached to the wrong meeting.
 */
let current: StoredInsight | null = null;
let session = 0;
let lastRun: Promise<void> = Promise.resolve();

export const liveInsightStore = {
  /** Starts a new recording session and discards whatever the previous one left. */
  startSession(): number {
    session += 1;
    current = null;
    lastRun = Promise.resolve();
    return session;
  },

  session(): number {
    return session;
  },

  /** Stores the insight of `forSession`; ignored when that session is no longer the current one. */
  set(insight: LiveInsightData, forSession: number, analyzedSegments: number): void {
    if (forSession !== session) return;
    current = { insight, analyzedSegments };
  },

  /** Remembers the generation in flight so a save can wait for it. Never rejects. */
  track(run: Promise<unknown>): void {
    lastRun = run.then(
      () => undefined,
      () => undefined
    );
  },

  /** Resolves when the last tracked generation has finished (or failed). */
  settled(): Promise<void> {
    return lastRun;
  },

  /**
   * Returns what `expectedSession` stored and empties the store; returns null
   * when there is nothing or when a newer session has started since.
   */
  take(expectedSession: number): StoredInsight | null {
    if (expectedSession !== session) return null;

    const stored = current;
    current = null;
    return stored;
  },
};
