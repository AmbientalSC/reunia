/**
 * AudioLevelMonitor — Monitor de níveis de áudio em tempo real.
 * 
 * Armazena os últimos valores RMS do microfone e do áudio do sistema
 * para que o FloatWidget possa exibir uma waveform realista.
 * 
 * Uso:
 *   AudioLevelMonitor.pushMicLevel(0.042)
 *   const bars = AudioLevelMonitor.getMicBars(5) // [0.1, 0.3, 0.8, 0.4, 0.1]
 */

const WINDOW_SIZE = 30; // Quantos frames de histórico manter
const SMOOTHING = 0.4;  // Fator de suavização (0-1, menor = mais suave)

class AudioLevelMonitorClass {
  private micLevels: number[] = [];
  private systemLevels: number[] = [];
  private smoothedMic: number = 0;
  private smoothedSystem: number = 0;

  /**
   * Adiciona um valor RMS do microfone.
   */
  pushMicLevel(rms: number): void {
    this.smoothedMic = this.smoothedMic * SMOOTHING + rms * (1 - SMOOTHING);
    this.micLevels.push(this.smoothedMic);
    if (this.micLevels.length > WINDOW_SIZE) {
      this.micLevels.shift();
    }
  }

  /**
   * Adiciona um valor RMS do áudio do sistema.
   */
  pushSystemLevel(rms: number): void {
    this.smoothedSystem = this.smoothedSystem * SMOOTHING + rms * (1 - SMOOTHING);
    this.systemLevels.push(this.smoothedSystem);
    if (this.systemLevels.length > WINDOW_SIZE) {
      this.systemLevels.shift();
    }
  }

  /**
   * Retorna N valores para as barras de waveform do microfone.
   * Os valores são normalizados entre 0 e 1.
   */
  getMicBars(count: number): number[] {
    return this.getBars(this.micLevels, count);
  }

  /**
   * Retorna N valores para as barras de waveform do áudio do sistema.
   */
  getSystemBars(count: number): number[] {
    return this.getBars(this.systemLevels, count);
  }

  /**
   * Nível atual do microfone (suavizado), 0-1.
   */
  get micLevel(): number {
    return Math.min(1, this.smoothedMic * 3); // Amplificado visualmente
  }

  /**
   * Nível atual do áudio do sistema (suavizado), 0-1.
   */
  get systemLevel(): number {
    return Math.min(1, this.smoothedSystem * 3);
  }

  /**
   * Se há algum áudio ativo no momento.
   */
  get isActive(): boolean {
    return this.micLevel > 0.05 || this.systemLevel > 0.05;
  }

  /**
   * Reseta todos os níveis.
   */
  reset(): void {
    this.micLevels = [];
    this.systemLevels = [];
    this.smoothedMic = 0;
    this.smoothedSystem = 0;
  }

  private getBars(levels: number[], count: number): number[] {
    if (levels.length === 0) {
      return new Array(count).fill(0.05);
    }

    // Amostra o histórico em 'count' pontos
    const bars: number[] = [];
    const step = Math.max(1, Math.floor(levels.length / count));

    for (let i = 0; i < count; i++) {
      const idx = Math.min(levels.length - 1, i * step);
      const raw = levels[idx] || 0;
      // Normaliza com amplificação não-linear para visualização
      const normalized = Math.min(1, Math.pow(raw * 5, 0.7));
      bars.push(normalized);
    }

    return bars;
  }
}

// Singleton compartilhado entre hooks e componentes
export const AudioLevelMonitor = new AudioLevelMonitorClass();
