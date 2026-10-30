import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export const REGION = 'us-central1';
const COLLECTION = 'user_profiles';
const ALLOWED_EMAIL_DOMAIN = '@ambiental.sc';
export const EMAIL_PATTERN = /^[a-z0-9._%+-]+@ambiental\.sc$/;
export const FIRESTORE_NOT_FOUND = 5; // gRPC status code returned by update() on a missing doc
export const GROQ_KEY_PATTERN = /^gsk_[\w-]{20,200}$/;

export type UserRole = 'admin' | 'user';

export interface ManagedUser {
  email: string;
  role: UserRole;
  authorized: boolean;
  /** Whether a Groq key is stored on the profile. The key itself is never returned. */
  hasGroqKey: boolean;
  /** ISO timestamp of the last app open reported by the client; null until one is reported. */
  lastAccessAt: string | null;
  /** App opens, reported by the client (see usage.ts). Adoption metric, not billing. */
  accessCount: number;
  meetingsCount: number;
  audioSeconds: number;
  summariesCount: number;
}

// ASCII-only on purpose: validating before lowercasing keeps look-alikes such as the Kelvin sign
// (U+212A, which lowercases to "k") from turning into someone else's real address. The 64 limit
// is the local-part maximum and bounds the Firestore document id.
const RAW_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z.]{1,255}$/;

/** Lowercased e-mail when `value` is an allowed @ambiental.sc address, otherwise null. */
export function normalizeAllowedEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!RAW_EMAIL_PATTERN.test(trimmed)) {
    return null;
  }
  const email = trimmed.toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'E-mail inválido.');
  }
  const email = normalizeAllowedEmail(value);
  if (email === null) {
    throw new HttpsError('invalid-argument', `Use um e-mail ${ALLOWED_EMAIL_DOMAIN}.`);
  }
  return email;
}

export function parseRole(value: unknown): UserRole {
  if (value !== 'admin' && value !== 'user') {
    throw new HttpsError('invalid-argument', 'Role inválida.');
  }
  return value;
}

/**
 * Interprets the optional `groqApiKey` of an upsert request:
 * `undefined` (absent or blank) keeps the stored key, `null` removes it,
 * a well-formed string replaces it.
 */
export function parseGroqApiKey(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'Chave do Groq inválida.');
  }
  const key = value.trim();
  if (key === '') {
    return undefined;
  }
  if (!GROQ_KEY_PATTERN.test(key)) {
    throw new HttpsError('invalid-argument', 'Chave do Groq inválida. Ela deve começar com "gsk_".');
  }
  return key;
}

const hasStoredGroqKey = (data: FirebaseFirestore.DocumentData | undefined): boolean =>
  typeof data?.groqApiKey === 'string' && data.groqApiKey.trim() !== '';

/** Callable responses can't carry a Firestore Timestamp, so it travels as an ISO string. */
function toIsoString(value: unknown): string | null {
  if (typeof (value as { toDate?: unknown } | null)?.toDate !== 'function') {
    return null;
  }
  return (value as { toDate: () => Date }).toDate().toISOString();
}

/** Counters come from client-reported increments: anything not a finite, non-negative number reads as 0. */
function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Shape returned to the admin UI. groqApiKey is deliberately never included. */
export function toManagedUser(email: string, data: FirebaseFirestore.DocumentData | undefined): ManagedUser {
  return {
    email,
    role: data?.role === 'admin' ? 'admin' : 'user',
    authorized: data?.authorized === true,
    hasGroqKey: hasStoredGroqKey(data),
    lastAccessAt: toIsoString(data?.lastAccessAt),
    accessCount: toCount(data?.accessCount),
    meetingsCount: toCount(data?.usage?.meetingsCount),
    audioSeconds: toCount(data?.usage?.audioSeconds),
    summariesCount: toCount(data?.usage?.summariesCount),
  };
}

export interface RoleChange {
  callerEmail: string;
  targetEmail: string;
  role: UserRole;
}

export function assertCanChangeRole({ callerEmail, targetEmail, role }: RoleChange): void {
  if (targetEmail === callerEmail && role !== 'admin') {
    throw new HttpsError('failed-precondition', 'Você não pode remover seu próprio acesso de admin.');
  }
}

export interface AuthorizationChange {
  callerEmail: string;
  targetEmail: string;
  targetRole: UserRole;
  authorized: boolean;
  /** Authorized admins right now, including the target when it is one. */
  adminCount: number;
}

/** Blocking is the only revocation that survives auto-provisioning, so it must not lock admins out. */
export function assertCanChangeAuthorization(change: AuthorizationChange): void {
  if (change.authorized) {
    return;
  }
  if (change.targetEmail === change.callerEmail) {
    throw new HttpsError('failed-precondition', 'Você não pode bloquear a si mesmo.');
  }
  if (change.targetRole === 'admin' && change.adminCount <= 1) {
    throw new HttpsError('failed-precondition', 'Não é possível bloquear o último admin.');
  }
}

/** Fields written by upsertUser; a groqApiKey that is not part of the request stays untouched (merge). */
export function buildProfileUpdate(role: UserRole, groqApiKey: string | null | undefined): Record<string, unknown> {
  const profile: Record<string, unknown> = { authorized: true, role };
  if (groqApiKey === null) {
    profile.groqApiKey = FieldValue.delete();
  } else if (groqApiKey !== undefined) {
    profile.groqApiKey = groqApiKey;
  }
  return profile;
}

export const users = () => getFirestore().collection(COLLECTION);

const MICROSOFT_UID_PREFIX = 'msft:';

/**
 * The caller's e-mail from the custom-token claim set by exchangeMicrosoftToken. Firebase fills
 * `token.email` by itself for other sign-in providers (e.g. a self-registered password account),
 * so the session must also be a custom token whose uid came from the Microsoft exchange.
 */
export function requireCallerEmail(request: CallableRequest): string {
  const auth = request.auth;
  const isMicrosoftSession =
    auth?.token.firebase?.sign_in_provider === 'custom' && auth.uid.startsWith(MICROSOFT_UID_PREFIX);
  if (!auth || !isMicrosoftSession || typeof auth.token.email !== 'string') {
    throw new HttpsError('unauthenticated', 'Login necessário.');
  }
  return auth.token.email.toLowerCase();
}

/** Resolves the caller's e-mail and rejects anyone who is not an authorized admin. */
async function requireAdmin(request: CallableRequest): Promise<string> {
  const callerEmail = requireCallerEmail(request);
  const snap = await users().doc(callerEmail).get();
  const data = snap.data();
  if (!snap.exists || data?.authorized !== true || data?.role !== 'admin') {
    logger.warn('Admin access denied', { callerEmail });
    throw new HttpsError('permission-denied', 'Acesso restrito a administradores.');
  }
  return callerEmail;
}

async function countAdmins(): Promise<number> {
  const snap = await users().where('authorized', '==', true).where('role', '==', 'admin').count().get();
  return snap.data().count;
}

export const listUsers = onCall({ region: REGION }, async (request): Promise<ManagedUser[]> => {
  await requireAdmin(request);
  const snap = await users().get();
  return snap.docs.map((doc) => toManagedUser(doc.id, doc.data())).sort((a, b) => a.email.localeCompare(b.email));
});

export const upsertUser = onCall({ region: REGION }, async (request): Promise<ManagedUser> => {
  const callerEmail = await requireAdmin(request);
  const email = normalizeEmail(request.data?.email);
  const role = parseRole(request.data?.role);
  const groqApiKey = parseGroqApiKey(request.data?.groqApiKey);

  assertCanChangeRole({ callerEmail, targetEmail: email, role });

  const ref = users().doc(email);
  await ref.set(buildProfileUpdate(role, groqApiKey), { merge: true });
  const groqKeyChange = groqApiKey === undefined ? 'unchanged' : groqApiKey === null ? 'removed' : 'set';
  // The key value is never logged.
  logger.info('User upserted', { callerEmail, email, role, groqKeyChange });
  return toManagedUser(email, (await ref.get()).data());
});

/**
 * Changes only the stored Groq key. Kept apart from upsertUser on purpose:
 * upsertUser rewrites `authorized`/`role` and would re-authorize a blocked user or
 * recreate one deleted in the meantime. update() fails with NOT_FOUND instead.
 */
export const setUserGroqKey = onCall({ region: REGION }, async (request): Promise<{ email: string; hasGroqKey: boolean }> => {
  const callerEmail = await requireAdmin(request);
  const email = normalizeEmail(request.data?.email);
  const groqApiKey = parseGroqApiKey(request.data?.groqApiKey);
  if (groqApiKey === undefined) {
    throw new HttpsError('invalid-argument', 'Informe a chave do Groq ou null para removê-la.');
  }

  try {
    await users().doc(email).update({ groqApiKey: groqApiKey === null ? FieldValue.delete() : groqApiKey });
  } catch (error) {
    if ((error as { code?: number }).code === FIRESTORE_NOT_FOUND) {
      throw new HttpsError('not-found', 'Usuário não encontrado.');
    }
    throw error;
  }
  // The key value is never logged.
  logger.info('Groq key changed', { callerEmail, email, groqKeyChange: groqApiKey === null ? 'removed' : 'set' });
  return { email, hasGroqKey: groqApiKey !== null };
});

/**
 * Changes only the role. Kept apart from upsertUser (which writes `authorized: true`) so that a
 * role change made from a stale list can never silently unblock a user an admin just blocked.
 */
export const setUserRole = onCall({ region: REGION }, async (request): Promise<ManagedUser> => {
  const callerEmail = await requireAdmin(request);
  const email = normalizeEmail(request.data?.email);
  const role = parseRole(request.data?.role);
  assertCanChangeRole({ callerEmail, targetEmail: email, role });

  const ref = users().doc(email);
  try {
    await ref.update({ role });
  } catch (error) {
    if ((error as { code?: number }).code === FIRESTORE_NOT_FOUND) {
      throw new HttpsError('not-found', 'Usuário não encontrado.');
    }
    throw error;
  }
  logger.info('User role changed', { callerEmail, email, role });
  return toManagedUser(email, (await ref.get()).data());
});

/**
 * Blocks or unblocks a user. Deleting a profile no longer revokes access (the next login
 * re-provisions it), so `authorized: false` is the way to keep someone out. update() fails
 * with NOT_FOUND instead of recreating a profile removed in the meantime.
 */
export const setUserAuthorized = onCall({ region: REGION }, async (request): Promise<ManagedUser> => {
  const callerEmail = await requireAdmin(request);
  const email = normalizeEmail(request.data?.email);
  if (typeof request.data?.authorized !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Informe se o usuário está autorizado (true/false).');
  }
  const authorized: boolean = request.data.authorized;

  const ref = users().doc(email);
  const target = await ref.get();
  if (!target.exists) {
    throw new HttpsError('not-found', 'Usuário não encontrado.');
  }
  const targetRole: UserRole = target.data()?.role === 'admin' ? 'admin' : 'user';
  const adminCount = !authorized && targetRole === 'admin' ? await countAdmins() : 0;
  assertCanChangeAuthorization({ callerEmail, targetEmail: email, targetRole, authorized, adminCount });

  try {
    await ref.update({ authorized });
  } catch (error) {
    if ((error as { code?: number }).code === FIRESTORE_NOT_FOUND) {
      throw new HttpsError('not-found', 'Usuário não encontrado.');
    }
    throw error;
  }
  logger.info('User authorization changed', { callerEmail, email, authorized });
  return toManagedUser(email, (await ref.get()).data());
});

export const deleteUser = onCall({ region: REGION }, async (request): Promise<{ email: string }> => {
  const callerEmail = await requireAdmin(request);
  const email = normalizeEmail(request.data?.email);

  if (email === callerEmail) {
    throw new HttpsError('failed-precondition', 'Você não pode remover a si mesmo.');
  }
  const target = await users().doc(email).get();
  if (target.data()?.role === 'admin' && (await countAdmins()) <= 1) {
    throw new HttpsError('failed-precondition', 'Não é possível remover o último admin.');
  }

  await users().doc(email).delete();
  logger.info('User deleted', { callerEmail, email });
  return { email };
});
