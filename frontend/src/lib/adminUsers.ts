import { httpsCallable } from 'firebase/functions';
import { z } from 'zod';
import { functions } from '@/config/firebase';
import type { UserRole } from '@/lib/userProfile';

export const ALLOWED_EMAIL_DOMAIN = '@ambiental.sc';

export interface ManagedUser {
  email: string;
  role: UserRole;
  authorized: boolean;
  /** The key itself is never sent to the admin UI, only whether one is stored. */
  hasGroqKey: boolean;
}

/** Same format check the Cloud Function applies (functions/src/adminUsers.ts). */
export const GROQ_KEY_PATTERN = /^gsk_[\w-]{20,200}$/;
export const GROQ_KEY_ERROR = 'Chave do Groq inválida (deve começar com gsk_).';

export const userFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._%+-]+@ambiental\.sc$/, `Use um e-mail ${ALLOWED_EMAIL_DOMAIN}`),
  role: z.enum(['admin', 'user']),
  groqApiKey: z
    .string()
    .trim()
    .refine((key) => key === '' || GROQ_KEY_PATTERN.test(key), GROQ_KEY_ERROR)
    .optional(),
});

/** `groqApiKey`: omitted keeps the stored key, `null` removes it, a string replaces it. */
export interface UpsertUserPayload {
  email: string;
  role: UserRole;
  groqApiKey?: string | null;
}

export type UserFormValues = z.infer<typeof userFormSchema>;

export async function listUsers(): Promise<ManagedUser[]> {
  const result = await httpsCallable<void, ManagedUser[]>(functions, 'listUsers')();
  return result.data;
}

export async function upsertUser(payload: UpsertUserPayload): Promise<ManagedUser> {
  const result = await httpsCallable<UpsertUserPayload, ManagedUser>(functions, 'upsertUser')(payload);
  return result.data;
}

/** Changes only the Groq key; `null` removes it. Never touches `authorized` or `role`. */
export async function setUserGroqKey(email: string, groqApiKey: string | null): Promise<void> {
  await httpsCallable<{ email: string; groqApiKey: string | null }, { email: string; hasGroqKey: boolean }>(
    functions,
    'setUserGroqKey'
  )({ email, groqApiKey });
}

export async function deleteUser(email: string): Promise<void> {
  await httpsCallable<{ email: string }, { email: string }>(functions, 'deleteUser')({ email });
}
