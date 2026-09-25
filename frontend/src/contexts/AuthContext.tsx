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

const ALLOWED_EMAIL_DOMAIN = '@ambiental.sc';
const NOT_REGISTERED_MESSAGE =
  'Seu usuário ainda não foi cadastrado. Contate o administrador para liberar o acesso.';

interface MicrosoftAuthResult {
  custom_token: string;
  uid: string;
}

interface AuthContextType {
  user: User | null;
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
        setUser(null);
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
        // the ID token's custom claims, not `firebaseUser.email`.
        const tokenResult = await firebaseUser.getIdTokenResult();
        const email =
          (tokenResult.claims.email as string | undefined) ?? firebaseUser.email ?? undefined;

        if (!email?.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) {
          console.error('[AuthContext] Rejecting login outside', ALLOWED_EMAIL_DOMAIN);
          setAuthError('Use uma conta corporativa @ambiental.sc para entrar.');
          await firebaseSignOut(auth);
          return;
        }

        // Login with Microsoft only proves the user belongs to the Ambiental
        // tenant — it does NOT mean they're allowed to use the app. Access
        // (and the per-user Groq key) requires a profile pre-registered by
        // an admin in Firestore.
        const profile = await fetchUserProfile(firebaseUser.uid);
        if (!profile || !profile.authorized) {
          console.error('[AuthContext] No authorized profile for uid', firebaseUser.uid);
          setAuthError(NOT_REGISTERED_MESSAGE);
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
        setUser(firebaseUser);
        setHasManagedGroqKey(!!profile.groqApiKey?.trim());
        setIsAdmin(profile.role === 'admin');
        setAuthError(null);
      } catch (error) {
        console.error('[AuthContext] Failed to mirror auth session natively:', error);
        setAuthError('Falha ao iniciar a sessão. Tente novamente.');
        setUser(null);
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
