"use client";

import { Button } from '@/components/ui/button';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { useVisualSummary } from '@/hooks/meeting-details/useVisualSummary';
import { VisualSummaryView } from './VisualSummaryView';
import Analytics from '@/lib/analytics';
import { AlertTriangle, LayoutDashboard, Loader2, RefreshCw } from 'lucide-react';

interface VisualSummaryPanelProps {
  meeting: {
    id: string;
    created_at: string;
  };
  meetingTitle: string;
  modelConfig: ModelConfig;
  hasSummary: boolean;
  isSummaryGenerating: boolean;
}

export function VisualSummaryPanel({
  meeting,
  meetingTitle,
  modelConfig,
  hasSummary,
  isSummaryGenerating,
}: VisualSummaryPanelProps) {
  const {
    visualData,
    visualStatus,
    visualError,
    visualUpdatedAt,
    isGeneratingVisual,
    generateVisualSummary,
  } = useVisualSummary(meeting.id);

  const handleGenerate = () => {
    Analytics.trackButtonClick('generate_visual_summary', 'meeting_details');
    generateVisualSummary(modelConfig.provider, modelConfig.model);
  };

  if (isGeneratingVisual) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-t-2 border-[#164194]" />
          <p className="font-light text-gray-600">Gerando a tela visual da reunião...</p>
        </div>
      </div>
    );
  }

  if (visualStatus === 'completed' && visualData) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center justify-end px-6 pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            title="Regenerar a tela visual"
          >
            <RefreshCw size={16} className="mr-1.5" />
            Regenerar tela
          </Button>
        </div>
        <VisualSummaryView
          data={visualData}
          meetingTitle={meetingTitle}
          createdAt={meeting.created_at}
          updatedAt={visualUpdatedAt}
        />
      </div>
    );
  }

  if (visualStatus === 'failed' || (visualStatus === 'completed' && !visualData)) {
    const isUnreadable = visualStatus === 'completed';
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <AlertTriangle size={36} className="mx-auto mb-3 text-red-500" aria-hidden="true" />
          <p className="mb-1 font-medium text-gray-800">
            {isUnreadable
              ? 'Não foi possível ler os dados da tela visual'
              : 'Falha ao gerar a tela visual'}
          </p>
          {isUnreadable && (
            <p className="mb-4 text-sm font-light text-gray-500">
              A tela foi gerada, mas o conteúdo salvo está ilegível. Regenere para corrigir.
            </p>
          )}
          {!isUnreadable && visualError && (
            <p className="mb-4 break-words text-sm font-light text-gray-500">{visualError}</p>
          )}
          {hasSummary && (
            <Button
              className="bg-[#A8C950] text-white hover:bg-[#9BBF3B]"
              size="sm"
              onClick={handleGenerate}
            >
              <RefreshCw size={16} className="mr-1.5" />
              Tentar novamente
            </Button>
          )}
        </div>
      </div>
    );
  }

  // idle / cancelled — no visual summary yet
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <LayoutDashboard size={36} className="mx-auto mb-3 text-[#164194]" aria-hidden="true" />
        <p className="mb-1 font-medium text-gray-800">Nenhuma tela visual ainda</p>
        {isSummaryGenerating ? (
          <p className="flex items-center justify-center gap-2 text-sm font-light text-gray-500">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            Aguardando o resumo — a tela será gerada automaticamente em seguida.
          </p>
        ) : hasSummary ? (
          <>
            <p className="mb-4 text-sm font-light text-gray-500">
              Esta reunião já tem resumo. Gere a tela visual a partir dele.
            </p>
            <Button
              className="bg-[#A8C950] text-white hover:bg-[#9BBF3B]"
              size="sm"
              onClick={handleGenerate}
            >
              <LayoutDashboard size={16} className="mr-1.5" />
              Gerar tela
            </Button>
          </>
        ) : (
          <p className="text-sm font-light text-gray-500">
            Gere o resumo da reunião — a tela visual é criada automaticamente junto com ele.
          </p>
        )}
      </div>
    </div>
  );
}
