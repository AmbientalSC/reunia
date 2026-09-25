import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/config/firebase';

// Central registry of who is allowed to use the app and their per-user
// provider keys. Cadastrado manually by an admin in the Firebase Console
// (Firestore > user_profiles collection, doc id = Firebase UID).
const PROFILES_COLLECTION = 'user_profiles';

export type UserRole = 'admin' | 'user';

export interface UserProfile {
  uid: string;
  email: string;
  authorized: boolean;
  role: UserRole;
  groqApiKey?: string;
}

/**
 * Looks up the pre-registered profile for a logged-in Firebase user.
 * Returns null when no profile exists — the caller must treat that as
 * "not authorized to use the app", not as an empty/default profile.
 */
export async function fetchUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(firestore, PROFILES_COLLECTION, uid));
  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();
  return {
    uid,
    email: typeof data.email === 'string' ? data.email : '',
    authorized: data.authorized === true,
    role: data.role === 'admin' ? 'admin' : 'user',
    groqApiKey: typeof data.groqApiKey === 'string' ? data.groqApiKey : undefined,
  };
}
