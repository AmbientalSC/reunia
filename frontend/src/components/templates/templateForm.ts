import { TemplateDraft, TemplateSection } from '../../types/template';

/** A section as edited in the form. */
export interface FormSection extends TemplateSection {
  /** Client-only key so reordering keeps each card's identity. */
  uid: number;
}

/** Everything the editor form holds; also the unit the AI assistant replaces or restores. */
export interface FormState {
  name: string;
  description: string;
  sections: FormSection[];
}

export const EMPTY_SECTION: TemplateSection = {
  title: '',
  instruction: '',
  format: 'paragraph',
};

/** Blank drafts start with one section so the user sees what is expected. */
export const NEW_TEMPLATE_DRAFT: TemplateDraft = {
  name: '',
  description: '',
  sections: [
    {
      title: 'Resumo',
      instruction: 'Escreva um resumo breve dos principais pontos da reunião.',
      format: 'paragraph',
    },
  ],
};

let nextSectionUid = 0;

// `example_item_format` is an alias the backend only reads when `item_format` is
// empty; folding it into `item_format` makes it visible and editable in the form.
export const toFormSection = (section: TemplateSection): FormSection => ({
  ...section,
  item_format: section.item_format ?? section.example_item_format ?? null,
  example_item_format: null,
  uid: ++nextSectionUid,
});

export function formFromDraft(draft: TemplateDraft): FormState {
  return {
    name: draft.name,
    description: draft.description,
    sections: draft.sections.map(toFormSection),
  };
}

export function findValidationError({ name, description, sections }: FormState): string | null {
  if (!name.trim()) return 'Informe o nome do modelo.';
  if (!description.trim()) return 'Informe uma descrição para o modelo.';
  if (sections.length === 0) return 'Adicione pelo menos uma seção.';
  if (sections.some((s) => !s.title.trim() || !s.instruction.trim())) {
    return 'Preencha o título e a instrução de todas as seções.';
  }
  return null;
}

/** Item formats only apply to lists; they are dropped when the format changes. */
export function toDraft({ name, description, sections }: FormState): TemplateDraft {
  return {
    name,
    description,
    sections: sections.map((section) => {
      const isList = section.format === 'list';
      return {
        title: section.title,
        instruction: section.instruction,
        format: section.format,
        item_format: isList ? section.item_format ?? null : null,
        example_item_format: isList ? section.example_item_format ?? null : null,
      };
    }),
  };
}
