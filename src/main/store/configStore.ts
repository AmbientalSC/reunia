import Store from 'electron-store';
import { safeStorage } from 'electron';

interface ReuniaConfig {
  groqApiKey: string;
  obsidianVaultPath: string;
  chunkIntervalSeconds: number;
  whisperModel: string;
  llmModel: string;
  captureSystemAudio: boolean;
  selectedMicDevice: string;
  wasapiDevice: string;
  ffmpegPath: string;
  floatWindowPosition: { x: number; y: number };
}

const schema = {
  groqApiKey: {
    type: 'string',
    default: '',
    description: 'API key do Groq Cloud para Whisper + LLM',
  },
  obsidianVaultPath: {
    type: 'string',
    default: '',
    description: 'Caminho absoluto para a pasta do Obsidian Vault',
  },
  chunkIntervalSeconds: {
    type: 'number',
    default: 5,
    minimum: 1,
    maximum: 15,
    description: 'Intervalo em segundos entre chunks de áudio enviados para transcrição',
  },
  whisperModel: {
    type: 'string',
    default: 'whisper-large-v3-turbo',
    description: 'Modelo Whisper a ser usado (whisper-large-v3 ou whisper-large-v3-turbo)',
  },
  llmModel: {
    type: 'string',
    default: 'llama-3.3-70b-versatile',
    description: 'Modelo LLM para análise de insights',
  },
  captureSystemAudio: {
    type: 'boolean',
    default: true,
    description: 'Capturar áudio do sistema (voz de outros participantes na reunião)',
  },
  selectedMicDevice: {
    type: 'string',
    default: 'default',
    description: 'ID do dispositivo de microfone selecionado (vazio = padrão do sistema)',
  },
  wasapiDevice: {
    type: 'string',
    default: 'Stereo Mix',
    description: 'Dispositivo de captura de áudio do sistema (ex: Stereo Mix, alto-falantes)',
  },
  ffmpegPath: {
    type: 'string',
    default: 'ffmpeg',
    description: 'Caminho do executável ffmpeg (padrão: ffmpeg no PATH)',
  },
  floatWindowPosition: {
    type: 'object',
    default: { x: 0, y: 0 },
    properties: {
      x: { type: 'number', default: 0 },
      y: { type: 'number', default: 0 },
    },
  },
} as const;

class ConfigStore {
  private store: Store<ReuniaConfig>;

  constructor() {
    // Store sem encryptionKey — o arquivo fica em JSON plano.
    // O campo groqApiKey é criptografado individualmente via safeStorage.
    this.store = new Store<ReuniaConfig>({
      schema,
      name: 'reunia-config',
      cwd: 'config',
    });
  }

  get<K extends keyof ReuniaConfig>(key: K): ReuniaConfig[K] {
    if (key === 'groqApiKey') {
      return this.getDecryptedApiKey() as ReuniaConfig[K];
    }
    return this.store.get(key);
  }

  set<K extends keyof ReuniaConfig>(key: K, value: ReuniaConfig[K]): void {
    if (key === 'groqApiKey') {
      this.setEncryptedApiKey(value as string);
    } else {
      this.store.set(key, value);
    }
  }

  get all(): ReuniaConfig {
    const raw = this.store.store as ReuniaConfig;
    return {
      ...raw,
      groqApiKey: this.getDecryptedApiKey(),
    };
  }

  /**
   * API Key criptografada via safeStorage (DPAPI no Windows).
   * O valor bruto é gravado como "groqApiKeyEncrypted" (base64).
   */
  private getDecryptedApiKey(): string {
    const encryptedB64 = (this.store as any).get('groqApiKeyEncrypted') as string | undefined;
    if (!encryptedB64) return '';

    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = Buffer.from(encryptedB64, 'base64');
        return safeStorage.decryptString(encrypted);
      }
    } catch {
      // Se falhar (ex: mudança de máquina), retorna vazio
      console.warn('[ConfigStore] Failed to decrypt API key, resetting.');
      (this.store as any).delete('groqApiKeyEncrypted');
    }

    return '';
  }

  private setEncryptedApiKey(plainKey: string): void {
    if (!plainKey) {
      (this.store as any).delete('groqApiKeyEncrypted');
      return;
    }

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plainKey);
      (this.store as any).set('groqApiKeyEncrypted', encrypted.toString('base64'));
    } else {
      // Fallback: armazena em texto plano (não ideal, mas funcional)
      console.warn('[ConfigStore] safeStorage not available, storing API key in plaintext.');
      (this.store as any).set('groqApiKeyEncrypted', plainKey);
    }
  }

  get hasApiKey(): boolean {
    return this.get('groqApiKey').length > 0;
  }

  get hasObsidianVault(): boolean {
    const path = this.get('obsidianVaultPath');
    return path.length > 0;
  }
}

// Singleton instance
let instance: ConfigStore | null = null;

export function getConfigStore(): ConfigStore {
  if (!instance) {
    instance = new ConfigStore();
  }
  return instance;
}
