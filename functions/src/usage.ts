import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { FIRESTORE_NOT_FOUND, REGION, requireCallerEmail, users } from './adminUsers';

export type UsageEvent = 'access' | 'meeting' | 'summary';

/** Longest audio a single event may add. Caps what a misbehaving or tampered client can inflate. */
export const MAX_AUDIO_SECONDS_PER_EVENT = 24 * 60 * 60;

const USAGE_EVENTS: readonly UsageEvent[] = ['access', 'meeting', 'summary'];

export interface UsageRequest {
  event: UsageEvent;
  audioSeconds: number;
}

const isUsageEvent = (value: unknown): value is UsageEvent => USAGE_EVENTS.includes(value as UsageEvent);

/** Validates the client payload. Only `meeting` carries audio; anything above the ceiling is clamped. */
export function parseUsageRequest(data: unknown): UsageRequest {
  const payload = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  if (!isUsageEvent(payload.event)) {
    throw new HttpsError('invalid-argument', 'Evento de uso inválido.');
  }
  if (payload.event !== 'meeting' || payload.audioSeconds === undefined) {
    return { event: payload.event, audioSeconds: 0 };
  }
  const seconds = payload.audioSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    throw new HttpsError('invalid-argument', 'Duração de áudio inválida.');
  }
  return { event: 'meeting', audioSeconds: Math.min(Math.round(seconds), MAX_AUDIO_SECONDS_PER_EVENT) };
}

/** Dotted field paths so update() bumps counters without rewriting the whole `usage` map. */
export function buildUsageUpdate({ event, audioSeconds }: UsageRequest): Record<string, unknown> {
  switch (event) {
    case 'access':
      return { lastAccessAt: FieldValue.serverTimestamp(), accessCount: FieldValue.increment(1) };
    case 'meeting':
      return {
        'usage.meetingsCount': FieldValue.increment(1),
        'usage.audioSeconds': FieldValue.increment(audioSeconds),
      };
    case 'summary':
      return { 'usage.summariesCount': FieldValue.increment(1) };
  }
}

/**
 * Adoption counters reported by the desktop app (it is the only place that knows about
 * meetings and summaries — they live in each user's local SQLite). Client-reported, so it
 * measures usage for visibility, not for billing. Uses update(): a profile that was removed
 * is never recreated by a stray report.
 */
export const recordUsage = onCall({ region: REGION, maxInstances: 5 }, async (request): Promise<{ ok: true }> => {
  const email = requireCallerEmail(request);
  const usageRequest = parseUsageRequest(request.data);

  const ref = users().doc(email);
  const profile = await ref.get();
  if (!profile.exists || profile.data()?.authorized !== true) {
    throw new HttpsError('permission-denied', 'Usuário sem acesso autorizado.');
  }

  try {
    await ref.update(buildUsageUpdate(usageRequest));
  } catch (error) {
    if ((error as { code?: number }).code === FIRESTORE_NOT_FOUND) {
      throw new HttpsError('permission-denied', 'Usuário sem acesso autorizado.');
    }
    logger.error('Failed to record usage', { email, event: usageRequest.event, error: String(error) });
    throw error;
  }
  return { ok: true };
});
