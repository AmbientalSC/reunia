'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmationModal } from '@/components/ConfirmationModel/confirmation-modal';
import { useAuth } from '@/contexts/AuthContext';
import { GroqKeyDialog } from './GroqKeyDialog';
import { UserRow } from './UserRow';
import {
  ALLOWED_EMAIL_DOMAIN,
  ROLE_LABELS,
  countRecentlyActive,
  deleteUser,
  listUsers,
  setUserAuthorized,
  setUserGroqKey,
  setUserRole,
  sortByLastAccess,
  upsertUser,
  userFormSchema,
  type ManagedUser,
  type UserFormValues,
} from '@/lib/adminUsers';
import type { UserRole } from '@/lib/userProfile';

const ACTIVE_WINDOW_DAYS = 7;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro inesperado.';
}

export function AdminUsersTab() {
  const { userEmail } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [groqTarget, setGroqTarget] = useState<ManagedUser | null>(null);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: { email: '', role: 'user', groqApiKey: '' },
  });

  const refresh = useCallback(async () => {
    try {
      setUsers(await listUsers());
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (values: UserFormValues) => {
    try {
      await upsertUser({ ...values, groqApiKey: values.groqApiKey || undefined });
      toast.success(`${values.email} salvo.`);
      form.reset({ email: '', role: values.role, groqApiKey: '' });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const changeRole = async (target: ManagedUser, role: UserRole) => {
    try {
      await setUserRole(target.email, role);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const saveGroqKey = async (target: ManagedUser, groqApiKey: string | null) => {
    try {
      await setUserGroqKey(target.email, groqApiKey);
      toast.success(groqApiKey === null ? 'Chave do Groq removida.' : 'Chave do Groq salva.');
      await refresh();
    } catch (error) {
      // The dialog shows the message; refresh in case the user was changed or removed meanwhile.
      await refresh();
      throw error;
    }
  };

  const toggleAuthorized = async (target: ManagedUser) => {
    const authorized = !target.authorized;
    try {
      await setUserAuthorized(target.email, authorized);
      toast.success(`${target.email} ${authorized ? 'desbloqueado' : 'bloqueado'}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      await refresh();
    }
  };

  const confirmDelete = async () => {
    const email = pendingDelete;
    setPendingDelete(null);
    if (!email) return;
    try {
      await deleteUser(email);
      toast.success(`${email} removido.`);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const role = form.watch('role');
  const emailError = form.formState.errors.email?.message;
  const groqKeyError = form.formState.errors.groqApiKey?.message;
  const sortedUsers = useMemo(() => sortByLastAccess(users), [users]);
  const activeCount = useMemo(() => countRecentlyActive(users, ACTIVE_WINDOW_DAYS), [users]);

  return (
    <div className="space-y-6 mt-6">
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-1">Adicionar ou promover usuário</h2>
        <p className="text-sm text-gray-600 mb-4">
          Qualquer pessoa com e-mail {ALLOWED_EMAIL_DOMAIN} entra sozinha no primeiro login. Use este
          formulário para já definir a função ou a chave do Groq de alguém. Se a pessoa estiver
          bloqueada, salvar aqui também a desbloqueia.
        </p>
        <form onSubmit={form.handleSubmit(save)} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <Input
              type="email"
              placeholder={`nome${ALLOWED_EMAIL_DOMAIN}`}
              aria-label="E-mail"
              aria-invalid={!!emailError}
              {...form.register('email')}
            />
            {emailError && <p className="text-sm text-red-600 mt-1">{emailError}</p>}
          </div>
          <Select value={role} onValueChange={(value) => form.setValue('role', value as UserRole)}>
            <SelectTrigger className="sm:w-48" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{ROLE_LABELS.user}</SelectItem>
              <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4 mr-2" />
            )}
            Adicionar
          </Button>
          </div>
          <div>
            <Input
              type="password"
              autoComplete="off"
              placeholder="Chave do Groq (opcional) — gsk_..."
              aria-label="Chave do Groq"
              aria-invalid={!!groqKeyError}
              {...form.register('groqApiKey')}
            />
            {groqKeyError && <p className="text-sm text-red-600 mt-1">{groqKeyError}</p>}
          </div>
        </form>
      </section>

      <section className="bg-white rounded-lg border border-gray-200">
        <div className="p-6 pb-3">
          <h2 className="text-lg font-semibold">Usuários ({users.length})</h2>
          <p className="text-sm text-gray-600">
            {activeCount} com acesso nos últimos {ACTIVE_WINDOW_DAYS} dias. Os números vêm do próprio app e
            medem adoção; versões antigas do app ainda não enviam dados.
          </p>
        </div>
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <ul aria-label="Usuários" className="divide-y divide-gray-100">
            {sortedUsers.map((target) => (
              <UserRow
                key={target.email}
                target={target}
                isSelf={target.email === userEmail}
                onEditGroqKey={setGroqTarget}
                onChangeRole={(row, newRole) => void changeRole(row, newRole)}
                onToggleAuthorized={(row) => void toggleAuthorized(row)}
                onDelete={setPendingDelete}
              />
            ))}
          </ul>
        )}
      </section>

      <GroqKeyDialog target={groqTarget} onClose={() => setGroqTarget(null)} onSave={saveGroqKey} />

      <ConfirmationModal
        isOpen={pendingDelete !== null}
        text={`Remover ${pendingDelete ?? ''}? O cadastro e os contadores de uso serão apagados, e a pessoa volta a entrar no próximo login. Para impedir o acesso, use Bloquear.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
