import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Detects if an error message indicates that Ollama is not installed or not running
 * @param errorMessage - The error message to check
 * @returns true if the error indicates Ollama is not installed/running
 */
export function isOllamaNotInstalledError(errorMessage: string): boolean {
  if (!errorMessage) return false;

  const lowerError = errorMessage.toLowerCase();

  // Check for common patterns that indicate Ollama is not installed or not running
  const patterns = [
    'cannot connect',
    'connection refused',
    'cli not found',
    'not in path',
    'ollama cli not found',
    'not found or not in path',
    'please check if the server is running',
    'please check if the ollama server is running',
    'econnrefused',
    // Portuguese (pt-BR) equivalents
    'não foi possível conectar',
    'não é possível conectar',
    'conexão recusada',
    'cli não encontrado',
    'não está no path',
    'não no path',
    'não encontrado no path',
    'verifique se o servidor está em execução',
    'verifique se o servidor ollama está em execução',
  ];

  return patterns.some(pattern => lowerError.includes(pattern));
}
