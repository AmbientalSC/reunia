import React from 'react';
import FloatWidget from './components/FloatWidget';
import SettingsView from './components/SettingsView';
import InsightPanel from './components/InsightPanel';
import { useAudioCapture } from './hooks/useAudioCapture';

/**
 * App root component.
 * 
 * Determines which view to render based on URL query parameter:
 * - ?view=float → Floating widget (default)
 * - ?view=settings → Settings window
 * - ?view=insights → Full insight panel
 * - ?view=background → Hidden background worker
 */
const App: React.FC = () => {
  const [currentView] = React.useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') || 'float';
  });

  switch (currentView) {
    case 'settings':
      return <SettingsView />;
    case 'insights':
      return <InsightPanel fullScreen />;
    case 'background':
      // Hidden view — runs in background window, no UI needed
      return <BackgroundWorker />;
    case 'float':
    default:
      return <FloatWidget />;
  }
};

/**
 * Background worker component.
 * Renders nothing visible but sets up IPC listeners
 * for audio capture when the main process signals.
 * Uses the useAudioCapture hook for actual mic/system capture.
 */
const BackgroundWorker: React.FC = () => {
  const { startCapture, stopCapture, isCapturing, error } = useAudioCapture();
  const hasStartedRef = React.useRef(false);

  React.useEffect(() => {
    console.log('[BackgroundWorker] Mounted. Waiting for recording state...');

    // Listen for meeting state changes from main process
    const cleanup = (window as any).electronAPI?.onMeetingStateChanged(
      async (state: string) => {
        console.log(`[BackgroundWorker] State change: ${state}`);

        // NOTA: a captura de áudio é feita pelo FloatWidget (janela visível).
        // O BackgroundWorker apenas reage a estados para limpeza.
        if (state === 'recording') {
          // FloatWidget já iniciou a captura — nada a fazer aqui
        } else if (state === 'idle' && hasStartedRef.current) {
          hasStartedRef.current = false;
          stopCapture();
        }
      }
    );

    return () => {
      if (cleanup) cleanup();
      if (hasStartedRef.current) {
        hasStartedRef.current = false;
        stopCapture();
      }
    };
  }, []); // Only mount once

  // Log errors from useAudioCapture hook
  React.useEffect(() => {
    if (error) {
      console.error('[BackgroundWorker] Audio capture error:', error);
    }
  }, [error]);

  return null; // Invisible
};

export default App;
