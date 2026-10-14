import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';

let cachedVersion: string | null = null;

/**
 * Versão atual do app (a de tauri.conf.json, a mesma do updater), sem número fixo no código.
 * Retorna `null` enquanto carrega ou fora do Tauri (ex.: `next dev` no navegador).
 */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(cachedVersion);

  useEffect(() => {
    if (cachedVersion) return;

    let isActive = true;
    getVersion()
      .then((appVersion) => {
        cachedVersion = appVersion;
        if (isActive) setVersion(appVersion);
      })
      .catch((error) => console.error('Failed to get app version:', error));

    return () => {
      isActive = false;
    };
  }, []);

  return version;
}
