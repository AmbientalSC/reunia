import { useState } from 'react';
import { AiModel, templateService } from '@/services/templateService';
import { FormState, formFromDraft } from './templateForm';

export type AiTask = { kind: 'generate' } | { kind: 'improve'; uid: number };

/** What "Desfazer" restores: the whole form after a generation, one instruction after an improvement. */
type UndoEntry =
  | { kind: 'form'; form: FormState }
  | { kind: 'instruction'; uid: number; previous: string };

const FALLBACK_ERROR = 'Não foi possível usar a IA agora. Tente novamente.';

interface UseTemplateAiArgs {
  /** Summary model to use; null when none is configured. */
  aiModel: AiModel | null;
  /** Latest form contents (read at call time, so it is never stale after an await). */
  readForm: () => FormState;
  setForm: (form: FormState) => void;
  setSectionInstruction: (uid: number, instruction: string) => void;
}

/**
 * Runs the editor's AI assistance (draft a whole template, rewrite one section's
 * instruction) and keeps a one-level undo of the last suggestion. Undoing an improved
 * instruction only touches that instruction, so manual edits elsewhere are kept. The AI
 * only ever fills the form; saving stays a separate, explicit step.
 */
export function useTemplateAi({
  aiModel,
  readForm,
  setForm,
  setSectionInstruction,
}: UseTemplateAiArgs) {
  const [task, setTask] = useState<AiTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null);

  const run = async <T>(
    nextTask: AiTask,
    request: (model: AiModel) => Promise<T>,
    apply: (result: T) => UndoEntry
  ) => {
    if (!aiModel || task) return;

    setTask(nextTask);
    setError(null);
    try {
      const result = await request(aiModel);
      // The undo entry is built after the await, from the latest form, so edits made
      // while waiting are not lost on undo.
      setUndoEntry(apply(result));
    } catch (e) {
      console.error('Template AI request failed:', e);
      setError(typeof e === 'string' ? e : FALLBACK_ERROR);
    } finally {
      setTask(null);
    }
  };

  const generate = (description: string) =>
    run(
      { kind: 'generate' },
      (model) => templateService.generateWithAi(description, model),
      (draft) => {
        const entry: UndoEntry = { kind: 'form', form: readForm() };
        setForm(formFromDraft(draft));
        return entry;
      }
    );

  const improveInstruction = (uid: number) => {
    const form = readForm();
    const section = form.sections.find((s) => s.uid === uid);
    if (!section) return Promise.resolve();

    return run(
      { kind: 'improve', uid },
      (model) =>
        templateService.improveInstruction(
          {
            templateName: form.name,
            templateDescription: form.description,
            sectionTitle: section.title,
            sectionFormat: section.format,
            instruction: section.instruction,
          },
          model
        ),
      (instruction) => {
        const current = readForm().sections.find((s) => s.uid === uid);
        const entry: UndoEntry = {
          kind: 'instruction',
          uid,
          previous: current?.instruction ?? section.instruction,
        };
        setSectionInstruction(uid, instruction);
        return entry;
      }
    );
  };

  const undo = () => {
    if (!undoEntry) return;
    if (undoEntry.kind === 'form') {
      setForm(undoEntry.form);
    } else {
      setSectionInstruction(undoEntry.uid, undoEntry.previous);
    }
    setUndoEntry(null);
    setError(null);
  };

  return {
    task,
    error,
    canUndo: undoEntry !== null,
    generate,
    improveInstruction,
    undo,
  };
}
