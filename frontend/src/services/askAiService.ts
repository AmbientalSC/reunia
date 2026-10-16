/**
 * Ask AI Service
 *
 * Thin wrapper around the `api_ask_ai` Tauri command: one stateless call that
 * explains a keyword or phrase (using the web when the provider can) and also
 * answers follow-up questions. The conversation is sent along each time.
 */
import { invoke } from '@tauri-apps/api/core';
import { AskAnswer, AskRequest } from '@/types/ask';

export class AskAiService {
  async ask(request: AskRequest, provider: string, model: string): Promise<AskAnswer> {
    return invoke<AskAnswer>('api_ask_ai', {
      request,
      model: provider,
      modelName: model,
    });
  }
}

export const askAiService = new AskAiService();
