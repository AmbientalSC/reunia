"use client";

import { ReactNode, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { LiveInsightData } from '@/types';
import { LiveInsightStatus } from '@/hooks/useLiveInsight';
import { AlertTriangle, ClipboardList, HelpCircle, Loader2, RefreshCw, Search, Sparkles, Tag } from 'lucide-react';
import { SelectionAskButton } from '@/components/ask/SelectionAskButton';
import { useAskAi } from '@/contexts/AskAiContext';
import { buildAskContext } from '@/lib/ask-selection';
import { AskOpenRequest } from '@/types/ask';

interface LiveInsightPanelProps {
  insight: LiveInsightData | null;
  status: LiveInsightStatus;
  error: string | null;
  hasEnoughTranscript: boolean;
  onRefresh: () => void;
  /** `saved`: the insight of a finished meeting, generated on demand instead of automatically. */
  variant?: 'live' | 'saved';
  /** Meeting text sent to the AI as background when the user asks about `query`. */
  getTranscriptContext?: (query: string) => string;
}

function SectionHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#164194]">
      <span className="text-[#63B869]" aria-hidden="true">
        {icon}
      </span>
      {children}
    </h3>
  );
}

/**
 * Renders the lightweight, real-time insight generated while a meeting is
 * being recorded (see `useLiveInsight`), and the one saved with a meeting.
 * Separate from the post-meeting summary/report and from the "Tela" visual
 * summary.
 *
 * Keywords are clickable and any text selected in the insight can be sent to
 * the "Perguntar à IA" side panel.
 */
export function LiveInsightPanel({
  insight,
  status,
  error,
  hasEnoughTranscript,
  onRefresh,
  variant = 'live',
  getTranscriptContext,
}: LiveInsightPanelProps) {
  const { openAsk } = useAskAi();
  const selectionScopeRef = useRef<HTMLDivElement>(null);

  const ask = (kind: AskOpenRequest['kind'], query: string) => {
    openAsk({
      kind,
      query,
      // The end of the context is the part kept when it is too long, so the topic goes last.
      context: buildAskContext([
        getTranscriptContext?.(query),
        insight?.topic.title ? `Tópico atual: ${insight.topic.title}` : null,
      ]),
    });
  };

  if (!insight && status === 'idle' && variant === 'saved') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <Sparkles size={36} className="mx-auto mb-3 text-[#164194]" aria-hidden="true" />
          <p className="mb-1 font-medium text-gray-800">Nenhum insight salvo</p>
          <p className="mb-4 text-sm font-light text-gray-500">
            {hasEnoughTranscript
              ? 'Gere o insight desta reunião a partir da transcrição.'
              : 'Esta reunião não tem transcrição para gerar o insight.'}
          </p>
          <Button
            className="bg-[#A8C950] text-white hover:bg-[#9BBF3B]"
            size="sm"
            onClick={onRefresh}
            disabled={!hasEnoughTranscript}
          >
            <Sparkles size={16} className="mr-1.5" />
            Gerar insight
          </Button>
        </div>
      </div>
    );
  }

  if (!insight && status === 'idle') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <Sparkles size={36} className="mx-auto mb-3 text-[#164194]" aria-hidden="true" />
          <p className="mb-1 font-medium text-gray-800">Nenhum insight ainda</p>
          <p className="text-sm font-light text-gray-500">
            {hasEnoughTranscript
              ? 'O primeiro insight será gerado automaticamente em instantes.'
              : 'Fale um pouco mais para gerar o primeiro insight da reunião.'}
          </p>
        </div>
      </div>
    );
  }

  if (!insight && status === 'generating') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-t-2 border-[#164194]" />
          <p className="font-light text-gray-600">Gerando o primeiro insight...</p>
        </div>
      </div>
    );
  }

  if (!insight && status === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <AlertTriangle size={36} className="mx-auto mb-3 text-red-500" aria-hidden="true" />
          <p className="mb-1 font-medium text-gray-800">Não foi possível gerar o insight</p>
          {error && <p className="mb-4 break-words text-sm font-light text-gray-500">{error}</p>}
          <Button className="bg-[#A8C950] text-white hover:bg-[#9BBF3B]" size="sm" onClick={onRefresh}>
            <RefreshCw size={16} className="mr-1.5" />
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (!insight) return null;

  const hasSummary = insight.summary.length > 0;
  const hasTopic = insight.topic.bullets.length > 0 || Boolean(insight.topic.title);
  const hasQuestions = insight.questions.length > 0;
  const hasActions = insight.actions.length > 0;
  const hasAttention = insight.attention_points.length > 0;
  const keywords = insight.keywords ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-6 pt-3">
        {status === 'error' ? (
          <p className="flex items-center gap-1.5 text-xs font-light text-red-500">
            <AlertTriangle size={13} aria-hidden="true" />
            {error || 'Falha ao atualizar o insight.'}
          </p>
        ) : status === 'generating' ? (
          <p className="flex items-center gap-1.5 text-xs font-light text-gray-500">
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            Atualizando insight...
          </p>
        ) : (
          <span />
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={status === 'generating'}
          title="Atualizar insight"
        >
          <RefreshCw size={16} className={`mr-1.5 ${status === 'generating' ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <div ref={selectionScopeRef} className="px-6 py-4 text-[#312D31]">
        {keywords.length > 0 && (
          <section className="mb-5">
            <SectionHeading icon={<Tag size={15} />}>Palavras-chave</SectionHeading>
            <ul className="flex flex-wrap gap-2">
              {keywords.map((keyword) => (
                <li key={keyword}>
                  <button
                    type="button"
                    onClick={() => ask('term', keyword)}
                    title={`Pesquisar "${keyword}"`}
                    className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-sm font-light text-[#164194] transition-colors hover:border-[#164194] hover:bg-[#F7F7F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#164194]"
                  >
                    <Search size={12} aria-hidden="true" />
                    {keyword}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasSummary && (
          <section className="mb-5">
            <SectionHeading icon={<Sparkles size={15} />}>Resumo do momento</SectionHeading>
            <ul className="space-y-1.5">
              {insight.summary.map((item, index) => (
                <li key={index} className="text-sm font-light leading-relaxed">
                  • {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasTopic && (
          <section className="mb-5 rounded-[5px] border border-gray-200 bg-[#F7F7F7] p-4">
            {insight.topic.title && (
              <p className="mb-2 text-sm font-semibold text-[#164194]">{insight.topic.title}</p>
            )}
            {insight.topic.bullets.length > 0 && (
              <ul className="mb-2 space-y-1">
                {insight.topic.bullets.map((bullet, index) => (
                  <li key={index} className="text-sm font-light leading-relaxed">
                    • {bullet}
                  </li>
                ))}
              </ul>
            )}
            {insight.topic.explanation && (
              <p className="text-sm font-light leading-relaxed text-gray-600">{insight.topic.explanation}</p>
            )}
          </section>
        )}

        {hasQuestions && (
          <section className="mb-5">
            <SectionHeading icon={<HelpCircle size={15} />}>Perguntas em aberto</SectionHeading>
            <ul className="space-y-1.5">
              {insight.questions.map((question, index) => (
                <li key={index} className="text-sm font-light leading-relaxed">
                  ? {question}
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasActions && (
          <section className="mb-5">
            <SectionHeading icon={<ClipboardList size={15} />}>Ações</SectionHeading>
            <ul className="space-y-1.5">
              {insight.actions.map((action, index) => (
                <li key={index} className="text-sm font-light leading-relaxed">
                  ▸ {action}
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasAttention && (
          <section className="mb-5 rounded-[5px] border-l-4 border-[#A8C950] bg-[#F7F7F7] p-3">
            <SectionHeading icon={<AlertTriangle size={15} />}>Pontos de atenção</SectionHeading>
            <ul className="space-y-1.5">
              {insight.attention_points.map((point, index) => (
                <li key={index} className="text-sm font-light leading-relaxed">
                  {point}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <SelectionAskButton scopeRef={selectionScopeRef} onAsk={(text) => ask('selection', text)} />
    </div>
  );
}
