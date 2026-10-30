import { httpsCallable } from 'firebase/functions';
import { formatDistance } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { z } from 'zod';
import { functions } from '@/config/firebase';
import type { UserRole } from '@/lib/userProfile';

export const ALLOWED_EMAIL_DOMAIN = '@ambiental.sc';

const NO_ACCESS_RECORD = 'Sem registro';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = 3600;

export const ROLE_LABELS: Record<UserRole, string> = { admin: 'Administrador', user: 'Usuário' };

export interface ManagedUser {
  email: string;
  role: UserRole;
  authorized: boolean;
  /** The key itself is never sent to the admin UI, only whether one is stored. */
  hasGroqKey: boolean;
  /** ISO date of the last app open; null until a client version that reports usage connects. */
  lastAccessAt: string | null;
  /** Counters reported by the app (see usageTracking.ts): adoption, not billing. */
  accessCount: number;
  meetingsCount: number;
  audioSeconds: number;
  summariesCount: number;
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

/** Changes only the role; unlike upsertUser it never touches `authorized`, so it can't unblock anyone. */
export async function setUserRole(email: string, role: UserRole): Promise<ManagedUser> {
  const result = await httpsCallable<{ email: string; role: UserRole }, ManagedUser>(functions, 'setUserRole')({
    email,
    role,
  });
  return result.data;
}

/** Blocking is what revokes access: deleting a profile only resets it, the next login recreates it. */
export async function setUserAuthorized(email: string, authorized: boolean): Promise<ManagedUser> {
  const result = await httpsCallable<{ email: string; authorized: boolean }, ManagedUser>(
    functions,
    'setUserAuthorized'
  )({ email, authorized });
  return result.data;
}

export async function deleteUser(email: string): Promise<void> {
  await httpsCallable<{ email: string }, { email: string }>(functions, 'deleteUser')({ email });
}

const parseTime = (iso: string | null): number | null => {
  if (iso === null) return null;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
};

export function formatLastAccess(iso: string | null, now: Date = new Date()): string {
  const time = parseTime(iso);
  if (time === null) return NO_ACCESS_RECORD;
  // A server timestamp slightly ahead of this machine's clock must not read as "em 5 minutos".
  return formatDistance(new Date(Math.min(time, now.getTime())), now, { addSuffix: true, locale: ptBR });
}

export function formatAudioHours(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`;
  return `${(seconds / SECONDS_PER_HOUR).toFixed(1).replace('.', ',')} h`;
}

export function countRecentlyActive(users: readonly ManagedUser[], days: number, now: Date = new Date()): number {
  const threshold = now.getTime() - days * MS_PER_DAY;
  return users.filter((user) => (parseTime(user.lastAccessAt) ?? -Infinity) >= threshold).length;
}

/** Most recent access first; users without a record go last, alphabetically. Returns a new array. */
export function sortByLastAccess(users: readonly ManagedUser[]): ManagedUser[] {
  return [...users].sort((a, b) => {
    const timeA = parseTime(a.lastAccessAt);
    const timeB = parseTime(b.lastAccessAt);
    if (timeA !== null && timeB !== null && timeA !== timeB) return timeB - timeA;
    if (timeA !== null && timeB === null) return -1;
    if (timeA === null && timeB !== null) return 1;
    return a.email.localeCompare(b.email);
  });
}
