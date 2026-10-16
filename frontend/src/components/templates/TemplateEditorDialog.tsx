"use client";

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AiModel, templateService } from '@/services/templateService';
import {
  TEMPLATE_LIMITS,
  TemplateDraft,
  TemplateInfo,
  TemplateSection,
  TemplateSectionFormat,
} from '@/types/template';
import { TemplateAiPanel } from './TemplateAiPanel';
import {
  EMPTY_SECTION,
  FormSection,
  FormState,
  findValidationError,
  formFromDraft,
  toDraft,
  toFormSection,
} from './templateForm';
import { useTemplateAi } from './useTemplateAi';

const FORMAT_OPTIONS: Array<{ value: TemplateSectionFormat; label: string }> = [
  { value: 'paragraph', label: 'Parágrafo' },
  { value: 'list', label: 'Lista' },
  { value: 'string', label: 'Texto curto' },
];

const NO_AI_MODEL_REASON =
  'Configure um modelo de IA em Configurações > Resumo para usar este recurso.';

interface TemplateEditorDialogProps {
  title: string;
  /** Id of the custom template being edited, or null to create a new one. */
  templateId: string | null;
  initialDraft: TemplateDraft;
  /** Summary model used by the AI assistant; null disables the AI buttons. */
  aiModel: AiModel | null;
  onClose: () => void;
  onSaved: (template: TemplateInfo) => void;
}

/**
 * Form to create or edit a custom summary template. Mount it only while it is
 * open: the form state is initialised from `initialDraft` on mount.
 */
export function TemplateEditorDialog({
  title,
  templateId,
  initialDraft,
  aiModel,
  onClose,
  onSaved,
}: TemplateEditorDialogProps) {
  const [initialForm] = useState(() => formFromDraft(initialDraft));
  const [name, setName] = useState(initialForm.name);
  const [description, setDescription] = useState(initialForm.description);
  const [sections, setSections] = useState<FormSection[]>(initialForm.sections);
  const [isSaving, setIsSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const form: FormState = { name, description, sections };
  const formRef = useRef(form);
  formRef.current = form;

  const ai = useTemplateAi({
    aiModel,
    readForm: () => formRef.current,
    setForm: (next) => {
      setName(next.name);
      setDescription(next.description);
      setSections(next.sections);
      setShowErrors(false);
      setSaveError(null);
    },
    setSectionInstruction: (uid, instruction) => updateSection(uid, { instruction }),
  });

  const validationError = findValidationError(form);
  const aiUnavailableReason = aiModel ? null : NO_AI_MODEL_REASON;
  const isAiBusy = ai.task !== null;

  function updateSection(uid: number, patch: Partial<TemplateSection>) {
    setSections((prev) => prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  }

  const moveSection = (index: number, offset: -1 | 1) => {
    setSections((prev) => {
      const target = index + offset;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeSection = (uid: number) => {
    setSections((prev) => prev.filter((s) => s.uid !== uid));
  };

  const addSection = () => {
    setSections((prev) => [...prev, toFormSection(EMPTY_SECTION)]);
  };

  const handleSave = async () => {
    setShowErrors(true);
    if (validationError) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const saved = await templateService.save(templateId, toDraft(form));
      onSaved(saved);
    } catch (error) {
      console.error('Failed to save template:', error);
      setSaveError(typeof error === 'string' ? error : 'Não foi possível salvar o modelo.');
    } finally {
      setIsSaving(false);
    }
  };

  // The footer stays on screen while the form scrolls, so AI errors are shown here too.
  const visibleError = saveError ?? (showErrors ? validationError : null) ?? ai.error;

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <div className="border-b border-gray-200 px-6 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-1">
            O modelo define as seções da ata e o que a IA deve escrever em cada uma.
          </DialogDescription>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <TemplateAiPanel
            unavailableReason={aiUnavailableReason}
            isGenerating={ai.task?.kind === 'generate'}
            isBusy={isAiBusy}
            canUndo={ai.canUndo}
            onGenerate={ai.generate}
            onUndo={ai.undo}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">Nome</Label>
              <Input
                id="template-name"
                value={name}
                maxLength={TEMPLATE_LIMITS.name}
                placeholder="Ex.: Ata de Reunião de Diretoria"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-description">Descrição</Label>
              <Input
                id="template-description"
                value={description}
                maxLength={TEMPLATE_LIMITS.description}
                placeholder="Para que tipo de reunião serve?"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">
                Seções ({sections.length}/{TEMPLATE_LIMITS.sections})
              </h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addSection}
                disabled={sections.length >= TEMPLATE_LIMITS.sections}
              >
                <Plus />
                Adicionar seção
              </Button>
            </div>

            {sections.map((section, index) => {
              const isImproving = ai.task?.kind === 'improve' && ai.task.uid === section.uid;
              const canImprove =
                !aiUnavailableReason &&
                !isAiBusy &&
                (section.title.trim() !== '' || section.instruction.trim() !== '');

              return (
                <div
                  key={section.uid}
                  className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
                >
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label htmlFor={`section-title-${section.uid}`}>Título da seção</Label>
                      <Input
                        id={`section-title-${section.uid}`}
                        value={section.title}
                        maxLength={TEMPLATE_LIMITS.sectionTitle}
                        placeholder="Ex.: Decisões"
                        onChange={(e) => updateSection(section.uid, { title: e.target.value })}
                      />
                    </div>
                    <div className="w-40 shrink-0 space-y-1.5">
                      <Label>Formato</Label>
                      <Select
                        value={section.format}
                        onValueChange={(value) =>
                          updateSection(section.uid, { format: value as TemplateSectionFormat })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FORMAT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Mover para cima"
                        aria-label="Mover seção para cima"
                        disabled={index === 0}
                        onClick={() => moveSection(index, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Mover para baixo"
                        aria-label="Mover seção para baixo"
                        disabled={index === sections.length - 1}
                        onClick={() => moveSection(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Remover seção"
                        aria-label="Remover seção"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => removeSection(section.uid)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={`section-instruction-${section.uid}`}>
                        Instrução para a IA
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-blue-700 hover:text-blue-800"
                        disabled={!canImprove}
                        title={
                          aiUnavailableReason ??
                          'A IA reescreve a instrução para ficar mais clara e específica. Pode ser só uma ideia.'
                        }
                        onClick={() => ai.improveInstruction(section.uid)}
                      >
                        {isImproving ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        {isImproving ? 'Melhorando…' : 'Melhorar com IA'}
                      </Button>
                    </div>
                    <Textarea
                      id={`section-instruction-${section.uid}`}
                      value={section.instruction}
                      maxLength={TEMPLATE_LIMITS.instruction}
                      rows={2}
                      placeholder="O que a IA deve escrever nesta seção?"
                      onChange={(e) => updateSection(section.uid, { instruction: e.target.value })}
                    />
                  </div>

                  {section.format === 'list' && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`section-item-format-${section.uid}`}>
                        Formato dos itens{' '}
                        <span className="font-normal text-gray-500">(opcional)</span>
                      </Label>
                      <Textarea
                        id={`section-item-format-${section.uid}`}
                        value={section.item_format ?? ''}
                        maxLength={TEMPLATE_LIMITS.itemFormat}
                        rows={3}
                        className="font-mono text-xs"
                        placeholder={'Ex.: tabela Markdown\n| **Responsável** | Tarefa | Prazo |\n| --- | --- | --- |'}
                        onChange={(e) => updateSection(section.uid, { item_format: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-gray-200 px-6 py-3">
          <p className="min-w-0 flex-1 text-sm text-red-600" role="alert">
            {visibleError}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Cancelar
            </Button>
            <Button variant="blue" onClick={handleSave} disabled={isSaving || isAiBusy}>
              {isSaving && <Loader2 className="animate-spin" />}
              Salvar modelo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
