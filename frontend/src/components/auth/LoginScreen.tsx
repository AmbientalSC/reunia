'use client';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function LoginScreen() {
  const { loginWithMicrosoft, isSigningIn, authError } = useAuth();

  const handleLogin = () => {
    loginWithMicrosoft().catch(() => {
      // Error is already surfaced via authError; nothing else to do here.
    });
  };

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-white px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="ReunIA" width={72} height={72} />

      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold text-gray-900">Bem-vindo ao ReunIA</h1>
        <p className="text-sm text-gray-500">
          Entre com sua conta corporativa Ambiental para continuar.
        </p>
      </div>

      <Button
        variant="blue"
        size="lg"
        onClick={handleLogin}
        disabled={isSigningIn}
        className="w-72"
      >
        <MicrosoftLogo />
        {isSigningIn ? 'Aguardando login no navegador…' : 'Entrar com Microsoft'}
      </Button>

      {authError && (
        <p className="max-w-xs text-center text-sm text-red-500" role="alert">
          {authError}
        </p>
      )}
    </div>
  );
}
