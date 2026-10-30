import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { Transcript } from '@/types';

/**
 * Adoption counters shown in the admin screen. Meetings and summaries live in each user's
 * local SQLite, so the app reports them to the `recordUsage` Cloud Function
 * (functions/src/usage.ts) as they happen.
 */
export type UsageEvent = 'access' | 'meeting' | 'summary';

interface UsagePayload {
  event: UsageEvent;
  audioSeconds?: number;
}

export type UsageReporter = (event: UsageEvent, audioSeconds?: number) => Promise<void>;

const finiteOrZero = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Length of a recording: the latest `audio_end_time` (recording-relative), or the sum of the
 * segment durations when end times were not captured.
 */
export function computeAudioSeconds(
  transcripts: ReadonlyArray<Pick<Transcript, 'audio_end_time' | 'duration'>>
): number {
  let latestEnd = 0;
  let totalDuration = 0;
  for (const segment of transcripts) {
    latestEnd = Math.max(latestEnd, finiteOrZero(segment.audio_end_time));
    totalDuration += finiteOrZero(segment.duration);
  }
  return Math.round(latestEnd > 0 ? latestEnd : totalDuration);
}

/**
 * Builds a reporter around `send`. The reporter never rejects or throws: usage tracking is
 * best-effort and must not interrupt recording, importing or summarizing. A non-finite audio
 * length (the backend serializes NaN as null) is dropped so the server still counts the meeting.
 */
export function createUsageReporter(send: (payload: UsagePayload) => Promise<unknown>): UsageReporter {
  return async (event, audioSeconds) => {
    const safeAudioSeconds =
      typeof audioSeconds === 'number' && Number.isFinite(audioSeconds) ? audioSeconds : undefined;
    try {
      await send({ event, audioSeconds: safeAudioSeconds });
    } catch (error) {
      console.warn('[usageTracking] Could not report usage:', event, error);
    }
  };
}

export const reportUsage = createUsageReporter((payload) =>
  httpsCallable<UsagePayload, { ok: true }>(functions, 'recordUsage')(payload)
);

// --- One "access" per app run ---------------------------------------------------------------
// AuthContext re-evaluates on every hourly token refresh and the onboarding flow calls
// window.location.reload(), which resets in-memory state. sessionStorage survives a reload and
// dies when the window closes, so it counts app opens rather than page loads.

const ACCESS_REPORTED_KEY = 'reunia:access-reported-uid';

type AccessStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Only used when sessionStorage is unavailable (blocked or throwing).
let memoryReportedUid: string | null = null;

function defaultAccessStorage(): AccessStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function readReportedUid(storage: AccessStorage | undefined): string | null {
  try {
    if (storage) return storage.getItem(ACCESS_REPORTED_KEY);
  } catch {
    // Fall through to the in-memory copy.
  }
  return memoryReportedUid;
}

function writeReportedUid(uid: string | null, storage: AccessStorage | undefined): void {
  try {
    if (storage) {
      if (uid === null) storage.removeItem(ACCESS_REPORTED_KEY);
      else storage.setItem(ACCESS_REPORTED_KEY, uid);
      return;
    }
  } catch {
    // Fall through to the in-memory copy.
  }
  memoryReportedUid = uid;
}

/** True the first time `uid` is seen in this app run; false for refreshes and reloads. */
export function claimAccessReport(uid: string, storage: AccessStorage | undefined = defaultAccessStorage()): boolean {
  if (readReportedUid(storage) === uid) return false;
  writeReportedUid(uid, storage);
  return true;
}

/** Call on logout so the next login counts as a new access. */
export function releaseAccessReport(storage: AccessStorage | undefined = defaultAccessStorage()): void {
  writeReportedUid(null, storage);
}
