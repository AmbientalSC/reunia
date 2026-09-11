'use client';

import { Mic, AudioWaveform, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * EmptyTranscriptState
 *
 * Hero visual exibido quando não há transcrições. Segue a identidade
 * Ambiental (azul institucional + verde lima, Poppins) com hierarquia
 * clara e passos rápidos para guiar o usuário.
 */
interface EmptyTranscriptStateProps {
  isRecording: boolean;
  isPaused: boolean;
}

const steps = [
  {
    icon: Mic,
    title: 'Conecte o microfone',
    description: 'Garanta as permissões de áudio',
    color: 'bg-ambiental-blue-soft text-ambiental-blue',
  },
  {
    icon: AudioWaveform,
    title: 'Inicie a gravação',
    description: 'Clique no botão vermelho abaixo',
    color: 'bg-red-50 text-red-500',
  },
  {
    icon: FileText,
    title: 'Veja a transcrição',
    description: 'O texto aparece em tempo real',
    color: 'bg-green-50 text-green-600',
  },
];

export function EmptyTranscriptState({ isRecording, isPaused }: EmptyTranscriptStateProps) {
  if (isRecording) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center text-center mt-24 px-6"
      >
        <div className="relative mb-6">
          <div className="w-16 h-16 rounded-full bg-ambiental-blue-soft flex items-center justify-center">
            <div
              className={`w-3.5 h-3.5 rounded-full ${isPaused ? 'bg-orange-500' : 'bg-ambiental-blue animate-pulse'}`}
            />
          </div>
          <span className="absolute inset-0 rounded-full border-2 border-ambiental-blue-soft animate-ping opacity-60" />
        </div>
        <p className="text-xl font-semibold text-ambiental-text">
          {isPaused ? 'Gravação pausada' : 'Ouvindo fala...'}
        </p>
        <p className="text-sm font-light text-ambiental-gray-mid mt-2">
          {isPaused
            ? 'Clique em Retomar para continuar a gravação'
            : 'Fale para ver a transcrição ao vivo'}
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="flex flex-col items-center text-center mt-20 px-6"
    >
      {/* Monograma */}
      <div className="relative mb-7">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-ambiental-blue to-ambiental-blue-dark flex items-center justify-center shadow-lg shadow-ambiental-blue/20">
          <Mic className="w-9 h-9 text-white" strokeWidth={1.75} />
        </div>
        <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-ambiental-green flex items-center justify-center border-[3px] border-white">
          <div className="w-2 h-2 rounded-full bg-white" />
        </div>
      </div>

      {/* Título e subtítulo */}
      <h2 className="text-2xl font-semibold text-ambiental-text tracking-tight">
        Boas-vindas ao ReunIA!
      </h2>
      <p className="text-sm font-light text-ambiental-gray-mid mt-2 max-w-sm leading-relaxed">
        Inicie a gravação para ver a transcrição ao vivo da sua reunião
      </p>

      {/* Passos rápidos */}
      <div className="grid grid-cols-3 gap-3 mt-10 w-full max-w-xl">
        {steps.map((step, index) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 + index * 0.08 }}
            className="flex flex-col items-center gap-2.5 rounded-xl border border-gray-100 bg-white px-4 py-5 shadow-sm hover:shadow-md hover:border-ambiental-blue-hover transition-all duration-200"
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${step.color}`}>
              <step.icon className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xs font-medium text-ambiental-text">{step.title}</p>
              <p className="text-[11px] font-light text-ambiental-gray-mid mt-0.5 leading-snug">
                {step.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
