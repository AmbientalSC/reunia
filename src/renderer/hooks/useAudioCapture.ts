import { useState, useRef, useEffect, useCallback } from 'react';
import { VADState, calculateRms } from './vad';
import { AudioLevelMonitor } from './audioLevelMonitor';

interface AudioCaptureState {
  isCapturing: boolean;
  error: string | null;
  micStream: MediaStream | null;
  systemStream: MediaStream | null;
  captureSystemAudio: boolean;
  isMicActive: boolean;
  isSystemActive: boolean;
}

// Buffer size for ScriptProcessor (power of 2)
const BUFFER_SIZE = 4096;
const SAMPLE_RATE = 24000;

/**
 * Hook to manage microphone and system audio capture in the renderer.
 * 
 * - Microfone: sempre capturado (com VAD para filtrar silêncio)
 * - Áudio do sistema: capturado via getDisplayMedia, condicional (toggle nas settings)
 * - Conversão: Float32 PCM → Int16 PCM → Base64 → enviado via IPC
 * - VAD: filtra chunks silenciosos para economizar API
 */
export function useAudioCapture() {
  const [state, setState] = useState<AudioCaptureState>({
    isCapturing: false,
    error: null,
    micStream: null,
    systemStream: null,
    captureSystemAudio: true,
    isMicActive: false,
    isSystemActive: false,
  });

  // Refs para evitar stale closures nos callbacks do BackgroundWorker
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const sysCtxRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sysProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micVadRef = useRef<VADState>(new VADState());
  const sysVadRef = useRef<VADState>(new VADState());
  const isCapturingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      internalStopCapture();
    };
  }, []);

  const internalStopCapture = () => {
    isCapturingRef.current = false;

    // Disconnect processors
    if (micProcessorRef.current) {
      micProcessorRef.current.disconnect();
      micProcessorRef.current = null;
    }
    if (sysProcessorRef.current) {
      sysProcessorRef.current.disconnect();
      sysProcessorRef.current = null;
    }

    // Close audio contexts
    if (micCtxRef.current) {
      micCtxRef.current.close();
      micCtxRef.current = null;
    }
    if (sysCtxRef.current) {
      sysCtxRef.current.close();
      sysCtxRef.current = null;
    }

    // Stop mic tracks via ref (sempre o valor mais recente)
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    // Stop system tracks via ref
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((t) => t.stop());
      systemStreamRef.current = null;
    }

    // Reset audio level monitor
    AudioLevelMonitor.reset();
    micVadRef.current.reset();
    sysVadRef.current.reset();

    setState({
      isCapturing: false,
      error: null,
      micStream: null,
      systemStream: null,
      captureSystemAudio: false,
      isMicActive: false,
      isSystemActive: false,
    });
  };

  const startCapture = useCallback(async (captureSystem: boolean = true, micDeviceId?: string) => {
    try {
      // Construir constraints com dispositivo selecionado
      const micConstraints: MediaTrackConstraints = {
        sampleRate: 24000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      if (micDeviceId && micDeviceId !== 'default') {
        micConstraints.deviceId = { exact: micDeviceId };
      }

      // --- Microphone (sempre capturado) ---
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: micConstraints,
        video: false,
      });

      // --- System audio (opcional, depende da config) ---
      let systemStream: MediaStream | null = null;
      if (captureSystem) {
        try {
          if (typeof navigator.mediaDevices.getDisplayMedia === 'function') {
            console.log('[AudioCapture] Trying getDisplayMedia for system audio...');
            systemStream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true,
            });
          } else {
            console.warn('[AudioCapture] getDisplayMedia not available in this environment');
          }

          if (systemStream) {
            const audioTracks = systemStream.getAudioTracks();
            console.log(`[AudioCapture] System stream: ${audioTracks.length} audio tracks`);
            if (audioTracks.length > 0) {
              console.log(`[AudioCapture] Audio track: "${audioTracks[0].label}"`);
            } else {
              console.warn('[AudioCapture] No audio track in system stream!');
            }
            // Stop the video track — só precisamos do áudio
            systemStream.getVideoTracks().forEach((track) => track.stop());
          } else {
            console.warn('[AudioCapture] System audio not available');
          }
        } catch (sysErr: any) {
          console.warn('[AudioCapture] System audio not available:', sysErr?.message || sysErr);
          // Não fatal — continua só com microfone
        }
      }

      // --- Processamento de áudio ---
      const vad = new VADState();

      // Processador para microfone
      const micCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      micCtxRef.current = micCtx;
      const micProcessor = micCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      const micSource = micCtx.createMediaStreamSource(micStream);
      micSource.connect(micProcessor);
      micProcessor.connect(micCtx.destination);

      micVadRef.current.reset();

      micProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);

        // Atualiza o monitor de níveis de áudio (para waveform realista)
        const rms = calculateRms(inputData);
        AudioLevelMonitor.pushMicLevel(rms);

        // VAD: só envia se detectar voz
        const hasVoice = micVadRef.current.processFrame(inputData);
        setState((prev) => ({ ...prev, isMicActive: hasVoice }));

        if (hasVoice) {
          const int16Data = float32ToInt16(inputData);
          const base64 = arrayBufferToBase64(int16Data.buffer);
          (window as any).electronAPI?.sendMicChunk(base64);
        }
      };

      micProcessorRef.current = micProcessor;

      // Processador para áudio do sistema (se disponível)
      if (systemStream) {
        const sysCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
        sysCtxRef.current = sysCtx;
        const sysProcessor = sysCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
        const sysSource = sysCtx.createMediaStreamSource(systemStream);
        sysSource.connect(sysProcessor);
        sysProcessor.connect(sysCtx.destination);

        sysVadRef.current.reset();

        sysProcessor.onaudioprocess = (event) => {
          const inputData = event.inputBuffer.getChannelData(0);

          // Atualiza o monitor de níveis de áudio do sistema
          const rms = calculateRms(inputData);
          AudioLevelMonitor.pushSystemLevel(rms);

          // VAD: só envia se detectar voz
          const hasVoice = sysVadRef.current.processFrame(inputData);
          setState((prev) => ({ ...prev, isSystemActive: hasVoice }));

          if (hasVoice) {
            const int16Data = float32ToInt16(inputData);
            const base64 = arrayBufferToBase64(int16Data.buffer);
            (window as any).electronAPI?.sendSystemChunk(base64);
          }
        };

        sysProcessorRef.current = sysProcessor;
      }

      // Salva streams nas refs para acesso sem stale closure
      micStreamRef.current = micStream;
      systemStreamRef.current = systemStream;
      isCapturingRef.current = true;

      setState({
        isCapturing: true,
        error: null,
        micStream,
        systemStream,
        captureSystemAudio: captureSystem,
        isMicActive: false,
        isSystemActive: false,
      });

      return { micStream, systemStream };
    } catch (err: any) {
      const errorMsg =
        err.name === 'NotAllowedError'
          ? 'Permissão de microfone negada. Verifique as permissões do sistema.'
          : err.name === 'NotFoundError'
          ? 'Nenhum microfone encontrado.'
          : `Erro ao capturar áudio: ${err.message}`;

      setState((prev) => ({ ...prev, error: errorMsg }));
      throw err;
    }
  }, []);

  const stopCapture = useCallback(() => {
    internalStopCapture();
  }, []); // Função estável — usa refs internamente, nunca fica stale

  return {
    ...state,
    startCapture,
    stopCapture,
  };
}

// --- Audio conversion utilities ---

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
