import { getGroqClient, withRetry, resetGroqClient } from './groqClient';
import { getConfigStore } from '../store/configStore';

/**
 * WhisperService handles audio transcription via Groq's Whisper API.
 * 
 * Receives WAV buffers from the ChunkManager, sends them to the Groq API
 * using the configured Whisper model, and returns the transcribed text.
 * 
 * The service maintains a "current transcript" which accumulates all
 * transcribed segments in order, used for final note generation.
 */
export class WhisperService {
  private currentTranscript: string = '';

  /**
   * Transcribe a WAV audio buffer using Groq Whisper API.
   * 
   * @param wavBuffer - Complete WAV file buffer (header + PCM data)
   * @param speaker - Source identifier ('mic' or 'system')
   * @returns Transcribed text, or empty string on failure
   */
  async transcribe(wavBuffer: Buffer, speaker: 'mic' | 'system'): Promise<string> {
    try {
      const client = getGroqClient();
      const store = getConfigStore();
      const model = store.get('whisperModel');

      // Create a File-like object from the WAV buffer
      // Convert Buffer to Uint8Array for Blob compatibility
      const uint8 = new Uint8Array(wavBuffer);
      const blob = new Blob([uint8], { type: 'audio/wav' });
      const file = new File([blob], `audio-${speaker}-${Date.now()}.wav`, {
        type: 'audio/wav',
      });

      const transcription = await withRetry(async () => {
        return client.audio.transcriptions.create({
          file,
          model,
          language: 'pt',
          response_format: 'json',
          temperature: 0.0,
        });
      });

      const text = transcription.text?.trim() || '';

      if (text) {
        this.currentTranscript += (this.currentTranscript ? ' ' : '') + text;
      }

      return text;
    } catch (err: any) {
      // If invalid API key, reset client so next call re-initializes
      if (err.message?.includes('API key') || err.status === 401) {
        resetGroqClient();
      }
      console.error(`[WhisperService] Transcription failed for ${speaker}:`, err.message);
      return '';
    }
  }

  /**
   * Get the full accumulated transcript.
   */
  getFullTranscript(): string {
    return this.currentTranscript;
  }

  /**
   * Reset the accumulated transcript.
   */
  resetTranscript(): void {
    this.currentTranscript = '';
  }
}
