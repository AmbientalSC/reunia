'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GROQ_KEY_ERROR, GROQ_KEY_PATTERN, type ManagedUser } from '@/lib/adminUsers';

interface GroqKeyDialogProps {
  target: ManagedUser | null;
  onClose: () => void;
  /** `null` removes the stored key. Must throw on failure so the dialog stays open and shows the message. */
  onSave: (target: ManagedUser, key: string | null) => Promise<void>;
}

const ERROR_ID = 'groq-key-error';

export function GroqKeyDialog({ target, onClose, onSave }: GroqKeyDialogProps) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);

  // Radix keeps the content mounted during the close animation, after `target` is already null.
  const lastTarget = useRef<ManagedUser | null>(target);
  if (target) lastTarget.current = target;
  const shown = target ?? lastTarget.current;

  useEffect(() => {
    setKey('');
    setError(null);
    setIsConfirmingRemoval(false);
  }, [target?.email]);

  const submit = async (nextKey: string | null) => {
    if (!target) return;
    if (nextKey !== null && !GROQ_KEY_PATTERN.test(nextKey)) {
      setError(GROQ_KEY_ERROR);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(target, nextKey);
      onClose();
    } catch (saveError) {
      setIsConfirmingRemoval(false);
      setError(saveError instanceof Error ? saveError.message : 'Erro inesperado.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chave do Groq</DialogTitle>
          <DialogDescription>
            {shown?.email}
            {shown?.hasGroqKey
              ? ' já tem uma chave salva. Informe uma nova para substituir.'
              : ' ainda não tem chave. Ela será usada nas transcrições e resumos.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(key.trim());
          }}
          className="space-y-2"
        >
          <Input
            type="password"
            autoComplete="off"
            placeholder="gsk_..."
            aria-label="Chave do Groq"
            aria-invalid={!!error}
            aria-describedby={error ? ERROR_ID : undefined}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setError(null);
            }}
          />
          {error && (
            <p id={ERROR_ID} role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <DialogFooter className="pt-2">
            {shown?.hasGroqKey && (
              <Button
                type="button"
                variant="ghost"
                className="text-red-600 sm:mr-auto"
                disabled={isSaving}
                onClick={() => (isConfirmingRemoval ? void submit(null) : setIsConfirmingRemoval(true))}
              >
                {isConfirmingRemoval ? 'Confirmar remoção' : 'Remover chave'}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={isSaving} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving || key.trim() === ''}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
