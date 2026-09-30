import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getFirestore } from 'firebase-admin/firestore';

const REGION = 'us-central1';
const COLLECTION = 'user_profiles';
const ALLOWED_EMAIL_DOMAIN = '@ambiental.sc';
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@ambiental\.sc$/;

export type UserRole = 'admin' | 'user';

export interface ManagedUser {
  email: string;
  role: UserRole;
  authorized: boolean;
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
  // groqApiKey is deliberately never returned.
  return snap.docs
    .map((doc) => ({
      email: doc.id,
      role: (doc.data().role === 'admin' ? 'admin' : 'user') as UserRole,
      authorized: doc.data().authorized === true,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
});

export const upsertUser = onCall({ region: REGION }, async (request): Promise<ManagedUser> => {
  const callerEmail = await requireAdmin(request);
  const email = normalizeEmail(request.data?.email);
  const role = parseRole(request.data?.role);

  if (email === callerEmail && role !== 'admin') {
    throw new HttpsError('failed-precondition', 'Você não pode remover seu próprio acesso de admin.');
  }

  // merge keeps groqApiKey (and any other field) already stored on the profile.
  await users().doc(email).set({ authorized: true, role }, { merge: true });
  logger.info('User upserted', { callerEmail, email, role });
  return { email, role, authorized: true };
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
