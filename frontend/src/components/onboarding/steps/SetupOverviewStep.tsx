import React, { useEffect, useState } from 'react';
import { Info, Cloud, Eye, EyeOff } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const GROQ_MODEL = 'whisper-large-v3-turbo';

export function SetupOverviewStep() {
  const { goNext } = useOnboarding();
  const [isMac, setIsMac] = useState(false);
  const [showGroq, setShowGroq] = useState(false);
  const [groqApiKey, setGroqApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch (e) {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };
    checkPlatform();
  }, []);

  const steps = [
    {
      number: 1,
      type: 'transcription',
      title: 'Baixar mecanismo de transcrição',
    },
    {
      number: 2,
      type: 'summarization',
      title: 'Baixar mecanismo de resumo',
    },
  ];

  const handleContinue = () => {
    goNext();
  };

  // Choose Groq cloud transcription - no local model download needed
  const handleUseGroq = async () => {
    const key = groqApiKey.trim();
    if (!key) {
      toast.error('Informe sua chave de API do Groq', {
        description: 'Crie uma chave gratuita em console.groq.com.',
      });
      return;
    }

    setIsSaving(true);
    try {
      await invoke('api_save_transcript_config', {
        provider: 'groq',
        model: GROQ_MODEL,
        apiKey: key,
      });
      toast.success('Groq configurado!', {
        description: 'A transcrição será feita na nuvem, sem download de modelo.',
      });
      goNext();
    } catch (error) {
      console.error('[SetupOverviewStep] Failed to save Groq config:', error);
      toast.error('Falha ao salvar a configuração do Groq', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <OnboardingContainer
      title="Visão geral da configuração"
      description="O ReunIA requer que você baixe os modelos de IA de Transcrição e Resumo para o software funcionar."
      step={2}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="flex flex-col items-center space-y-10">
        {/* Steps Card */}
        <div className="w-full max-w-md bg-white rounded-lg border border-gray-200 p-4">
          <div className="space-y-4">
            {steps.map((step, idx) => {
              return (
                <div
                  key={step.number}
                  className={`flex items-start gap-4 p-1`}
                >
                  <div className="flex-1 ml-1">
                    <h3 className="font-medium text-gray-900 flex items-center gap-2">
                        Etapa {step.number} :  {step.title}

                        {step.type === "summarization" && (
                            <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                <button className="text-gray-400 hover:text-gray-600">
                                    <Info className="w-4 h-4" />
                                </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-sm">
                                Você também pode selecionar provedores externos de IA, como OpenAI, Claude ou
                                Ollama, para gerar resumos nas configurações.
                                </TooltipContent>
                            </Tooltip>
                            </TooltipProvider>
                        )}
                        </h3>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Groq cloud option - skip transcription download */}
        <div className="w-full max-w-md bg-ambiental-blue-soft/60 rounded-xl border border-ambiental-blue-soft p-4">
          {!showGroq ? (
            <button
              onClick={() => setShowGroq(true)}
              className="w-full flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
            >
              <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                <Cloud className="w-5 h-5 text-ambiental-blue" />
              </div>
              <div>
                <p className="text-sm font-medium text-ambiental-text">
                  Prefere não baixar? Use o Groq na nuvem
                </p>
                <p className="text-xs font-light text-ambiental-gray-mid mt-0.5">
                  Transcrição via Groq Whisper — sem download de modelo local
                </p>
              </div>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                  <Cloud className="w-5 h-5 text-ambiental-blue" />
                </div>
                <div>
                  <p className="text-sm font-medium text-ambiental-text">
                    Groq Whisper (nuvem)
                  </p>
                  <p className="text-xs font-light text-ambiental-gray-mid mt-0.5">
                    O áudio da reunião é enviado à API do Groq para transcrição
                  </p>
                </div>
              </div>

              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={groqApiKey}
                  onChange={(e) => setGroqApiKey(e.target.value)}
                  placeholder="Cole sua chave de API do Groq (gsk_...)"
                  className="pr-10 bg-white focus:ring-1 focus:ring-ambiental-blue focus:border-ambiental-blue"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  title={showApiKey ? 'Ocultar chave' : 'Mostrar chave'}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleUseGroq}
                  disabled={isSaving}
                  className="flex-1 h-10 bg-ambiental-blue hover:bg-ambiental-blue-dark text-white"
                >
                  {isSaving ? 'Salvando...' : 'Usar Groq na nuvem'}
                </Button>
                <Button
                  onClick={() => setShowGroq(false)}
                  variant="ghost"
                  className="h-10 text-ambiental-gray-mid hover:text-ambiental-text"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* CTA Section */}
        <div className="w-full max-w-xs space-y-4">
          <Button
            onClick={handleContinue}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white"
          >
            Vamos lá
          </Button>
          <div className="text-center">
            <a
              href="https://github.com/Zackriya-Solutions/meeting-minutes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-600 hover:underline"
            >
              Relatar problemas no GitHub
            </a>
          </div>
        </div>
      </div>
    </OnboardingContainer>
  );
}
