import { invoke } from '@tauri-apps/api/core';

// Default models used by every Groq-managed profile — the API key itself
// comes from the Firestore profile (mirrored into the Rust AuthSession),
// never entered by the user. See docs on user_profiles/{uid}.groqApiKey.
const GROQ_TRANSCRIPT_MODEL = 'whisper-large-v3-turbo';
const GROQ_SUMMARY_MODEL = 'openai/gpt-oss-120b';

interface OnboardingStatus {
  completed: boolean;
  current_step: number;
}

/**
 * Skips the local-model onboarding (Whisper/Parakeet download, model
 * picker) for enterprise users whose Firestore profile already carries a
 * Groq key: pre-configures both the transcription and summary providers as
 * Groq and marks onboarding complete, so login alone leaves the app ready
 * to use. Runs once — if onboarding is already completed (including a
 * provider the user picked manually afterwards), it's left untouched.
 */
export async function autoConfigureEnterpriseProviders(): Promise<void> {
  const status = await invoke<OnboardingStatus | null>('get_onboarding_status');
  if (status?.completed) {
    return;
  }

  await invoke('api_save_transcript_config', {
    provider: 'groq',
    model: GROQ_TRANSCRIPT_MODEL,
    apiKey: null,
  });

  await invoke('api_save_model_config', {
    provider: 'groq',
    model: GROQ_SUMMARY_MODEL,
    whisperModel: GROQ_TRANSCRIPT_MODEL,
    apiKey: null,
    ollamaEndpoint: null,
  });

  await invoke('save_onboarding_status_cmd', {
    status: {
      version: '1.0',
      completed: true,
      current_step: 4,
      model_status: {
        parakeet: 'not_downloaded',
        summary: 'downloaded',
        selected_summary_model: GROQ_SUMMARY_MODEL,
      },
      last_updated: new Date().toISOString(),
    },
  });
}
