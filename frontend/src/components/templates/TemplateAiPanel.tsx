"use client";

import { useState } from 'react';
import { Loader2, Sparkles, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const MAX_REQUEST_CHARS = 1500;

interface TemplateAiPanelProps {
  /** Why the AI cannot be used right now (e.g. no model configured); null when available. */
  unavailableReason: string | null;
  isGenerating: boolean;
  /** Another AI task (e.g. improving one section) is running. */
  isBusy: boolean;
  canUndo: boolean;
  onGenerate: (description: string) => void;
  onUndo: () => void;
}

/** "Criar com IA": drafts the whole template from a free-text description. */
export function TemplateAiPanel({
  unavailableReason,
  isGenerating,
  isBusy,
  canUndo,
  onGenerate,
  onUndo,
}: TemplateAiPanelProps) {
  const [description, setDescription] = useState('');
  const canGenerate = !unavailableReason && !isBusy && description.trim().length > 0;

  return (
    <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
        <Sparkles size={16} aria-hidden="true" />
        Criar com IA
      </div>

      <Textarea
        value={description}
        maxLength={MAX_REQUEST_CHARS}
        rows={2}
        disabled={isBusy}
        aria-label="Descreva a reunião ou ata para a IA"
        placeholder="Descreva a reunião ou a ata. Ex.: reunião mensal de condomínio, com pauta, deliberações, votações e responsáveis por cada pendência"
        className="bg-white"
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs text-gray-600">
          {unavailableReason ??
            'A IA preenche o formulário abaixo. Revise e ajuste antes de salvar.'}
        </p>
        <div className="flex shrink-0 gap-2">
          {canUndo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              title="Desfaz a última sugestão da IA"
              onClick={onUndo}
            >
              <Undo2 />
              Desfazer
            </Button>
          )}
          <Button
            type="button"
            variant="blue"
            size="sm"
            disabled={!canGenerate}
            onClick={() => onGenerate(description)}
          >
            {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {isGenerating ? 'Gerando…' : 'Gerar modelo'}
          </Button>
        </div>
      </div>
    </div>
  );
}
