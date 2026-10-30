'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  onIdTokenChanged,
  signInWithCustomToken,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from '@/config/firebase';
import { fetchUserProfile } from '@/lib/userProfile';
import { autoConfigureEnterpriseProviders } from '@/lib/enterpriseSetup';
import { claimAccessReport, releaseAccessReport, reportUsage } from '@/lib/usageTracking';

const ALLOWED_EMAIL_DOMAIN = '@ambiental.sc';
// Anyone with an @ambiental.sc e-mail gets a profile on first login (see
// functions/src/index.ts), so this only reaches users an admin blocked or removed.
const ACCESS_DENIED_MESSAGE = 'Seu acesso não está liberado. Contate o administrador.';

interface MicrosoftAuthResult {
  custom_token: string;
  uid: string;
}

interface AuthContextType {
  user: User | null;
  /** Lowercased e-mail from the ID token claims. `user.email` is null for custom-token
   * sessions, so anything that needs "who am I" (e.g. the admin list) must use this. */
  userEmail: string | null;
  isLoading: boolean;
  isSigningIn: boolean;
  isAuthenticated: boolean;
  authError: string | null;
  /** True when the logged-in user's Firestore profile has an admin-managed
   * Groq key. Settings screens use this to hide the local Groq key field —
   * the profile key always takes priority and is never shown in the UI. */
  hasManagedGroqKey: boolean;
  /** From the Firestore profile's `role` field. For a future admin panel to
   * gate profile management (creating/editing user_profiles docs) — the
   * Firestore security rules are the real enforcement, this is just for UI. */
  isAdmin: boolean;
  loginWithMicrosoft: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [hasManagedGroqKey, setHasManagedGroqKey] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Mirrors the Firebase session into the Rust AppState on every token event
  // (initial restore on boot, hourly refresh, logout) so native commands can
  // check `require_auth()` without crossing back into the webview.
  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        releaseAccessReport();
        setUser(null);
        setUserEmail(null);
        setHasManagedGroqKey(false);
        setIsAdmin(false);
        try {
          await invoke('clear_auth_session');
        } catch (error) {
          console.error('[AuthContext] Failed to clear native auth session:', error);
        }
        setIsLoading(false);
        return;
      }

      try {
        // Custom-token sign-in (see functions/src/index.ts) doesn't register
        // an official Firebase user email — the domain we validated lives in
        // the ID token's custom claims, not `firebaseUser.email`. Normalized
        // once here: also doubles as the Firestore user_profiles doc id.
        const tokenResult = await firebaseUser.getIdTokenResult();
        const email = (
          (tokenResult.claims.email as string | undefined) ??
          firebaseUser.email ??
          ''
        ).toLowerCase();

        if (!email || !email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
          console.error('[AuthContext] Rejecting login outside', ALLOWED_EMAIL_DOMAIN);
          setAuthError('Use uma conta corporativa @ambiental.sc para entrar.');
          await firebaseSignOut(auth);
          return;
        }

        // The profile (access flag, role and per-user Groq key) is created by
        // exchangeMicrosoftToken on first login and keyed by email (see
        // userProfile.ts). A missing or unauthorized one means an admin
        // blocked or removed this user — the gate stays as the safety net.
        const profile = await fetchUserProfile(email);
        if (!profile || !profile.authorized) {
          console.error('[AuthContext] No authorized profile for uid', firebaseUser.uid);
          setAuthError(ACCESS_DENIED_MESSAGE);
          await firebaseSignOut(auth);
          // onIdTokenChanged fires again with null and clears the native
          // session; nothing else to do here.
          return;
        }

        const expiresAt = Math.floor(new Date(tokenResult.expirationTime).getTime() / 1000);
        await invoke('set_auth_session', {
          uid: firebaseUser.uid,
          email,
          idToken: tokenResult.token,
          expiresAt,
          groqApiKey: profile.groqApiKey ?? null,
        });

        if (profile.groqApiKey?.trim()) {
          try {
            await autoConfigureEnterpriseProviders();
          } catch (setupError) {
            console.error('[AuthContext] Enterprise provider auto-setup failed:', setupError);
            // Non-fatal: user still gets in, just lands on the onboarding
            // flow instead of a pre-configured app.
          } finally {
            // RootLayout reads onboarding status once on mount, racing this
            // login flow — on a fresh install that read finishes before
            // auto-setup marks onboarding complete, leaving it stuck on a
            // stale "not complete" state (blank screen, see layout.tsx).
            // Tell it to re-check now that the backend status is final.
            window.dispatchEvent(new CustomEvent('reunia:onboarding-status-changed'));
          }
        }

        setUser(firebaseUser);
        setUserEmail(email);
        setHasManagedGroqKey(!!profile.groqApiKey?.trim());
        setIsAdmin(profile.role === 'admin');
        setAuthError(null);

        // Counts app opens: token refreshes and webview reloads reuse the same claim.
        if (claimAccessReport(firebaseUser.uid)) {
          void reportUsage('access');
        }
      } catch (error) {
        console.error('[AuthContext] Failed to mirror auth session natively:', error);
        setAuthError('Falha ao iniciar a sessão. Tente novamente.');
        setUser(null);
        setUserEmail(null);
        setHasManagedGroqKey(false);
        setIsAdmin(false);
      } finally {
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const loginWithMicrosoft = useCallback(async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      const result = await invoke<MicrosoftAuthResult>('login_with_microsoft');
      // onIdTokenChanged (above) finishes the flow: mirrors the session
      // natively and sets `user` once Firebase accepts the custom token.
      await signInWithCustomToken(auth, result.custom_token);
    } catch (error) {
      console.error('[AuthContext] Microsoft login failed:', error);
      setAuthError('Não foi possível concluir o login com a Microsoft.');
      throw error;
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
    } finally {
      try {
        await invoke('clear_auth_session');
      } catch (error) {
        console.error('[AuthContext] Failed to clear native auth session on logout:', error);
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        userEmail,
        isLoading,
        isSigningIn,
        isAuthenticated: !!user,
        authError,
        hasManagedGroqKey,
        isAdmin,
        loginWithMicrosoft,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
