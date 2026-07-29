import { getConfigStore } from '../store/configStore';

type SpeakerSource = 'mic' | 'system';

interface ChunkConfig {
  intervalMs: number;
  minAudioLengthMs: number;
}

// Callback type: provides WAV buffer for transcription
type TranscriptionCallback = (wavBuffer: Buffer, speaker: SpeakerSource) => void;

/**
 * Manages audio chunk buffering and dispatching.
 * 
 * Maintains separate buffers for microphone and system audio.
 * At each configured interval, converts the accumulated PCM data
 * to a WAV file and signals for transcription.
 */
export class ChunkManager {
  private micBuffer: string[] = [];
  private systemBuffer: string[] = [];
  private config: ChunkConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private isPaused: boolean = false;
  private onTranscriptionCallback: TranscriptionCallback | null = null;
  private lastProcessTime: number = 0;

  constructor() {
    const store = getConfigStore();
    const intervalSec = store.get('chunkIntervalSeconds');
    this.config = {
      intervalMs: intervalSec * 1000,
      minAudioLengthMs: 100, // 0.1s minimum audio to process
    };
  }

  /**
   * Set callback for transcription results.
   */
  onTranscription(callback: TranscriptionCallback): void {
    this.onTranscriptionCallback = callback;
  }

  /**
   * Start the chunk processing loop.
   * @param micSource Reference to shared mic buffer array
   * @param systemSource Reference to shared system buffer array
   */
  start(micSource: string[], systemSource: string[]): void {
    this.micBuffer = micSource;
    this.systemBuffer = systemSource;
    this.isPaused = false;
    this.lastProcessTime = Date.now();

    // Process immediately on start, then at intervals
    this.processChunks();

    this.intervalId = setInterval(() => {
      this.processChunks();
    }, this.config.intervalMs);

    console.log(`[ChunkManager] Started. Interval: ${this.config.intervalMs}ms`);
  }

  /**
   * Pause processing — keep accumulating but don't send to API.
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Resume processing — send accumulated chunks on next interval.
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * Stop the processing loop.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Process any remaining chunks before stopping
    if (this.micBuffer.length > 0 || this.systemBuffer.length > 0) {
      // Garante que o último trecho não seja descartado ao encerrar.
      this.isPaused = false;
      this.processChunks();
    }
    this.isPaused = true;
  }

  /**
   * Process accumulated chunks and fire transcription callback.
   */
  private processChunks(): void {
    if (this.isPaused) return;

    const now = Date.now();

    // Process microphone chunks
    if (this.micBuffer.length > 0) {
      const chunks = this.micBuffer.splice(0);
      const wavData = this.convertBase64ChunksToWav(chunks);
      if (wavData && this.onTranscriptionCallback) {
        this.onTranscriptionCallback(wavData, 'mic');
      }
    }

    // Process system audio chunks
    if (this.systemBuffer.length > 0) {
      const chunks = this.systemBuffer.splice(0);
      const wavData = this.convertBase64ChunksToWav(chunks);
      if (wavData && this.onTranscriptionCallback) {
        this.onTranscriptionCallback(wavData, 'system');
      }
    }

    this.lastProcessTime = now;
  }

  /**
   * Convert Base64-encoded PCM chunks into a WAV file buffer.
   * 
   * The renderer sends Base64-encoded Int16 PCM chunks at 24000 Hz,
   * mono. We concatenate them and wrap in a WAV container.
   */
  private convertBase64ChunksToWav(chunks: string[]): Buffer | null {
    if (chunks.length === 0) return null;

    try {
      // Decode all chunks from base64
      const pcmBuffers = chunks.map((chunk) => Buffer.from(chunk, 'base64'));
      const pcmData = Buffer.concat(pcmBuffers);

      // WAV header parameters
      const sampleRate = 24000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
      const blockAlign = numChannels * (bitsPerSample / 8);
      const dataSize = pcmData.length;

      // Build WAV header (44 bytes)
      const header = Buffer.alloc(44);

      // RIFF header
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + dataSize, 4); // File size - 8
      header.write('WAVE', 8);

      // fmt chunk
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16); // Subchunk1 size (PCM = 16)
      header.writeUInt16LE(1, 20);  // Audio format (1 = PCM)
      header.writeUInt16LE(numChannels, 22);
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(byteRate, 28);
      header.writeUInt16LE(blockAlign, 32);
      header.writeUInt16LE(bitsPerSample, 34);

      // data chunk
      header.write('data', 36);
      header.writeUInt32LE(dataSize, 40);

      return Buffer.concat([header, pcmData]);
    } catch (err) {
      console.error('[ChunkManager] Failed to convert chunks to WAV:', err);
      return null;
    }
  }
}
