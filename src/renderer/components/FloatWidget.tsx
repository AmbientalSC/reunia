import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranscription, TranscriptionSegment } from '../hooks/useTranscription';
import { useInsights } from '../hooks/useInsights';
import { AudioLevelMonitor } from '../hooks/audioLevelMonitor';
import LiveSummary from './LiveSummary';
import InsightPanel from './InsightPanel';

type MeetingState = 'idle' | 'recording' | 'paused';

const WIDGET_HEIGHT_NORMAL = 64;
const WIDGET_WIDTH_NORMAL = 340;
const WIDGET_WIDTH_SUMMARY = 420;
const WIDGET_HEIGHT_SUMMARY = 380;
const WIDGET_WIDTH_PANEL = 760;
const WIDGET_HEIGHT_PANEL = 560;
const SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;

/**
 * FloatWidget — Widget flutuante sempre visível (always-on-top)
 * Agora com captura de áudio DIRETA (sem hooks complexos).
 */
const FloatWidget: React.FC = () => {
  const [meetingState, setMeetingState] = useState<MeetingState>('idle');
  const [showPanel, setShowPanel] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [audioBars, setAudioBars] = useState<number[]>([0.05, 0.05, 0.05, 0.05, 0.05]);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const animFrameRef = useRef<number>(0);
  const saveNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { segments, latestSegment } = useTranscription();
  const { insights } = useInsights();

  // Refs para captura de áudio direta (SEM hook complexo)
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const systemCtxRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const systemProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const captureStartedRef = useRef(false);

  // --- Funções de captura de áudio DIRETAS ---

  const stopAudioCapture = () => {
    console.log('[FloatWidget] Stopping audio capture');
    captureStartedRef.current = false;

    if (micProcessorRef.current) {
      micProcessorRef.current.disconnect();
      micProcessorRef.current = null;
    }
    if (systemProcessorRef.current) {
      systemProcessorRef.current.disconnect();
      systemProcessorRef.current = null;
    }
    if (micCtxRef.current) {
      micCtxRef.current.close();
      micCtxRef.current = null;
    }
    if (systemCtxRef.current) {
      systemCtxRef.current.close();
      systemCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach(t => t.stop());
      systemStreamRef.current = null;
    }
    AudioLevelMonitor.reset();
  };

  const startAudioCapture = async () => {
    if (captureStartedRef.current) return;
    captureStartedRef.current = true;

    try {
      setCaptureError(null);

      // Lê os dispositivos/fontes selecionados
      let micDeviceId = 'default';
      let captureSystemAudio = true;
      try {
        micDeviceId = await (window as any).electronAPI?.getConfig('selectedMicDevice') || 'default';
        captureSystemAudio =
          (await (window as any).electronAPI?.getConfig('captureSystemAudio')) !== false;
      } catch {}

      console.log(`[FloatWidget] 🎤 Starting microphone capture (device: ${micDeviceId})`);

      // Constraints para getUserMedia
      const constraints: MediaTrackConstraints = {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (micDeviceId && micDeviceId !== 'default') {
        constraints.deviceId = { exact: micDeviceId };
      }

      // Captura o microfone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
        video: false,
      });

      console.log(`[FloatWidget] ✅ Mic captured! Track: "${stream.getAudioTracks()[0]?.label}"`);
      micStreamRef.current = stream;

      // AudioContext + ScriptProcessor
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      micCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      source.connect(processor);
      // ScriptProcessor só é processado quando participa de um grafo ligado à saída.
      // Um GainNode mutado mantém o grafo ativo sem reproduzir o microfone.
      const mutedOutput = ctx.createGain();
      mutedOutput.gain.value = 0;
      processor.connect(mutedOutput);
      mutedOutput.connect(ctx.destination);

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);

        // RMS para visualização
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
        const rms = Math.sqrt(sum / inputData.length);
        AudioLevelMonitor.pushMicLevel(rms);

        // Converte para Int16 e envia via IPC
        const int16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(int16.buffer);
        let base64 = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          base64 += String.fromCharCode(bytes[i]);
        }
        base64 = btoa(base64);

        (window as any).electronAPI?.sendMicChunk(base64);
      };

      micProcessorRef.current = processor;

      // Captura o áudio reproduzido pelo Windows via loopback nativo do Electron.
      if (captureSystemAudio) {
        try {
          const systemStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
          systemStream.getVideoTracks().forEach((track) => track.stop());

          if (systemStream.getAudioTracks().length === 0) {
            systemStream.getTracks().forEach((track) => track.stop());
            throw new Error('O Electron não retornou uma faixa de áudio do sistema.');
          }

          systemStreamRef.current = systemStream;
          const systemCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
          systemCtxRef.current = systemCtx;
          const systemSource = systemCtx.createMediaStreamSource(systemStream);
          const systemProcessor = systemCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
          const mutedSystemOutput = systemCtx.createGain();
          mutedSystemOutput.gain.value = 0;

          systemSource.connect(systemProcessor);
          systemProcessor.connect(mutedSystemOutput);
          mutedSystemOutput.connect(systemCtx.destination);

          systemProcessor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
            AudioLevelMonitor.pushSystemLevel(Math.sqrt(sum / inputData.length));

            const int16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const sample = Math.max(-1, Math.min(1, inputData[i]));
              int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }

            const bytes = new Uint8Array(int16.buffer);
            let base64 = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              base64 += String.fromCharCode(bytes[i]);
            }
            (window as any).electronAPI?.sendSystemChunk(btoa(base64));
          };

          systemProcessorRef.current = systemProcessor;
          console.log(
            `[FloatWidget] ✅ System audio captured: "${systemStream.getAudioTracks()[0]?.label}"`
          );
        } catch (systemErr: any) {
          const message = systemErr?.message || 'Áudio do sistema indisponível';
          console.warn('[FloatWidget] System audio capture failed:', message);
          setCaptureError(`Microfone ativo, mas o áudio do sistema falhou: ${message}`);
        }
      }

      console.log('[FloatWidget] ✅ Audio capture fully started');
      return true;

    } catch (err: any) {
      console.error('[FloatWidget] ❌ Audio capture failed:', err.message);
      setCaptureError(err.message || 'Erro ao capturar áudio');
      stopAudioCapture();
      throw err;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioCapture();
      if (saveNoticeTimerRef.current) clearTimeout(saveNoticeTimerRef.current);
    };
  }, []);

  // Listen for meeting state changes from main process (tray menu, etc.)
  useEffect(() => {
    const cleanup = (window as any).electronAPI?.onMeetingStateChanged(
      (state: string) => {
        setMeetingState(state as MeetingState);
        if (state === 'recording' && !captureStartedRef.current) {
          startAudioCapture().catch((err) => {
            console.error('[FloatWidget] Capture requested externally failed:', err);
          });
        } else if (state === 'idle') {
          stopAudioCapture();
        }
      }
    );
    // Get initial state
    (window as any).electronAPI?.getMeetingState().then((state: string) => {
      setMeetingState(state as MeetingState);
    });
    return () => { if (cleanup) cleanup(); };
  }, []);

  // Auto-show summary when insights arrive during recording
  useEffect(() => {
    if (
      meetingState === 'recording' &&
      insights &&
      (insights.topics?.length > 0 || insights.actionItems?.length > 0) &&
      !showSummary
    ) {
      setShowSummary(true);
      requestWindowResize(true, showPanel);
    }
  }, [insights, meetingState, showPanel]);

  // Realistic waveform animation loop — runs only during recording
  useEffect(() => {
    if (meetingState !== 'recording') {
      // When idle, fade bars to flat
      setAudioBars([0.05, 0.05, 0.05, 0.05, 0.05]);
      return;
    }

    let running = true;

    const animate = () => {
      if (!running) return;

      // Read current audio levels and convert to bar heights
      const micBars = AudioLevelMonitor.getMicBars(5);
      const sysBars = AudioLevelMonitor.getSystemBars(5);

      // Combine sources — pick the highest value per bar
      const combined = micBars.map((val, i) => {
        const sysVal = sysBars[i] || 0;
        // Use max of mic and system, with a minimum floor for idle bars
        return Math.max(val, sysVal, 0.04);
      });

      setAudioBars(combined);
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [meetingState]);

  // Request window resize from main process
  const requestWindowResize = useCallback((summaryVisible: boolean, panelVisible = false) => {
    const width = panelVisible
      ? WIDGET_WIDTH_PANEL
      : summaryVisible
      ? WIDGET_WIDTH_SUMMARY
      : WIDGET_WIDTH_NORMAL;
    const height = panelVisible
      ? WIDGET_HEIGHT_PANEL
      : summaryVisible
      ? WIDGET_HEIGHT_SUMMARY
      : WIDGET_HEIGHT_NORMAL;

    (window as any).electronAPI?.resizeFloatWindow(width, height);
  }, []);

  const toggleSummary = useCallback(() => {
    const newVal = !showSummary;
    setShowSummary(newVal);
    requestWindowResize(newVal, showPanel);
  }, [showSummary, showPanel, requestWindowResize]);

  // When meeting ends, collapse summary
  useEffect(() => {
    if (meetingState === 'idle') {
      setShowSummary(false);
      requestWindowResize(false, showPanel);
    }
  }, [meetingState, showPanel, requestWindowResize]);

  // --- Control handlers ---


  const handleStart = useCallback(async () => {
    try {
      setSaveNotice(null);
      // Valida a fonte obrigatória antes de alterar a UI para "Gravando".
      await startAudioCapture();
      const result = await (window as any).electronAPI?.startMeeting();
      if (result?.success) {
        setMeetingState('recording');
      } else {
        stopAudioCapture();
        setCaptureError(result?.error || 'Não foi possível iniciar a reunião.');
      }
    } catch {
      setMeetingState('idle');
    }
  }, []);

  const handlePause = useCallback(async () => {
    const result = await (window as any).electronAPI?.pauseMeeting();
    if (result?.success) {
      setMeetingState('paused');
    }
  }, []);

  const handleResume = useCallback(async () => {
    const result = await (window as any).electronAPI?.resumeMeeting();
    if (result?.success) {
      setMeetingState('recording');
    }
  }, []);

  const handleStop = useCallback(async () => {
    const result = await (window as any).electronAPI?.stopMeeting();
    if (result?.success) {
      setMeetingState('idle');
      stopAudioCapture();
      if (result.notePath) {
        setCaptureError(null);
        setSaveNotice('Salvo no Obsidian');
        if (saveNoticeTimerRef.current) clearTimeout(saveNoticeTimerRef.current);
        saveNoticeTimerRef.current = setTimeout(() => setSaveNotice(null), 5000);
      } else if (result.noteError) {
        setCaptureError(`Não foi possível salvar no Obsidian: ${result.noteError}`);
      }
    }
  }, []);

  const togglePanel = useCallback(() => {
    const newVal = !showPanel;
    setShowPanel(newVal);
    requestWindowResize(showSummary, newVal);
  }, [showPanel, showSummary, requestWindowResize]);

  const closePanel = useCallback(() => {
    setShowPanel(false);
    requestWindowResize(showSummary, false);
  }, [showSummary, requestWindowResize]);

  // --- Status display ---
  const statusConfig = {
    idle: { label: 'Parado', color: '#6b7280', pulse: false },
    recording: { label: 'Gravando', color: '#22c55e', pulse: true },
    paused: { label: 'Pausado', color: '#eab308', pulse: false },
  };
  const status = saveNotice && meetingState === 'idle'
    ? { label: saveNotice, color: '#22c55e', pulse: false }
    : statusConfig[meetingState];
  const segmentCount = segments.length;
  const actionItemsCount = insights?.actionItems?.length || 0;

  return (
    <>
      {/* Main Widget Container */}
      <div className={`float-widget-container ${showSummary && !showPanel ? 'expanded' : ''}`}>
        {/* Live Summary Panel (appears above the bar) */}
        {showSummary && !showPanel && (
          <div className="float-summary-area">
            <LiveSummary
              insights={insights}
              segmentCount={segments.length}
              isVisible={showSummary}
            />
            <div className="summary-actions">
              <button
                className="ctrl-btn summary-toggle"
                onClick={toggleSummary}
                title="Recolher sumário"
                style={{ WebkitAppRegion: 'no-drag' } as any}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Main Widget Bar */}
        <div
          className="float-widget"
          style={{ WebkitAppRegion: 'drag' } as any}
        >
        {/* Status indicator */}
        <div className="widget-status">
          <div className={`status-dot ${status.pulse ? 'pulse' : ''}`} style={{ backgroundColor: status.color }} />
          <span className="status-label">{status.label}</span>
        </div>

        {/* Realistic waveform — driven by actual audio levels */}
        {meetingState === 'recording' && (
          <div className="waveform-container">
            {audioBars.map((level, i) => (
              <div
                key={i}
                className="waveform-bar"
                style={{
                  height: `${Math.max(4, level * 24)}px`,
                  transition: 'height 0.06s ease',
                }}
              />
            ))}
          </div>
        )}

        {/* Audio source indicators */}
        {meetingState === 'recording' && (
          <div className="source-indicators">
            <span className="source-dot mic active" title="Microfone ativo">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </span>
            <span className="source-dot system" title="Áudio do sistema ativo">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            </span>
          </div>
        )}

        {/* Controles permanecem montados para não sumirem durante o movimento do cursor. */}
        <div className="widget-controls" style={{ WebkitAppRegion: 'no-drag' } as any}>
            {meetingState === 'idle' && (
              <button className="ctrl-btn start" onClick={handleStart} title="Iniciar Reunião">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            )}
            {meetingState === 'recording' && (
              <>
                <button className="ctrl-btn pause" onClick={handlePause} title="Pausar">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                </button>
                <button className="ctrl-btn stop" onClick={handleStop} title="Parar Reunião">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 6h12v12H6z" />
                  </svg>
                </button>
              </>
            )}
            {meetingState === 'paused' && (
              <>
                <button className="ctrl-btn resume" onClick={handleResume} title="Retomar">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <button className="ctrl-btn stop" onClick={handleStop} title="Parar Reunião">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 6h12v12H6z" />
                  </svg>
                </button>
              </>
            )}
        </div>

        {/* Transcription snippet */}
        {latestSegment && meetingState !== 'idle' && (
          <div className="widget-transcript-snippet">
            <span className="snippet-text">{latestSegment.text.slice(0, 40)}...</span>
          </div>
        )}

        {/* Expand button */}
        <button
          className="ctrl-btn expand"
          onClick={togglePanel}
          title={showPanel ? 'Fechar Painel' : 'Abrir Painel de Insights'}
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            {showPanel ? (
              <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
            ) : (
              <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
            )}
          </svg>
        </button>

        {/* Badge counters */}
        {meetingState !== 'idle' && (
          <div className="widget-badges">
            {actionItemsCount > 0 && (
              <span className="badge badge-actions">{actionItemsCount}!</span>
            )}
            {/* Summary toggle — visible when there are topics */}
            {insights?.topics && insights.topics.length > 0 && (
              <button
                className={`ctrl-btn summary-indicator ${showSummary ? 'active' : ''}`}
                onClick={toggleSummary}
                title={showSummary ? 'Recolher sumário' : 'Mostrar sumário ao vivo'}
                style={{ WebkitAppRegion: 'no-drag' } as any}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>{/* closes float-widget */}

      {/* Capture error message */}
      {captureError && (
        <div className="widget-error">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          <span>{captureError}</span>
        </div>
      )}

      </div>{/* closes float-widget-container */}

      {/* Expandable Insight Panel */}
      {showPanel && (
        <InsightPanel
          fullScreen={false}
          onClose={closePanel}
          currentSegments={segments}
          currentInsights={insights}
        />
      )}
    </>
  );
};

export default FloatWidget;
