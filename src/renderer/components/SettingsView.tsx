import React, { useState, useEffect, useRef } from 'react';
import { enumerateAudioDevices, AudioDeviceInfo } from '../hooks/audioDeviceManager';

interface Settings {
  groqApiKey: string;
  obsidianVaultPath: string;
  chunkIntervalSeconds: number;
  whisperModel: string;
  llmModel: string;
  captureSystemAudio: boolean;
  selectedMicDevice: string;
  wasapiDevice: string;
  ffmpegPath: string;
}

/**
 * SettingsView — Tela de configurações do Reunia.
 * 
 * Campos:
 * - Groq API Key (password, com teste de conexão)
 * - Obsidian Vault Path (com seletor de pasta nativo)
 * - Microfone: seletor de dispositivo + medidor de nível ao vivo
 * - Áudio do sistema: toggle + instruções
 * - Chunk interval slider (1-15s)
 * - Model selection (Whisper + LLM)
 */
const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({
    groqApiKey: '',
    obsidianVaultPath: '',
    chunkIntervalSeconds: 5,
    whisperModel: 'whisper-large-v3-turbo',
    llmModel: 'llama-3.3-70b-versatile',
    captureSystemAudio: true,
    selectedMicDevice: 'default',
    wasapiDevice: 'virtual-audio-capturer',
    ffmpegPath: 'ffmpeg',
  });

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Audio device state
  const [audioInputs, setAudioInputs] = useState<AudioDeviceInfo[]>([]);
  const [micTestLevel, setMicTestLevel] = useState(0);
  const [isMicTesting, setIsMicTesting] = useState(false);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestAnimRef = useRef<number>(0);
  const micTestCtxRef = useRef<AudioContext | null>(null);
  const micTestRunningRef = useRef(false);
  const micTestDeviceRef = useRef<string>('default'); // rastreia o device em teste

  // System audio test state
  const [sysTestLevel, setSysTestLevel] = useState(0);
  const [isSysTesting, setIsSysTesting] = useState(false);
  const sysTestStreamRef = useRef<MediaStream | null>(null);
  const sysTestAnimRef = useRef<number>(0);
  const sysTestCtxRef = useRef<AudioContext | null>(null);
  const sysTestRunningRef = useRef(false);

  // Load settings and enumerate devices on mount
  useEffect(() => {
    loadSettings();
    loadAudioDevices();
    return () => {
      stopMicTest();
      stopSysTest();
    };
  }, []);

  // Auto-restart mic test when device changes while testing
  const prevDeviceRef = useRef(settings.selectedMicDevice);
  useEffect(() => {
    if (!isMicTesting) {
      prevDeviceRef.current = settings.selectedMicDevice;
      return;
    }

    const prevDevice = prevDeviceRef.current;
    const newDevice = settings.selectedMicDevice;

    if (prevDevice !== newDevice) {
      console.log(`[Settings] Mic device changed (${prevDevice} → ${newDevice}), restarting test...`);
      prevDeviceRef.current = newDevice;

      // Stop current test and restart with new device
      stopMicTest();
      // Small delay to ensure cleanup completes
      setTimeout(() => startMicTest(), 100);
    }
  }, [settings.selectedMicDevice, isMicTesting]);

  const loadSettings = async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api) return;
      const config = await api.getAllConfig();
      if (config) {
        setSettings({
          groqApiKey: config.groqApiKey || '',
          obsidianVaultPath: config.obsidianVaultPath || '',
          chunkIntervalSeconds: config.chunkIntervalSeconds || 5,
          whisperModel: config.whisperModel || 'whisper-large-v3-turbo',
          llmModel: config.llmModel || 'llama-3.3-70b-versatile',
          captureSystemAudio: config.captureSystemAudio !== false,
          selectedMicDevice: config.selectedMicDevice || 'default',
          wasapiDevice: config.wasapiDevice || 'virtual-audio-capturer',
          ffmpegPath: config.ffmpegPath || 'ffmpeg',
        });
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const loadAudioDevices = async (requestPermission = false) => {
    try {
      const { inputs } = await enumerateAudioDevices(requestPermission);
      setAudioInputs(inputs);
    } catch (err) {
      console.error('Failed to enumerate audio devices:', err);
    }
  };

  // --- Microphone test ---
  const startMicTest = async () => {
    try {
      setIsMicTesting(true);

      // Registra qual dispositivo está sendo testado
      micTestDeviceRef.current = settings.selectedMicDevice || 'default';

      // Use the selected device for the test
      const constraints: MediaTrackConstraints = {
        sampleRate: 24000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      if (settings.selectedMicDevice && settings.selectedMicDevice !== 'default') {
        (constraints as any).deviceId = { exact: settings.selectedMicDevice };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
        video: false,
      });

      micTestStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 24000 });
      micTestCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      const mutedOutput = audioCtx.createGain();
      mutedOutput.gain.value = 0;
      source.connect(processor);
      processor.connect(mutedOutput);
      mutedOutput.connect(audioCtx.destination);

      micTestRunningRef.current = true;

      // Processador: calcula RMS a cada frame de áudio
      processor.onaudioprocess = (event) => {
        if (!micTestRunningRef.current) return;
        const data = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i] * data[i];
        }
        const rms = Math.sqrt(sum / data.length);
        // Nível visual normalizado e amplificado
        setMicTestLevel(Math.min(1, rms * 5));
      };

      // Loop de animação visual a 60fps
      const animate = () => {
        if (!micTestRunningRef.current) return;
        micTestAnimRef.current = requestAnimationFrame(animate);
      };
      micTestAnimRef.current = requestAnimationFrame(animate);
    } catch (err: any) {
      console.error('[MicTest] Failed:', err);
      setIsMicTesting(false);
    }
  };

  const stopMicTest = () => {
    micTestRunningRef.current = false;
    cancelAnimationFrame(micTestAnimRef.current);
    micTestAnimRef.current = 0;

    // Fecha o AudioContext
    if (micTestCtxRef.current) {
      micTestCtxRef.current.close();
      micTestCtxRef.current = null;
    }

    // Para o stream do microfone
    if (micTestStreamRef.current) {
      micTestStreamRef.current.getTracks().forEach(t => t.stop());
      micTestStreamRef.current = null;
    }

    setMicTestLevel(0);
    setIsMicTesting(false);
  };

  // --- System audio test ---
  const startSysTest = async () => {
    try {
      setIsSysTesting(true);
      setSysTestLevel(0);

      console.log('[SysTest] Testing system audio capture...');

      if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        throw new Error('A captura nativa de áudio do sistema não está disponível.');
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((track) => track.stop());
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Nenhuma faixa de áudio do sistema foi retornada.');
      }

      sysTestStreamRef.current = stream;
      const audioCtx = new AudioContext({ sampleRate: 24000 });
      sysTestCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      const mutedOutput = audioCtx.createGain();
      mutedOutput.gain.value = 0;
      source.connect(processor);
      processor.connect(mutedOutput);
      mutedOutput.connect(audioCtx.destination);

      sysTestRunningRef.current = true;
      processor.onaudioprocess = (event) => {
        if (!sysTestRunningRef.current) return;
        const data = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        setSysTestLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
      };

      console.log(
        `[SysTest] Capturing real system audio: "${stream.getAudioTracks()[0]?.label}"`
      );
    } catch (err: any) {
      const msg = err?.message || err?.name || 'Erro desconhecido';
      console.error('[SysTest] Failed:', msg);
      setIsSysTesting(false);
      setSysTestLevel(-1);
      setTimeout(() => setSysTestLevel(0), 8000);
    }
  };

  const stopSysTest = () => {
    sysTestRunningRef.current = false;
    cancelAnimationFrame(sysTestAnimRef.current);
    sysTestAnimRef.current = 0;

    if (sysTestCtxRef.current) {
      sysTestCtxRef.current.close();
      sysTestCtxRef.current = null;
    }

    if (sysTestStreamRef.current) {
      sysTestStreamRef.current.getTracks().forEach((t) => t.stop());
      sysTestStreamRef.current = null;
    }

    setSysTestLevel(0);
    setIsSysTesting(false);
  };

  const handleChange = (key: keyof Settings, value: string | number | boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    setSaveMessage(null);

    // Auto-salva imediatamente configurações de áudio (microfone, sistema)
    // para que o BackgroundWorker leia o valor correto mesmo sem "Salvar"
    if (key === 'selectedMicDevice' || key === 'captureSystemAudio' || key === 'wasapiDevice') {
      (window as any).electronAPI?.setConfig(key, value).catch(() => {});
    }
  };

  const handleSave = async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api) return;

      for (const [key, value] of Object.entries(settings)) {
        await api.setConfig(key, value);
      }

      // Reset Groq client so subsequent calls use the fresh API key
      await api.resetGroqClient();

      setIsDirty(false);
      setSaveMessage('✅ Configurações salvas com sucesso!');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: any) {
      setSaveMessage(`❌ Erro ao salvar: ${err.message}`);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const api = (window as any).electronAPI;
      if (!api) return;

      // Save key first, then force-reset the Groq client so it reads the fresh key
      await api.setConfig('groqApiKey', settings.groqApiKey);
      await api.resetGroqClient();

      const result = await api.testGroqConnection();
      if (result.success) {
        setTestResult({ success: true, message: '✅ Conexão com Groq API estabelecida!' });
      } else {
        setTestResult({ success: false, message: `❌ ${result.error || 'Falha na conexão'}` });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: `❌ ${err.message}` });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api) return;

      const result = await api.selectFolder();
      if (!result.canceled && result.path) {
        setSettings((prev) => ({ ...prev, obsidianVaultPath: result.path }));
        setIsDirty(true);
        setSaveMessage(null);
      }
    } catch (err: any) {
      console.error('[Settings] Folder picker failed:', err);
    }
  };

  return (
    <div className="settings-view">
      <div className="settings-container">
        <header className="settings-header">
          <h1>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
            Configurações
          </h1>
          <p className="subtitle">Configure sua experiência com o Reunia</p>
        </header>

        {/* Groq API Key */}
        <section className="settings-section">
          <h2>🔑 Groq API</h2>
          <div className="field">
            <label htmlFor="apiKey">API Key</label>
            <div className="field-with-action">
              <input
                id="apiKey"
                type="password"
                value={settings.groqApiKey}
                onChange={(e) => handleChange('groqApiKey', e.target.value)}
                placeholder="gsk_..."
              />
              <button
                className="btn-secondary"
                onClick={handleTestConnection}
                disabled={isTesting || !settings.groqApiKey}
              >
                {isTesting ? 'Testando...' : 'Testar Conexão'}
              </button>
            </div>
            {testResult && (
              <p className={`field-hint ${testResult.success ? 'success' : 'error'}`}>
                {testResult.message}
              </p>
            )}
            <p className="field-hint">
              Obtenha sua chave em{' '}
              <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
                console.groq.com/keys
              </a>
            </p>
          </div>
        </section>

        {/* Obsidian Vault */}
        <section className="settings-section">
          <h2>📓 Obsidian Vault</h2>
          <div className="field">
            <label htmlFor="vaultPath">Caminho da pasta do Vault</label>
            <div className="field-with-action">
              <input
                id="vaultPath"
                type="text"
                value={settings.obsidianVaultPath}
                onChange={(e) => handleChange('obsidianVaultPath', e.target.value)}
                placeholder="C:\Users\SeuNome\ObsidianVault"
              />
              <button className="btn-secondary" onClick={handleSelectFolder}>
                📂 Selecionar
              </button>
            </div>
            <p className="field-hint">
              As notas de reunião serão salvas automaticamente nesta pasta como arquivos .md
            </p>
          </div>
        </section>

        {/* Audio Settings */}
        <section className="settings-section">
          <h2>🎤 Áudio & Transcrição</h2>

          {/* Microphone selector */}
          <div className="field">
            <label htmlFor="micDevice">🎙️ Microfone (entrada)</label>
            <div className="field-row">
              <select
                id="micDevice"
                value={settings.selectedMicDevice}
                onChange={(e) => handleChange('selectedMicDevice', e.target.value)}
                className="flex-1"
              >
                <option value="default">Microfone padrão do sistema</option>
                {audioInputs.map((dev) => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.label}
                  </option>
                ))}
              </select>
              <button
                className="btn-secondary"
                onClick={() => loadAudioDevices(true)}
                title="Atualizar lista de dispositivos"
              >
                ↻
              </button>
            </div>
            <p className="field-hint">
              Selecione qual microfone usar. Clique em ↻ para atualizar a lista.
            </p>
          </div>

          {/* Mic level meter + test button */}
          <div className="field mic-test-field">
            <label>Nível do microfone</label>
            <div className="mic-test-row">
              <div className="mic-level-bar-container">
                <div
                  className="mic-level-bar"
                  style={{ width: `${Math.min(100, micTestLevel * 150)}%` }}
                />
              </div>
              <span className="mic-level-value">
                {isMicTesting ? `${Math.round(micTestLevel * 100)}%` : '—'}
              </span>
              <button
                className={`btn-secondary ${isMicTesting ? 'danger' : ''}`}
                onClick={isMicTesting ? stopMicTest : startMicTest}
              >
                {isMicTesting ? '⏹ Parar Teste' : '🎤 Testar'}
              </button>
            </div>
            <p className="field-hint">
              Clique em "Testar" e fale algo para verificar se o microfone está funcionando.
            </p>
          </div>

          {/* Chunk interval */}
          <div className="field">
            <label htmlFor="chunkInterval">
              Intervalo entre chunks: <strong>{settings.chunkIntervalSeconds}s</strong>
            </label>
            <div className="slider-container">
              <span>1s</span>
              <input
                id="chunkInterval"
                type="range"
                min={1}
                max={15}
                step={1}
                value={settings.chunkIntervalSeconds}
                onChange={(e) => handleChange('chunkIntervalSeconds', parseInt(e.target.value))}
              />
              <span>15s</span>
            </div>
            <p className="field-hint">
              Menor = mais atualizações, maior consumo de API. Maior = mais contexto, menos requisições.
            </p>
          </div>

          {/* Toggle: Áudio do Sistema */}
          <div className="field toggle-field">
            <label htmlFor="captureSystem">
              <div className="toggle-row">
                <span>🔊 Capturar áudio do sistema</span>
                <div
                  className={`toggle-switch ${settings.captureSystemAudio ? 'active' : ''}`}
                  onClick={() => handleChange('captureSystemAudio', !settings.captureSystemAudio)}
                >
                  <div className="toggle-knob" />
                </div>
              </div>
            </label>
          </div>

          {settings.captureSystemAudio && (
            <p className="field-hint">
              O Reunia usa o loopback nativo do Windows e captura automaticamente
              o dispositivo de saída que estiver reproduzindo o áudio.
            </p>
          )}

          {/* System audio test */}
          {settings.captureSystemAudio && (
            <div className="field mic-test-field">
              <label>🔊 Nível do áudio do sistema</label>
              <div className="mic-test-row">
                <div className="mic-level-bar-container">
                  <div
                    className={`mic-level-bar sys ${sysTestLevel === -1 ? 'error' : ''}`}
                    style={{ width: sysTestLevel === -1 ? '100%' : `${Math.min(100, sysTestLevel * 150)}%` }}
                  />
                </div>
                <span className="mic-level-value">
                  {sysTestLevel === -1 ? '❌ Erro' : isSysTesting ? `${Math.round(sysTestLevel * 100)}%` : '—'}
                </span>
                <button
                  className={`btn-secondary ${isSysTesting ? 'danger' : ''}`}
                  onClick={isSysTesting ? stopSysTest : startSysTest}
                >
                  {isSysTesting ? '⏹ Parar' : '🔊 Testar'}
                </button>
              </div>
            <p className="field-hint">
                Clique em "Testar", reproduza algum som e confirme que o nível se movimenta.
            </p>
            </div>
          )}
        </section>

        {/* Model Settings */}
        <section className="settings-section">
          <h2>🧠 Modelos</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="whisperModel">Whisper (Transcrição)</label>
              <select
                id="whisperModel"
                value={settings.whisperModel}
                onChange={(e) => handleChange('whisperModel', e.target.value)}
              >
                <option value="whisper-large-v3-turbo">Whisper Large V3 Turbo (rápido)</option>
                <option value="whisper-large-v3">Whisper Large V3 (preciso)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="llmModel">LLM (Análise)</label>
              <select
                id="llmModel"
                value={settings.llmModel}
                onChange={(e) => handleChange('llmModel', e.target.value)}
              >
                <option value="llama-3.3-70b-versatile">Llama 3.3 70B (recomendado)</option>
                <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                <option value="gemma2-9b-it">Gemma 2 9B</option>
              </select>
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="settings-actions">
          <button className="btn-primary" onClick={handleSave} disabled={!isDirty}>
            💾 Salvar Configurações
          </button>
          {saveMessage && <span className="save-message">{saveMessage}</span>}
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
