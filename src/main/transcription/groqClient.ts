import Groq from 'groq-sdk';
import { getConfigStore } from '../store/configStore';

let groqClient: Groq | null = null;
let cachedApiKey: string = '';

/**
 * Returns a Groq SDK client configured with the user's API key.
 * 
 * Sempre lê a chave mais recente do config store. Se a chave mudou
 * desde a última chamada, recria o cliente automaticamente.
 */
export function getGroqClient(): Groq {
  const store = getConfigStore();
  const apiKey = store.get('groqApiKey');

  if (!apiKey) {
    throw new Error(
      'Groq API key not configured. Please set your API key in Settings.'
    );
  }

  // Se a chave mudou ou o cliente ainda não existe, recria
  if (!groqClient || apiKey !== cachedApiKey) {
    cachedApiKey = apiKey;
    groqClient = new Groq({
      apiKey,
      dangerouslyAllowBrowser: false, // Only server-side usage
    });
  }

  return groqClient;
}

/**
 * Force-reset the client (e.g., when API key changes).
 * Útil quando o usuário quer testar uma nova key imediatamente.
 */
export function resetGroqClient(): void {
  groqClient = null;
  cachedApiKey = '';
}

/**
 * Retry helper with exponential backoff for API calls.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      // Don't retry on auth errors
      if (err.status === 401 || err.status === 403) {
        throw new Error('Invalid API key. Please check your Groq API key in Settings.');
      }

      // Don't retry on invalid request
      if (err.status === 400) {
        throw err;
      }

      // Rate limit — wait longer
      if (err.status === 429) {
        const retryAfter = parseInt(err.headers?.['retry-after'] || '5', 10);
        const waitMs = retryAfter * 1000;
        console.warn(`[Groq] Rate limited. Waiting ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }

      // Server errors — retry with backoff
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[Groq] Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
