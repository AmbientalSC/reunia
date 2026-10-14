/**
 * Lista e pré-seleção de modelos de transcrição usadas nos diálogos de importar áudio e
 * retranscrever. A pré-seleção deve sempre refletir o modelo salvo em Configurações > Transcrição.
 */

export type ModelProvider = 'whisper' | 'parakeet' | 'groq';

export interface ModelOption {
  provider: ModelProvider;
  name: string;
  displayName: string;
  size_mb: number;
}

export interface TranscriptModelConfig {
  provider?: string;
  model?: string;
}

const GROQ_DEFAULT_MODELS: readonly string[] = ['whisper-large-v3-turbo', 'whisper-large-v3'];

export function modelKey(model: Pick<ModelOption, 'provider' | 'name'>): string {
  return `${model.provider}:${model.name}`;
}

/**
 * Modelos Groq a listar: os padrão mais o configurado, caso seja um modelo Groq fora da lista
 * (assim a pré-seleção nunca deixa de achar o modelo salvo).
 */
export function buildGroqModelOptions(config: TranscriptModelConfig | undefined): ModelOption[] {
  const configuredModel = config?.provider === 'groq' ? config.model?.trim() : undefined;
  const names =
    configuredModel && !GROQ_DEFAULT_MODELS.includes(configuredModel)
      ? [configuredModel, ...GROQ_DEFAULT_MODELS]
      : [...GROQ_DEFAULT_MODELS];

  return names.map((name) => ({
    provider: 'groq' as const,
    name,
    displayName: `☁️ Groq: ${name}`,
    size_mb: 0,
  }));
}

/** O provedor salvo nas configurações chama o Whisper local de 'localWhisper'; a lista usa 'whisper'. */
function toListProvider(configProvider: string | undefined): ModelProvider | null {
  switch (configProvider) {
    case 'localWhisper':
      return 'whisper';
    case 'parakeet':
    case 'groq':
      return configProvider;
    default:
      return null;
  }
}

export function findConfiguredModel(
  models: readonly ModelOption[],
  config: TranscriptModelConfig | undefined
): ModelOption | undefined {
  const provider = toListProvider(config?.provider);
  if (!provider) return undefined;

  return models.find((m) => m.provider === provider && m.name === config?.model);
}

/** Chave do modelo configurado; se ele não estiver disponível, a do primeiro da lista. */
export function pickDefaultModelKey(
  models: readonly ModelOption[],
  config: TranscriptModelConfig | undefined
): string {
  const selected = findConfiguredModel(models, config) ?? models[0];
  return selected ? modelKey(selected) : '';
}
