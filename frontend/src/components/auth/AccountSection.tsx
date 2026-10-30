'use client';

import React, { useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

export function AccountSection() {
  const { userEmail, logout } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await logout();
      // AuthGate swaps in the login screen once the session is gone; nothing else to reset.
    } catch (error) {
      console.error('[AccountSection] Logout failed:', error);
      toast.error('Não foi possível sair. Tente novamente.');
      setIsSigningOut(false);
    }
  };

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Conta</h2>
          <p className="truncate text-sm text-gray-600">
            {userEmail ? `Conectado como ${userEmail}` : 'Conectado'}
          </p>
        </div>
        <Button variant="outline" onClick={() => void handleLogout()} disabled={isSigningOut}>
          {isSigningOut ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <LogOut className="w-4 h-4 mr-2" />
          )}
          Sair
        </Button>
      </div>
    </section>
  );
}
