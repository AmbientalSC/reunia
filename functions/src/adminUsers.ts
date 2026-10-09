import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const REGION = 'us-central1';
const COLLECTION = 'user_profiles';
const ALLOWED_EMAIL_DOMAIN = '@ambiental.sc';
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@ambiental\.sc$/;
const FIRESTORE_NOT_FOUND = 5; // gRPC status code returned by update() on a missing doc
const GROQ_KEY_PATTERN = /^gsk_[\w-]{20,200}$/;

export type UserRole = 'admin' | 'user';

export interface ManagedUser {
  email: string;
  role: UserRole;
  authorized: boolean;
  /** Whether a Groq key is stored on the profile. The key itself is never returned. */
  hasGroqKey: boolean;
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'E-mail inválido.');
  }
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
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

/** Shape returned to the admin UI. groqApiKey is deliberately never included. */
export function toManagedUser(email: string, data: FirebaseFirestore.DocumentData | undefined): ManagedUser {
  return {
    email,
    role: data?.role === 'admin' ? 'admin' : 'user',
    authorized: data?.authorized === true,
    hasGroqKey: hasStoredGroqKey(data),
  };
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

const users = () => getFirestore().collection(COLLECTION);

/** Resolves the caller's e-mail and rejects anyone who is not an authorized admin. */
async function requireAdmin(request: CallableRequest): Promise<string> {
  const tokenEmail = request.auth?.token.email;
  if (typeof tokenEmail !== 'string') {
    throw new HttpsError('unauthenticated', 'Login necessário.');
  }
  const callerEmail = tokenEmail.toLowerCase();
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

  if (email === callerEmail && role !== 'admin') {
    throw new HttpsError('failed-precondition', 'Você não pode remover seu próprio acesso de admin.');
  }

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
