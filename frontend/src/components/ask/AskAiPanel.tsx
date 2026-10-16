"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Globe, Loader2, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAskAi } from '@/contexts/AskAiContext';
import { isWebUrl, normalizeWebUrl, webHost } from '@/lib/safe-url';
import { AskMessage, AskWebStatus } from '@/types/ask';
import { AskMarkdown, openWebLink } from './AskMarkdown';

const WEB_BADGES: Record<AskWebStatus, { label: string; className: string }> = {
  searched: { label: 'Pesquisou na web', className: 'bg-green-50 text-green-700' },
  off: { label: 'Web desligada', className: 'bg-gray-100 text-gray-500' },
  unavailable: {
    label: 'Sem internet neste provedor',
    className: 'bg-amber-50 text-amber-700',
  },
};

function AssistantMessage({ message }: { message: Extract<AskMessage, { role: 'assistant' }> }) {
  const badge = WEB_BADGES[message.web];
  const sources = message.sources.filter((source) => isWebUrl(source.url));

  return (
    <div className="rounded-[5px] border border-gray-200 bg-[#F7F7F7] p-3 text-sm font-light text-[#312D31]">
      <AskMarkdown allowedUrls={sources.map((source) => source.url)}>{message.content}</AskMarkdown>

      {sources.length > 0 && (
        <div className="mt-3 border-t border-gray-200 pt-2">
          <p className="mb-1 text-xs font-semibold text-[#164194]">Fontes</p>
          <ul className="space-y-0.5">
            {sources.map((source) => (
              <li key={source.url} className="truncate text-xs">
                <a
                  href={normalizeWebUrl(source.url) ?? undefined}
                  title={source.url}
                  className="text-[#164194] underline underline-offset-2 hover:text-[#0f2f6e]"
                  onClick={(event) => {
                    event.preventDefault();
                    openWebLink(source.url);
                  }}
                >
                  {source.title}
                </a>
                <span className="text-gray-500"> · {webHost(source.url)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className={`rounded-full px-2 py-0.5 font-medium ${badge.className}`}>
          {badge.label}
        </span>
        {message.modelUsed && <span className="text-gray-400">{message.modelUsed}</span>}
      </div>
    </div>
  );
}

/**
 * Right-side panel with the conversation opened by a clicked keyword or a
 * selected phrase. Not modal: the screen behind stays usable (e.g. to select
 * more text), so it has no overlay and the recording keeps running.
 */
export function AskAiPanel() {
  const { isOpen, title, messages, status, error, useWeb, setUseWeb, sendFollowUp, retry, close } =
    useAskAi();
  const [draft, setDraft] = useState('');
  const listEndRef = useRef<HTMLDivElement>(null);
  const isLoading = status === 'loading';

  useEffect(() => {
    if (!isOpen) return;

    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen, close]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  // A new conversation starts with an empty follow-up box.
  useEffect(() => {
    if (isOpen) setDraft('');
  }, [isOpen, title]);

  const submit = () => {
    if (!draft.trim() || isLoading) return;
    sendFollowUp(draft);
    setDraft('');
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          key="ask-ai-panel"
          aria-label="Perguntar à IA"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed right-0 top-0 z-40 flex h-screen w-[min(420px,100vw)] flex-col border-l border-gray-200 bg-white shadow-xl"
        >
          <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#63B869]">
                <Sparkles size={13} aria-hidden="true" />
                Perguntar à IA
              </p>
              <h2
                className="mt-0.5 line-clamp-2 break-words text-sm font-semibold text-[#164194]"
                title={title}
              >
                {title}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={close}
              aria-label="Fechar painel"
              className="shrink-0"
            >
              <X />
            </Button>
          </header>

          <div className="border-b border-gray-100 px-4 py-2.5">
            <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-gray-700">
              <span className="flex items-center gap-1.5">
                <Globe size={15} className="text-[#63B869]" aria-hidden="true" />
                Pesquisar na web
              </span>
              <Switch checked={useWeb} onCheckedChange={setUseWeb} aria-label="Pesquisar na web" />
            </label>
            <p className="mt-1 text-[11px] font-light leading-snug text-gray-500">
              {useWeb
                ? 'O termo e um trecho da reunião vão para o seu provedor de IA, que consulta a internet quando pode.'
                : 'Sem consultar a internet. O termo e um trecho da reunião ainda vão para o seu provedor de IA.'}
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            {messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="flex justify-end">
                  <p className="max-w-[90%] break-words rounded-[5px] bg-[#164194] px-3 py-2 text-sm font-light text-white">
                    {message.content}
                  </p>
                </div>
              ) : (
                <AssistantMessage key={message.id} message={message} />
              )
            )}

            {isLoading && (
              <p className="flex items-center gap-2 text-sm font-light text-gray-500">
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                {useWeb ? 'Pesquisando…' : 'Pensando…'}
              </p>
            )}

            {status === 'error' && (
              <div className="rounded-[5px] border border-red-200 bg-red-50 p-3" role="alert">
                <p className="flex items-start gap-1.5 text-sm text-red-700">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="break-words">{error}</span>
                </p>
                <Button variant="outline" size="sm" className="mt-2" onClick={retry}>
                  <RefreshCw size={14} />
                  Tentar de novo
                </Button>
              </div>
            )}

            <div ref={listEndRef} />
          </div>

          <form onSubmit={onSubmit} className="border-t border-gray-200 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onDraftKeyDown}
                rows={2}
                maxLength={1000}
                placeholder="Pergunte algo mais sobre isso…"
                aria-label="Pergunta de acompanhamento"
                className="min-h-[44px] flex-1 resize-none rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!draft.trim() || isLoading}
                aria-label="Enviar pergunta"
                className="bg-[#A8C950] text-white hover:bg-[#9BBF3B]"
              >
                <Send />
              </Button>
            </div>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
