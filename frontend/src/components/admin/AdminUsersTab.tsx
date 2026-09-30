'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmationModal } from '@/components/ConfirmationModel/confirmation-modal';
import { useAuth } from '@/contexts/AuthContext';
import {
  ALLOWED_EMAIL_DOMAIN,
  deleteUser,
  listUsers,
  upsertUser,
  userFormSchema,
  type ManagedUser,
  type UserFormValues,
} from '@/lib/adminUsers';
import type { UserRole } from '@/lib/userProfile';

const ROLE_LABELS: Record<UserRole, string> = { admin: 'Administrador', user: 'Usuário' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro inesperado.';
}

export function AdminUsersTab() {
  const { user } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: { email: '', role: 'user' },
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
      await upsertUser(values);
      toast.success(`${values.email} salvo.`);
      form.reset({ email: '', role: values.role });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const changeRole = async (target: ManagedUser, role: UserRole) => {
    try {
      await upsertUser({ email: target.email, role });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
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

  return (
    <div className="space-y-6 mt-6">
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-1">Autorizar usuário</h2>
        <p className="text-sm text-gray-600 mb-4">
          Só quem estiver nesta lista consegue entrar no app.
        </p>
        <form onSubmit={form.handleSubmit(save)} className="flex flex-col gap-3 sm:flex-row sm:items-start">
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
        </form>
      </section>

      <section className="bg-white rounded-lg border border-gray-200">
        <h2 className="text-lg font-semibold p-6 pb-3">Usuários ({users.length})</h2>
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {users.map((target) => {
              const isSelf = target.email === user?.email?.toLowerCase();
              return (
                <li key={target.email} className="flex items-center gap-3 px-6 py-3">
                  <span className="flex-1 truncate text-sm">
                    {target.email}
                    {isSelf && <span className="ml-2 text-xs text-gray-500">(você)</span>}
                    {!target.authorized && <span className="ml-2 text-xs text-red-600">(bloqueado)</span>}
                  </span>
                  <Select
                    value={target.role}
                    disabled={isSelf}
                    onValueChange={(value) => void changeRole(target, value as UserRole)}
                  >
                    <SelectTrigger className="w-44" aria-label={`Role de ${target.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">{ROLE_LABELS.user}</SelectItem>
                      <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isSelf}
                    aria-label={`Remover ${target.email}`}
                    onClick={() => setPendingDelete(target.email)}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmationModal
        isOpen={pendingDelete !== null}
        text={`Remover ${pendingDelete ?? ''}? Essa pessoa não conseguirá mais entrar no app.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
