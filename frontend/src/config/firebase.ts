import { initializeApp, getApps, type FirebaseOptions } from 'firebase/app';
import { getAuth, initializeAuth, indexedDBLocalPersistence, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

// Explicit IndexedDB persistence: the WebView2/WKWebView the Tauri window
// runs in keeps a persistent profile between launches, same mechanism that
// already backs tauri-plugin-store for onboarding status.
//
// initializeAuth() throws if called more than once for the same app (Next.js
// Fast Refresh re-executes this module in dev) — fall back to the already
// -initialized instance instead of crashing the whole render tree.
let authInstance: Auth;
try {
  authInstance = initializeAuth(firebaseApp, {
    persistence: indexedDBLocalPersistence,
  });
} catch {
  authInstance = getAuth(firebaseApp);
}
export const auth: Auth = authInstance;

// Central registry of pre-authorized users (see src/lib/userProfile.ts).
export const firestore: Firestore = getFirestore(firebaseApp);
