import { httpsCallable } from 'firebase/functions';
import { z } from 'zod';
import { functions } from '@/config/firebase';
import type { UserRole } from '@/lib/userProfile';

export const ALLOWED_EMAIL_DOMAIN = '@ambiental.sc';

export interface ManagedUser {
  email: string;
  role: UserRole;
  authorized: boolean;
}

export const userFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._%+-]+@ambiental\.sc$/, `Use um e-mail ${ALLOWED_EMAIL_DOMAIN}`),
  role: z.enum(['admin', 'user']),
});

export type UserFormValues = z.infer<typeof userFormSchema>;

export async function listUsers(): Promise<ManagedUser[]> {
  const result = await httpsCallable<void, ManagedUser[]>(functions, 'listUsers')();
  return result.data;
}

export async function upsertUser(values: UserFormValues): Promise<ManagedUser> {
  const result = await httpsCallable<UserFormValues, ManagedUser>(functions, 'upsertUser')(values);
  return result.data;
}

export async function deleteUser(email: string): Promise<void> {
  await httpsCallable<{ email: string }, { email: string }>(functions, 'deleteUser')({ email });
}
