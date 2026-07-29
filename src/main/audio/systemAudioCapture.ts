import { spawn, ChildProcess } from 'child_process';
import { getConfigStore } from '../store/configStore';

export type AudioDataCallback = (base64Chunk: string) => void;

/**
 * SystemAudioCapture — Captura o áudio do sistema (loopback WASAPI)
 * usando ffmpeg via child_process.
 * 
 * No Windows, o ffmpeg acessa o dispositivo de áudio WASAPI para capturar
 * todo o som que está saindo do computador (YouTube, Teams, Zoom, etc.).
 * 
 * Fluxo:
 *   ffmpeg → PCM s16le 24kHz mono → stdout → Base64 → callback → ChunkManager
 */
export class SystemAudioCapture {
  private process: ChildProcess | null = null;
  private onData: AudioDataCallback | null = null;
  private isRunning = false;

  /**
   * Define o callback que receberá chunks de áudio em Base64.
   */
  onAudioData(callback: AudioDataCallback): void {
    this.onData = callback;
  }

  /**
   * Inicia a captura do áudio do sistema.
   * Tenta dshow primeiro (padrão Windows), depois wasapi.
   */
  async start(): Promise<boolean> {
    if (this.isRunning) return true;

    const ffmpegPath = this.findFfmpeg();
    if (!ffmpegPath) {
      console.warn('[SystemAudioCapture] ffmpeg not found.');
      return false;
    }

    const device = this.getWasapiDevice();
    const devices = [device, 'Stereo Mix'].filter(Boolean);
    console.log(`[SystemAudioCapture] Trying: ${devices.join(', ')}`);

    // Tenta cada combinação formato+dispositivo até uma funcionar
    const formats = ['dshow', 'wasapi'];
    for (const fmt of formats) {
      for (const dev of devices) {
        const ok = await this.spawnFfmpeg(ffmpegPath, fmt, dev);
        if (ok) {
          console.log(`[SystemAudioCapture] ✅ Started -f ${fmt}:"${dev}"`);
          return true;
        }
      }
    }

    console.error('[SystemAudioCapture] All formats failed.');
    this.isRunning = false;
    return false;
  }

  private async spawnFfmpeg(ffmpegPath: string, format: string, device: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const proc = spawn(ffmpegPath, [
          '-f', format,
          '-i', `audio=${device}`,
          '-f', 's16le', '-ac', '1', '-ar', '24000',
          '-loglevel', 'error',
          'pipe:1',
        ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

        this.process = proc;
        this.isRunning = true;
        let buffer = Buffer.alloc(0);
        const CHUNK = 4096 * 2;

        proc.stdout?.on('data', (data: Buffer) => {
          buffer = Buffer.concat([buffer, data]);
          while (buffer.length >= CHUNK) {
            const chunk = buffer.subarray(0, CHUNK);
            buffer = buffer.subarray(CHUNK);
            this.onData?.(chunk.toString('base64'));
          }
        });

        proc.stderr?.on('data', (d: Buffer) => {
          const m = d.toString().trim();
          if (m) console.warn(`[ffmpeg ${format}]`, m);
        });

        proc.on('error', () => { this.isRunning = false; resolve(false); });
        proc.on('exit', () => { if (this.process === proc) { this.process = null; this.isRunning = false; } });

        setTimeout(() => {
          resolve(proc.exitCode === null && !proc.killed);
        }, 1000);
      } catch { resolve(false); }
    });
  }

  /**
   * Para a captura.
   */
  stop(): void {
    this.isRunning = false;

    if (this.process) {
      try {
        this.process.kill('SIGTERM');
        // No Windows, SIGTERM pode não funcionar; força o kill após 1s
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
        }, 1000);
      } catch {
        // Ignora erros ao matar o processo
      }
      this.process = null;
    }
  }

  /**
   * Estado atual.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Procura pelo ffmpeg no PATH do sistema ou em locais comuns.
   */
  private findFfmpeg(): string | null {
    // Locais comuns onde o ffmpeg pode estar
    const candidates = [
      'ffmpeg',                    // No PATH
      'ffmpeg.exe',                // No PATH (Windows)
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      process.env.FFMPEG_PATH || '',
    ].filter(Boolean);

    // Na prática, confiamos no PATH. Se não estiver lá, retornamos null.
    // O usuário pode instalar via: winget install ffmpeg
    return candidates[0] || null;
  }

  /**
   * Obtém o nome do dispositivo WASAPI para loopback.
   * Pode ser configurado pelo usuário nas Settings.
   */
  private getWasapiDevice(): string {
    const store = getConfigStore();
    const configured = store.get('wasapiDevice' as any) as string | undefined;
    if (configured) return configured;

    // Default: Stereo Mix (loopback nativo do Windows)
    return 'Stereo Mix';
  }

  /**
   * Lista TODOS os nomes possíveis para o dispositivo loopback do Windows.
   * Inclui variantes por idioma e marca de placa de som.
   */
  static getKnownLoopbackDevices(): string[] {
    return [
      'Stereo Mix',
      'Mixagem estéreo',        // Windows em português
      'Stereo-Mix',
      'What U Hear',            // Creative Sound Blaster
      'Wave Out Mix',           // Algumas placas Realtek
      'Loopback Mix',
      'Rec. Playback',
      'Sum',
    ];
  }

  /**
   * Lista os dispositivos WASAPI disponíveis usando ffmpeg.
   * Útil para mostrar nas Settings para o usuário escolher.
   */
  static async listDevices(): Promise<string[]> {
    const ffmpegPath = 'ffmpeg'; // Assume no PATH
    try {
      const { execSync } = require('child_process');
      const output = execSync(
        `${ffmpegPath} -list_devices true -f wasapi -i dummy -hide_banner 2>&1`,
        { timeout: 5000, windowsHide: true }
      ).toString();

      // Parse a saída para extrair os nomes dos dispositivos
      const devices: string[] = [];
      const lines = output.split('\n');
      let captureSection = false;

      for (const line of lines) {
        if (line.includes('DirectShow audio devices')) {
          captureSection = true;
          continue;
        }
        if (captureSection) {
          // Formato: `    "Nome do Dispositivo"` ou `    "Nome"`
          const match = line.match(/"([^"]+)"/);
          if (match) {
            devices.push(match[1]);
          }
          if (line.trim().startsWith('"') === false && line.trim() !== '') {
            captureSection = false;
          }
        }
      }

      return devices;
    } catch {
      return [];
    }
  }
}
