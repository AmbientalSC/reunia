import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '@/contexts/AuthContext';
import {
  buildGroqModelOptions,
  pickDefaultModelKey,
  type ModelOption,
  type TranscriptModelConfig,
} from '@/lib/transcriptionModelSelection';

export type { ModelOption };

export interface RawModelInfo {
  name: string;
  size_mb: number;
  status: 'Available' | 'Missing' | { Downloading: { progress: number } } | { Error: string };
}

/**
 * Custom hook for fetching and managing transcription models (Whisper and Parakeet).
 *
 * This hook centralizes the model fetching logic that was previously duplicated
 * in ImportAudioDialog and RetranscribeDialog components.
 *
 * @param transcriptModelConfig - User's saved model configuration from context
 * @returns Object containing available models, selected model key, loading state, and fetch function
 */
export function useTranscriptionModels(transcriptModelConfig: TranscriptModelConfig | undefined) {
  // Perfis com chave Groq gerenciada: a chave vem do perfil (Firestore) e nunca chega ao webview,
  // então `api_get_transcript_api_key` volta vazio mesmo com o Groq pronto para uso.
  const { hasManagedGroqKey } = useAuth();
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const [loadingModels, setLoadingModels] = useState(false);
  // Track whether the user has manually changed the model selection
  const userSelectedRef = useRef(false);

  // Wrap setSelectedModelKey to track user-initiated changes
  const setSelectedModelKeyWithTracking = useCallback((key: string) => {
    userSelectedRef.current = true;
    setSelectedModelKey(key);
  }, []);

  const fetchModels = useCallback(async () => {
    setLoadingModels(true);
    const allModels: ModelOption[] = [];

    // Fetch Whisper models
    try {
      const whisperModels = await invoke<RawModelInfo[]>('whisper_get_available_models');
      const availableWhisper = whisperModels
        .filter((m) => m.status === 'Available')
        .map((m) => ({
          provider: 'whisper' as const,
          name: m.name,
          displayName: `🏠 Whisper: ${m.name}`,
          size_mb: m.size_mb,
        }));
      allModels.push(...availableWhisper);
    } catch (err) {
      console.error('Failed to fetch Whisper models:', err);
    }

    // Fetch Parakeet models
    try {
      const parakeetModels = await invoke<RawModelInfo[]>('parakeet_get_available_models');
      const availableParakeet = parakeetModels
        .filter((m) => m.status === 'Available')
        .map((m) => ({
          provider: 'parakeet' as const,
          name: m.name,
          displayName: `⚡ Parakeet: ${m.name}`,
          size_mb: m.size_mb,
        }));
      allModels.push(...availableParakeet);
    } catch (err) {
      console.error('Failed to fetch Parakeet models:', err);
    }

    // Add Groq Whisper cloud models (managed profile key or a locally saved API key)
    try {
      const hasGroqKey = hasManagedGroqKey || await hasLocalGroqKey();
      if (hasGroqKey) {
        allModels.push(...buildGroqModelOptions(transcriptModelConfig));
      }
    } catch (err) {
      console.error('Failed to fetch Groq transcription models:', err);
    }

    setAvailableModels(allModels);

    // Pre-select the model saved in Settings > Transcription (first available as fallback),
    // unless the user has already picked one manually
    if (!userSelectedRef.current) {
      const defaultKey = pickDefaultModelKey(allModels, transcriptModelConfig);
      if (defaultKey) {
        setSelectedModelKey(defaultKey);
      }
    }

    setLoadingModels(false);
  }, [transcriptModelConfig, hasManagedGroqKey]);

  // Reset user selection tracking (call when dialog opens fresh)
  const resetSelection = useCallback(() => {
    userSelectedRef.current = false;
  }, []);

  return {
    availableModels,
    selectedModelKey,
    setSelectedModelKey: setSelectedModelKeyWithTracking,
    loadingModels,
    fetchModels,
    resetSelection,
  };
}

async function hasLocalGroqKey(): Promise<boolean> {
  const groqApiKey = await invoke<string>('api_get_transcript_api_key', { provider: 'groq' });
  return Boolean(groqApiKey && groqApiKey.trim());
}
