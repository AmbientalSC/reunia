/**
 * Template Service
 *
 * Wraps the Tauri commands that list, read, save and delete summary templates.
 * Built-in templates are read-only; only custom templates can be saved or deleted.
 */

import { invoke } from '@tauri-apps/api/core';
import { TemplateDraft, TemplateFull, TemplateInfo } from '@/types/template';

/** Provider/model pair configured for summaries (the same one used to generate minutes). */
export interface AiModel {
  provider: string;
  model: string;
}

export interface ImproveInstructionContext {
  templateName: string;
  templateDescription: string;
  sectionTitle: string;
  sectionFormat: string;
  instruction: string;
}

export class TemplateService {
  async list(): Promise<TemplateInfo[]> {
    return invoke<TemplateInfo[]>('api_list_templates');
  }

  async get(templateId: string): Promise<TemplateFull> {
    return invoke<TemplateFull>('api_get_template', { templateId });
  }

  /**
   * Creates a custom template (`templateId = null`) or updates an existing one.
   * Rejects with the backend's validation message when the draft is invalid.
   */
  async save(templateId: string | null, draft: TemplateDraft): Promise<TemplateInfo> {
    return invoke<TemplateInfo>('api_save_custom_template', {
      templateId,
      template: draft,
    });
  }

  async remove(templateId: string): Promise<void> {
    return invoke<void>('api_delete_custom_template', { templateId });
  }

  /** Asks the configured summary model to draft a template; nothing is saved. */
  async generateWithAi(description: string, model: AiModel): Promise<TemplateDraft> {
    return invoke<TemplateDraft>('api_ai_generate_template', {
      description,
      model: model.provider,
      modelName: model.model,
    });
  }

  /** Asks the configured summary model to rewrite one section's instruction. */
  async improveInstruction(
    context: ImproveInstructionContext,
    model: AiModel
  ): Promise<string> {
    return invoke<string>('api_ai_improve_instruction', {
      templateName: context.templateName,
      templateDescription: context.templateDescription,
      sectionTitle: context.sectionTitle,
      sectionFormat: context.sectionFormat,
      instruction: context.instruction,
      model: model.provider,
      modelName: model.model,
    });
  }
}

export const templateService = new TemplateService();
