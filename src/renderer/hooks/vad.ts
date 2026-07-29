/**
 * Voice Activity Detection (VAD) simples baseado em energia RMS.
 * 
 * Filtra chunks de áudio silenciosos antes de enviar para a API de transcrição,
 * economizando requisições e evitando transcrições de ruído de fundo.
 */

// Threshold de RMS para considerar como "voz ativa"
// Valores típicos: 0.005 (sensível) a 0.02 (menos sensível)
const RMS_THRESHOLD = 0.008;

// Quantos frames consecutivos abaixo do threshold para considerar "silêncio"
const SILENCE_FRAMES_THRESHOLD = 3;

/**
 * Calcula o RMS (Root Mean Square) de um buffer Float32.
 * O RMS indica a energia do sinal de áudio.
 */
export function calculateRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Verifica se um frame de áudio contém voz (acima do threshold de energia).
 * @param samples - Array Float32 com as amostras de áudio
 * @returns true se detectar atividade de voz
 */
export function isVoiceActive(samples: Float32Array): boolean {
  const rms = calculateRms(samples);
  return rms >= RMS_THRESHOLD;
}

/**
 * Estado do VAD para tracking de silêncio consecutivo.
 */
export class VADState {
  private silenceFrameCount = 0;
  private consecutiveSilence = 0;

  /**
   * Processa um frame de áudio e retorna se há voz ativa.
   * Usa histerese para evitar flickering (só considera "silêncio"
   * após N frames consecutivos abaixo do threshold).
   */
  processFrame(samples: Float32Array): boolean {
    const active = isVoiceActive(samples);

    if (active) {
      this.consecutiveSilence = 0;
      this.silenceFrameCount++;
      return true;
    } else {
      this.consecutiveSilence++;
      this.silenceFrameCount = 0;
      return this.consecutiveSilence <= SILENCE_FRAMES_THRESHOLD;
    }
  }

  /**
   * Reseta o estado do VAD.
   */
  reset(): void {
    this.silenceFrameCount = 0;
    this.consecutiveSilence = 0;
  }

  /**
   * Retorna a quantidade de frames com voz detectada desde o último reset.
   */
  get voiceFrameCount(): number {
    return this.silenceFrameCount;
  }
}
