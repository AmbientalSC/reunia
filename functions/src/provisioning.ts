import { FieldValue } from 'firebase-admin/firestore';
import { EMAIL_PATTERN, GROQ_KEY_PATTERN, users } from './adminUsers';

const FIRESTORE_ALREADY_EXISTS = 6; // gRPC status code returned by create() on an existing doc

export type CreateProfile = (email: string, data: Record<string, unknown>) => Promise<void>;

/** Firestore access used by ensureUserProfile, injectable so the access rules can be tested. */
export interface ProfileStore {
  create: CreateProfile;
  isAuthorized: (email: string) => Promise<boolean>;
}

const firestoreStore: ProfileStore = {
  create: async (email, data) => {
    await users().doc(email).create(data);
  },
  isAuthorized: async (email) => (await users().doc(email).get()).data()?.authorized === true,
};

/**
 * Returns the shared default Groq key when the secret holds a well-formed one.
 * A missing or malformed secret yields `undefined`, so a misconfigured deploy
 * never copies garbage into every new profile.
 */
export function pickDefaultGroqKey(raw: string | undefined): string | undefined {
  const key = raw?.trim();
  return key && GROQ_KEY_PATTERN.test(key) ? key : undefined;
}

/** Profile written the first time someone with an allowed e-mail signs in. Never admin. */
export function buildAutoProfile(groqKey: string | undefined): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    authorized: true,
    role: 'user',
    createdAt: FieldValue.serverTimestamp(),
    provisionedBy: 'auto',
  };
  return groqKey ? { ...profile, groqApiKey: groqKey } : profile;
}

const isAlreadyExists = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === FIRESTORE_ALREADY_EXISTS || code === 'already-exists';
};

/** `created`: new profile. `existing`: found and authorized. `blocked`: found with authorized !== true. */
export type ProvisionResult = 'created' | 'existing' | 'blocked';

/**
 * Creates the profile for `email` unless one exists, and says whether the login may proceed.
 * create() (not set/merge) is what keeps an existing profile intact — a blocked user stays
 * blocked, an admin stays admin and an individual Groq key is never replaced by the default —
 * and makes concurrent first logins safe. A blocked user must not get a token: the profile
 * (and the Groq key in it) is readable by anyone holding a valid session.
 */
export async function ensureUserProfile(
  email: string,
  groqKey: string | undefined,
  store: ProfileStore = firestoreStore
): Promise<ProvisionResult> {
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('E-mail fora do padrão permitido para provisionamento.');
  }
  try {
    await store.create(email, buildAutoProfile(groqKey));
    return 'created';
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
  }
  // A profile deleted between create() and this read counts as blocked: fail closed, the next login recreates it.
  return (await store.isAuthorized(email)) ? 'existing' : 'blocked';
}
