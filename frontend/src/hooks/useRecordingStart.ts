import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import Analytics from '@/lib/analytics';
import { showRecordingNotification } from '@/lib/recordingNotification';
import { toast } from 'sonner';

interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
  isAutoStarting: boolean;
}

/**
 * Custom hook for managing recording start lifecycle.
 * Handles both manual start (button click) and auto-start (from sidebar navigation).
 *
 * Features:
 * - Meeting title generation (format: Meeting DD_MM_YY_HH_MM_SS)
 * - Transcript clearing on start
 * - Analytics tracking
 * - Recording notification display
 * - Auto-start from sidebar via sessionStorage flag
 */
export function useRecordingStart(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  showModal?: (name: 'modelSelector', message?: string) => void
): UseRecordingStartReturn {
  const [isAutoStarting, setIsAutoStarting] = useState(false);

  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices } = useConfig();
  const { setStatus } = useRecordingState();

  // Generate meeting title with timestamp
  const generateMeetingTitle = useCallback(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  }, []);

  // Check if Parakeet transcription model is ready
  const checkParakeetReady = useCallback(async (): Promise<boolean> => {
    try {
      await invoke('parakeet_init');
      const hasModels = await invoke<boolean>('parakeet_has_available_models');
      return hasModels;
    } catch (error) {
      console.error('Failed to check Parakeet status:', error);
      return false;
    }
  }, []);

  // Get the configured transcription provider (source of truth: database)
  const getTranscriptProvider = useCallback(async (): Promise<string> => {
    try {
      const config = await invoke<any>('api_get_transcript_config');
      return config?.provider || 'parakeet';
    } catch (error) {
      console.error('Failed to get transcript config:', error);
      return 'parakeet';
    }
  }, []);

  // Cloud providers don't require a local transcription model
  const isCloudProvider = useCallback((provider: string): boolean => {
    return provider === 'groq' || provider === 'deepgram' || provider === 'elevenLabs' || provider === 'openai';
  }, []);

  // Check if any model is currently downloading
  const checkIfModelDownloading = useCallback(async (): Promise<boolean> => {
    try {
      const models = await invoke<any[]>('parakeet_get_available_models');
      const isDownloading = models.some(m =>
        m.status && (
          typeof m.status === 'object'
            ? 'Downloading' in m.status
            : m.status === 'Downloading'
        )
      );
      return isDownloading;
    } catch (error) {
      console.error('Failed to check model download status:', error);
      return false; // Default to not downloading (will show error + modal)
    }
  }, []);

  // Handle manual recording start (from button click)
  const handleRecordingStart = useCallback(async () => {
    try {
      console.log('handleRecordingStart called - checking transcription model status');

      // Get the configured transcription provider
      const transcriptProvider = await getTranscriptProvider();
      console.log('Transcript provider:', transcriptProvider);

      // Check if Parakeet transcription model is ready before starting.
      // Cloud providers (groq, etc.) don't require a local model.
      const parakeetReady = isCloudProvider(transcriptProvider) || await checkParakeetReady();
      if (!parakeetReady) {
        const isDownloading = await checkIfModelDownloading();
        if (isDownloading) {
          toast.info('Download do modelo em andamento', {
            description: 'Aguarde o modelo de transcrição terminar o download antes de gravar.',
            duration: 5000,
          });
          Analytics.trackButtonClick('start_recording_blocked_downloading', 'home_page');
        } else {
          toast.error('Modelo de transcrição não está pronto', {
            description: 'Baixe um modelo de transcrição antes de gravar.',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Configuração do modelo de transcrição necessária');
          Analytics.trackButtonClick('start_recording_blocked_missing', 'home_page');
        }
        setStatus(RecordingStatus.IDLE);
        return;
      }

      console.log('Parakeet ready - setting up meeting title and state');

      const randomTitle = generateMeetingTitle();
      setMeetingTitle(randomTitle);

      // Set STARTING status before initiating backend recording
      setStatus(RecordingStatus.STARTING, 'Inicializando gravação...');

      // Start the actual backend recording
      console.log('Starting backend recording with meeting:', randomTitle);
      await recordingService.startRecordingWithDevices(
        selectedDevices?.micDevice || null,
        selectedDevices?.systemDevice || null,
        randomTitle
      );
      console.log('Backend recording started successfully');

      // Update state after successful backend start
      // Note: RECORDING status will be set by RecordingStateContext event listener
      console.log('Setting isRecordingState to true');
      setIsRecording(true); // This will also update the sidebar via the useEffect
      clearTranscripts(); // Clear previous transcripts when starting new recording
      setIsMeetingActive(true);
      Analytics.trackButtonClick('start_recording', 'home_page');

      // Show recording notification if enabled
      await showRecordingNotification();
    } catch (error) {
      console.error('Failed to start recording:', error);
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Falha ao iniciar a gravação');
      setIsRecording(false); // Reset state on error
      Analytics.trackButtonClick('start_recording_error', 'home_page');
      // Re-throw so RecordingControls can handle device-specific errors
      throw error;
    }
  }, [generateMeetingTitle, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive, checkParakeetReady, checkIfModelDownloading, getTranscriptProvider, isCloudProvider, selectedDevices, showModal, setStatus]);

  // Check for autoStartRecording flag and start recording automatically
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window !== 'undefined') {
        const shouldAutoStart = sessionStorage.getItem('autoStartRecording');
        if (shouldAutoStart === 'true' && !isRecording && !isAutoStarting) {
          console.log('Auto-starting recording from navigation...');
          setIsAutoStarting(true);
          sessionStorage.removeItem('autoStartRecording'); // Clear the flag

          // Get the configured transcription provider
          const transcriptProvider = await getTranscriptProvider();

          // Check if Parakeet transcription model is ready before starting.
          // Cloud providers (groq, etc.) don't require a local model.
          const parakeetReady = isCloudProvider(transcriptProvider) || await checkParakeetReady();
          if (!parakeetReady) {
            const isDownloading = await checkIfModelDownloading();
            if (isDownloading) {
              toast.info('Download do modelo em andamento', {
                description: 'Aguarde o modelo de transcrição terminar o download antes de gravar.',
                duration: 5000,
              });
              Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_auto');
            } else {
              toast.error('Modelo de transcrição não está pronto', {
                description: 'Baixe um modelo de transcrição antes de gravar.',
                duration: 5000,
              });
              showModal?.('modelSelector', 'Configuração do modelo de transcrição necessária');
              Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_auto');
            }
            setStatus(RecordingStatus.IDLE);
            setIsAutoStarting(false);
            return;
          }

          // Start the actual backend recording
          try {
            // Generate meeting title
            const generatedMeetingTitle = generateMeetingTitle();

            // Set STARTING status before initiating backend recording
            setStatus(RecordingStatus.STARTING, 'Inicializando gravação...');

            console.log('Auto-starting backend recording with meeting:', generatedMeetingTitle);
            const result = await recordingService.startRecordingWithDevices(
              selectedDevices?.micDevice || null,
              selectedDevices?.systemDevice || null,
              generatedMeetingTitle
            );
            console.log('Auto-start backend recording result:', result);

            // Update UI state after successful backend start
            // Note: RECORDING status will be set by RecordingStateContext event listener
            setMeetingTitle(generatedMeetingTitle);
            setIsRecording(true);
            clearTranscripts();
            setIsMeetingActive(true);
            Analytics.trackButtonClick('start_recording', 'sidebar_auto');

            // Show recording notification if enabled
            await showRecordingNotification();
          } catch (error) {
            console.error('Failed to auto-start recording:', error);
            setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Falha ao iniciar a gravação automaticamente');
            alert('Falha ao iniciar a gravação. Verifique o console para mais detalhes.');
            Analytics.trackButtonClick('start_recording_error', 'sidebar_auto');
          } finally {
            setIsAutoStarting(false);
          }
        }
      }
    };

    checkAutoStartRecording();
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkParakeetReady,
    checkIfModelDownloading,
    getTranscriptProvider,
    isCloudProvider,
    showModal,
    setStatus,
  ]);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      if (isRecording || isAutoStarting) {
        console.log('Recording already in progress, ignoring direct start event');
        return;
      }

      console.log('Direct start from sidebar - checking transcription model status');
      setIsAutoStarting(true);

      // Get the configured transcription provider
      const transcriptProvider = await getTranscriptProvider();

      // Check if Parakeet transcription model is ready before starting.
      // Cloud providers (groq, etc.) don't require a local model.
      const parakeetReady = isCloudProvider(transcriptProvider) || await checkParakeetReady();
      if (!parakeetReady) {
        const isDownloading = await checkIfModelDownloading();
        if (isDownloading) {
          toast.info('Download do modelo em andamento', {
            description: 'Aguarde o modelo de transcrição terminar o download antes de gravar.',
            duration: 5000,
          });
          Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_direct');
        } else {
          toast.error('Modelo de transcrição não está pronto', {
            description: 'Baixe um modelo de transcrição antes de gravar.',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Configuração do modelo de transcrição necessária');
          Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_direct');
        }
        setStatus(RecordingStatus.IDLE);
        setIsAutoStarting(false);
        return;
      }

      try {
        // Generate meeting title
        const generatedMeetingTitle = generateMeetingTitle();

        // Set STARTING status before initiating backend recording
        setStatus(RecordingStatus.STARTING, 'Inicializando gravação...');

        console.log('Starting backend recording with meeting:', generatedMeetingTitle);
        const result = await recordingService.startRecordingWithDevices(
          selectedDevices?.micDevice || null,
          selectedDevices?.systemDevice || null,
          generatedMeetingTitle
        );
        console.log('Backend recording result:', result);

        // Update UI state after successful backend start
        // Note: RECORDING status will be set by RecordingStateContext event listener
        setMeetingTitle(generatedMeetingTitle);
        setIsRecording(true);
        clearTranscripts();
        setIsMeetingActive(true);
        Analytics.trackButtonClick('start_recording', 'sidebar_direct');

        // Show recording notification if enabled
        await showRecordingNotification();
      } catch (error) {
        console.error('Failed to start recording from sidebar:', error);
        setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Falha ao iniciar a gravação pela barra lateral');
        alert('Falha ao iniciar a gravação. Verifique o console para mais detalhes.');
        Analytics.trackButtonClick('start_recording_error', 'sidebar_direct');
      } finally {
        setIsAutoStarting(false);
      }
    };

    window.addEventListener('start-recording-from-sidebar', handleDirectStart);

    return () => {
      window.removeEventListener('start-recording-from-sidebar', handleDirectStart);
    };
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkParakeetReady,
    checkIfModelDownloading,
    getTranscriptProvider,
    isCloudProvider,
    showModal,
    setStatus,
  ]);

  return {
    handleRecordingStart,
    isAutoStarting,
  };
}
