'use client';

import React from 'react';
import { Ban, KeyRound, Trash2, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatAudioHours, formatLastAccess, ROLE_LABELS, type ManagedUser } from '@/lib/adminUsers';
import type { UserRole } from '@/lib/userProfile';

const NO_DATA = '—';

const formatCount = (value: number): string => value.toLocaleString('pt-BR');

interface UserRowProps {
  target: ManagedUser;
  isSelf: boolean;
  onEditGroqKey: (target: ManagedUser) => void;
  onChangeRole: (target: ManagedUser, role: UserRole) => void;
  onToggleAuthorized: (target: ManagedUser) => void;
  onDelete: (email: string) => void;
}

interface MetricProps {
  label: string;
  /** null means "unknown" (the user never ran an app version that reports usage). */
  value: string | null;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="flex flex-col-reverse items-start">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">
        {value ?? (
          <>
            <span aria-hidden="true">{NO_DATA}</span>
            <span className="sr-only">sem dados</span>
          </>
        )}
      </dd>
    </div>
  );
}

export function UserRow({ target, isSelf, onEditGroqKey, onChangeRole, onToggleAuthorized, onDelete }: UserRowProps) {
  // Usage is reported by the app itself: with no sign of it, the counters are unknown, not zero.
  const hasUsageData = target.lastAccessAt !== null || target.meetingsCount > 0 || target.summariesCount > 0;
  const metric = (value: string): string | null => (hasUsageData ? value : null);
  const toggleLabel = target.authorized ? 'Bloquear' : 'Desbloquear';
  const lastAccessTitle = target.lastAccessAt ? new Date(target.lastAccessAt).toLocaleString('pt-BR') : undefined;

  return (
    <li className="px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="truncate text-sm" title={target.email}>
            {target.email}
            {isSelf && <span className="ml-2 text-xs text-gray-500">(você)</span>}
            {!target.authorized && <span className="ml-2 text-xs text-red-600">(bloqueado)</span>}
          </p>
          <p className="text-xs text-gray-500" title={lastAccessTitle}>
            Último acesso: {formatLastAccess(target.lastAccessAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs ${target.hasGroqKey ? 'text-green-700' : 'text-gray-500'}`}>
            {target.hasGroqKey ? 'Groq configurado' : 'Sem chave Groq'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Chave do Groq de ${target.email}`}
            onClick={() => onEditGroqKey(target)}
          >
            <KeyRound className="w-4 h-4" />
          </Button>
          <Select
            value={target.role}
            disabled={isSelf || !target.authorized}
            onValueChange={(value) => onChangeRole(target, value as UserRole)}
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
            aria-label={`${toggleLabel} ${target.email}`}
            title={toggleLabel}
            onClick={() => onToggleAuthorized(target)}
          >
            {target.authorized ? (
              <Ban className="w-4 h-4 text-amber-600" />
            ) : (
              <UserCheck className="w-4 h-4 text-green-700" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={isSelf}
            aria-label={`Remover ${target.email}`}
            title="Remover"
            onClick={() => onDelete(target.email)}
          >
            <Trash2 className="w-4 h-4 text-red-600" />
          </Button>
        </div>
      </div>

      <dl className="mt-2 grid max-w-md grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <Metric label="Aberturas" value={metric(formatCount(target.accessCount))} />
        <Metric label="Reuniões" value={metric(formatCount(target.meetingsCount))} />
        <Metric label="Gravado" value={metric(formatAudioHours(target.audioSeconds))} />
        <Metric label="Resumos" value={metric(formatCount(target.summariesCount))} />
      </dl>
    </li>
  );
}
