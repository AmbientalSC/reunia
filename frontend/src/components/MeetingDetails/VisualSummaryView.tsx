"use client";

import { VisualActionItem, VisualQuote, VisualSummaryData, VisualTopic } from '@/types';
import {
  CheckCircle2,
  ClipboardList,
  ListOrdered,
  Quote,
  Sparkles,
  User,
  CalendarClock,
  Users,
} from 'lucide-react';
import { ReactNode } from 'react';

interface VisualSummaryViewProps {
  data: VisualSummaryData;
  meetingTitle: string;
  createdAt: string;
  updatedAt?: string | null;
}

// The LLM output is untrusted: coerce every field defensively before rendering.
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item))
    .filter((item): item is string => item !== null);
}

function asActionItems(value: unknown): VisualActionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return { task: item } as VisualActionItem;
      if (item && typeof item === 'object') {
        const task = asText((item as VisualActionItem).task);
        if (!task) return null;
        return {
          task,
          owner: asText((item as VisualActionItem).owner),
          due: asText((item as VisualActionItem).due),
        };
      }
      return null;
    })
    .filter((item): item is VisualActionItem => item !== null);
}

function asTopics(value: unknown): VisualTopic[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const title = asText((item as VisualTopic).title);
      const summary = asText((item as VisualTopic).summary);
      if (!title && !summary) return null;
      return { title: title ?? '', summary: summary ?? '' };
    })
    .filter((item): item is VisualTopic => item !== null);
}

function asQuotes(value: unknown): VisualQuote[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return { text: item } as VisualQuote;
      if (item && typeof item === 'object') {
        const text = asText((item as VisualQuote).text);
        if (!text) return null;
        return { text, speaker: asText((item as VisualQuote).speaker) };
      }
      return null;
    })
    .filter((item): item is VisualQuote => item !== null);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function SectionHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-base font-bold text-[#164194] mb-4">
      <span className="text-[#63B869]" aria-hidden="true">
        {icon}
      </span>
      {children}
    </h3>
  );
}

export function VisualSummaryView({
  data,
  meetingTitle,
  createdAt,
  updatedAt,
}: VisualSummaryViewProps) {
  const tagline = asText(data.tagline);
  const overview = asText(data.overview);
  const participants = asTextArray(data.participants);
  const highlights = asTextArray(data.highlights);
  const decisions = asTextArray(data.decisions);
  const actionItems = asActionItems(data.action_items);
  const topics = asTopics(data.topics);
  const quotes = asQuotes(data.quotes);

  const metrics = [
    { label: 'Destaques', value: highlights.length },
    { label: 'Decisões', value: decisions.length },
    { label: 'Ações', value: actionItems.length },
    { label: 'Tópicos', value: topics.length },
  ].filter((metric) => metric.value > 0);

  return (
    <div className="w-full text-[#312D31]">
      {/* Faixa hero — azul institucional */}
      <section className="w-full bg-[#164194] px-6 py-8">
        <p className="text-xs font-light text-[#7C91BB]">
          {formatDate(createdAt)}
          {updatedAt ? ` · Tela atualizada em ${formatDate(updatedAt)}` : ''}
        </p>
        <h2 className="mt-1 text-2xl font-bold text-white">{meetingTitle}</h2>
        {tagline && (
          <p className="mt-3 text-3xl font-thin leading-tight text-white">{tagline}</p>
        )}
        {participants.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-light text-[#7C91BB]">
              <Users size={14} aria-hidden="true" />
              Participantes
            </span>
            {participants.map((participant, index) => (
              <span
                key={index}
                className="rounded-full bg-[#003087] px-3 py-1 text-xs font-light text-white"
              >
                {participant}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Métricas */}
      {metrics.length > 0 && (
        <section className="w-full px-6 py-6">
          <div className="grid w-full grid-cols-2 gap-4 lg:grid-cols-4">
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-[5px] border border-gray-200 border-l-4 border-l-[#A8C950] bg-white px-4 py-3"
              >
                <p className="text-3xl font-bold text-[#164194]">{metric.value}</p>
                <p className="text-xs font-light text-[#808080]">{metric.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Visão geral */}
      {overview && (
        <section className="w-full bg-[#F7F7F7] px-6 py-6">
          <p className="text-sm font-light leading-relaxed">{overview}</p>
        </section>
      )}

      {/* Destaques */}
      {highlights.length > 0 && (
        <section className="w-full px-6 py-6">
          <SectionHeading icon={<Sparkles size={18} />}>Destaques</SectionHeading>
          <div className="grid w-full gap-3 md:grid-cols-2">
            {highlights.map((highlight, index) => (
              <div
                key={index}
                className="rounded-[5px] border border-gray-200 bg-white p-4 text-sm font-light leading-relaxed"
              >
                {highlight}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Decisões */}
      {decisions.length > 0 && (
        <section className="w-full bg-[#F7F7F7] px-6 py-6">
          <SectionHeading icon={<CheckCircle2 size={18} />}>Decisões</SectionHeading>
          <ul className="space-y-2">
            {decisions.map((decision, index) => (
              <li key={index} className="flex items-start gap-2 text-sm font-light leading-relaxed">
                <CheckCircle2
                  size={16}
                  className="mt-0.5 flex-shrink-0 text-[#63B869]"
                  aria-hidden="true"
                />
                {decision}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Plano de ação */}
      {actionItems.length > 0 && (
        <section className="w-full px-6 py-6">
          <SectionHeading icon={<ClipboardList size={18} />}>Plano de ação</SectionHeading>
          <div className="space-y-2">
            {actionItems.map((item, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[5px] border border-gray-200 bg-white px-4 py-3"
              >
                <p className="min-w-0 flex-1 text-sm font-light leading-relaxed">{item.task}</p>
                {item.owner && (
                  <span className="flex items-center gap-1.5 rounded-full bg-[#F7F7F7] px-3 py-1 text-xs font-light text-[#164194]">
                    <User size={13} aria-hidden="true" />
                    {item.owner}
                  </span>
                )}
                {item.due && (
                  <span className="flex items-center gap-1.5 rounded-full bg-[#A8C950] px-3 py-1 text-xs font-light text-white">
                    <CalendarClock size={13} aria-hidden="true" />
                    {item.due}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Linha do tempo dos tópicos */}
      {topics.length > 0 && (
        <section className="w-full bg-[#F7F7F7] px-6 py-6">
          <SectionHeading icon={<ListOrdered size={18} />}>Tópicos da reunião</SectionHeading>
          <ol className="relative ml-2 space-y-5 border-l border-[#A8C950] pl-5">
            {topics.map((topic, index) => (
              <li key={index} className="relative">
                <span
                  className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-[#63B869]"
                  aria-hidden="true"
                />
                {topic.title && (
                  <p className="text-sm font-bold text-[#164194]">{topic.title}</p>
                )}
                {topic.summary && (
                  <p className="mt-0.5 text-sm font-light leading-relaxed">{topic.summary}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Frases marcantes */}
      {quotes.length > 0 && (
        <section className="w-full px-6 py-6">
          <SectionHeading icon={<Quote size={18} />}>Frases marcantes</SectionHeading>
          <div className="grid w-full gap-3 md:grid-cols-2">
            {quotes.map((quote, index) => (
              <blockquote
                key={index}
                className="rounded-[5px] border-l-4 border-[#164194] bg-[#F7F7F7] p-4"
              >
                <p className="text-sm font-light italic leading-relaxed">“{quote.text}”</p>
                {quote.speaker && (
                  <footer className="mt-2 text-xs font-light text-[#808080]">
                    — {quote.speaker}
                  </footer>
                )}
              </blockquote>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
