'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { askAiService } from '@/services/askAiService';
import { AskKind, AskMessage, AskOpenRequest, AskTurn } from '@/types/ask';

export type AskStatus = 'idle' | 'loading' | 'error';

const USE_WEB_STORAGE_KEY = 'ask_ai_use_web';
const NO_MODEL_ERROR = 'Nenhum modelo de IA configurado. Configure um em Configurações > Resumo.';
const GENERIC_ERROR = 'Não foi possível consultar a IA. Tente novamente.';

function readUseWeb(): boolean {
  try {
    return window.localStorage.getItem(USE_WEB_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeUseWeb(value: boolean): void {
  try {
    window.localStorage.setItem(USE_WEB_STORAGE_KEY, String(value));
  } catch {
    // Preference only; the panel works without storage.
  }
}

interface AskAiContextValue {
  isOpen: boolean;
  /** The keyword or phrase that opened the panel. */
  title: string;
  messages: AskMessage[];
  status: AskStatus;
  error: string | null;
  useWeb: boolean;
  openAsk: (request: AskOpenRequest) => void;
  sendFollowUp: (text: string) => void;
  retry: () => void;
  close: () => void;
  setUseWeb: (value: boolean) => void;
}

const AskAiContext = createContext<AskAiContextValue | undefined>(undefined);

interface LastCall {
  kind: AskKind;
  query: string;
  history: AskTurn[];
}

/**
 * State of the "Perguntar à IA" side panel: one conversation at a time, started
 * from a clicked keyword or a selected phrase. Each call sends the whole
 * conversation, so the backend stays stateless.
 */
export function AskAiProvider({ children }: { children: ReactNode }) {
  const { modelConfig } = useConfig();

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [status, setStatus] = useState<AskStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [useWeb, setUseWebState] = useState<boolean>(readUseWeb);

  // Refs keep the callbacks stable and let late async work read the latest values.
  const messagesRef = useRef<AskMessage[]>([]);
  const contextRef = useRef('');
  const lastCallRef = useRef<LastCall | null>(null);
  const requestIdRef = useRef(0);
  const isLoadingRef = useRef(false);
  const nextMessageIdRef = useRef(0);
  const useWebRef = useRef(useWeb);
  const providerRef = useRef(modelConfig.provider);
  const modelRef = useRef(modelConfig.model);
  providerRef.current = modelConfig.provider;
  modelRef.current = modelConfig.model;

  const pushMessage = useCallback((message: AskMessage) => {
    messagesRef.current = [...messagesRef.current, message];
    setMessages(messagesRef.current);
  }, []);

  const run = useCallback(
    async (call: LastCall) => {
      // A newer request (or closing the panel) makes older answers irrelevant.
      const requestId = ++requestIdRef.current;
      lastCallRef.current = call;
      isLoadingRef.current = true;
      setStatus('loading');
      setError(null);

      if (!providerRef.current || !modelRef.current) {
        isLoadingRef.current = false;
        setError(NO_MODEL_ERROR);
        setStatus('error');
        return;
      }

      try {
        const answer = await askAiService.ask(
          {
            query: call.query,
            kind: call.kind,
            context: contextRef.current,
            history: call.history,
            use_web: useWebRef.current,
          },
          providerRef.current,
          modelRef.current
        );
        if (requestId !== requestIdRef.current) return;

        isLoadingRef.current = false;
        pushMessage({
          id: ++nextMessageIdRef.current,
          role: 'assistant',
          content: answer.markdown,
          sources: answer.sources,
          web: answer.web,
          modelUsed: answer.model_used,
        });
        setStatus('idle');
      } catch (e) {
        if (requestId !== requestIdRef.current) return;

        isLoadingRef.current = false;
        console.error('Ask AI failed:', e);
        setError(typeof e === 'string' ? e : GENERIC_ERROR);
        setStatus('error');
      }
    },
    [pushMessage]
  );

  const openAsk = useCallback(
    (request: AskOpenRequest) => {
      contextRef.current = request.context;
      messagesRef.current = [];
      setTitle(request.query);
      setIsOpen(true);
      pushMessage({ id: ++nextMessageIdRef.current, role: 'user', content: request.query });
      void run({ kind: request.kind, query: request.query, history: [] });
    },
    [pushMessage, run]
  );

  const sendFollowUp = useCallback(
    (text: string) => {
      const query = text.trim();
      if (!query || isLoadingRef.current) return;

      const history: AskTurn[] = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      pushMessage({ id: ++nextMessageIdRef.current, role: 'user', content: query });
      void run({ kind: 'followup', query, history });
    },
    [pushMessage, run]
  );

  const retry = useCallback(() => {
    if (lastCallRef.current) void run(lastCallRef.current);
  }, [run]);

  const close = useCallback(() => {
    requestIdRef.current += 1;
    isLoadingRef.current = false;
    setIsOpen(false);
    setStatus('idle');
    setError(null);
  }, []);

  const setUseWeb = useCallback((value: boolean) => {
    useWebRef.current = value;
    setUseWebState(value);
    writeUseWeb(value);
  }, []);

  const value = useMemo<AskAiContextValue>(
    () => ({
      isOpen,
      title,
      messages,
      status,
      error,
      useWeb,
      openAsk,
      sendFollowUp,
      retry,
      close,
      setUseWeb,
    }),
    [isOpen, title, messages, status, error, useWeb, openAsk, sendFollowUp, retry, close, setUseWeb]
  );

  return <AskAiContext.Provider value={value}>{children}</AskAiContext.Provider>;
}

export function useAskAi(): AskAiContextValue {
  const context = useContext(AskAiContext);
  if (!context) {
    throw new Error('useAskAi must be used within an AskAiProvider');
  }
  return context;
}
