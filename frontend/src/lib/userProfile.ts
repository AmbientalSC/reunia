import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/config/firebase';

// Central registry of each user's access flag, role and per-user provider
// keys. Created automatically on the first @ambiental.sc login (see
// functions/src/index.ts) and managed by admins through the Admin tab
// (Firestore > user_profiles collection, doc id = e-mail em minúsculas —
// não o Firebase UID).
const PROFILES_COLLECTION = 'user_profiles';

export type UserRole = 'admin' | 'user';

export interface UserProfile {
  authorized: boolean;
  role: UserRole;
  groqApiKey?: string;
}

/**
 * Looks up the profile for a logged-in Firebase user by email (the Firestore
 * doc id). Returns null when no readable profile exists (an admin removed or
 * blocked it after the login) — the caller must treat that as "not authorized
 * to use the app", not as an empty/default profile.
 */
export async function fetchUserProfile(email: string): Promise<UserProfile | null> {
  let snapshot;
  try {
    snapshot = await getDoc(doc(firestore, PROFILES_COLLECTION, email.toLowerCase()));
  } catch (error) {
    // The security rules only let an authorized user read their profile, so a blocked
    // or removed one gets permission-denied instead of a document.
    if ((error as { code?: string }).code === 'permission-denied') {
      return null;
    }
    throw error;
  }
  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();
  return {
    authorized: data.authorized === true,
    role: data.role === 'admin' ? 'admin' : 'user',
    groqApiKey: typeof data.groqApiKey === 'string' ? data.groqApiKey : undefined,
  };
}
