"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useConfig } from '@/contexts/ConfigContext';
import Analytics from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { templateService } from '@/services/templateService';
import {
  TEMPLATE_LIMITS,
  TemplateDraft,
  TemplateFull,
  TemplateInfo,
  TemplatesChange,
} from '@/types/template';
import { TemplateEditorDialog } from './TemplateEditorDialog';
import { NEW_TEMPLATE_DRAFT } from './templateForm';

const COPY_SUFFIX = ' (cópia)';

interface EditorState {
  title: string;
  /** Custom template being edited; null when creating a new one. */
  templateId: string | null;
  draft: TemplateDraft;
}

function toDraft(template: TemplateFull, nameOverride?: string): TemplateDraft {
  return {
    name: nameOverride ?? template.name,
    description: template.description,
    sections: template.sections,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return typeof error === 'string' ? error : fallback;
}

interface TemplateManagerProps {
  /** Called after a template was saved or deleted, so other lists can refresh. */
  onChange?: (change: TemplatesChange) => void | Promise<void>;
  className?: string;
}

/** Lists summary templates and lets the user create, edit, duplicate and delete their own. */
export function TemplateManager({ onChange, className }: TemplateManagerProps) {
  const { modelConfig } = useConfig();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TemplateInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      setTemplates(await templateService.list());
      setLoadError(null);
    } catch (error) {
      console.error('Failed to load templates:', error);
      setLoadError('Não foi possível carregar os modelos.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The user's own templates come first.
  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => Number(b.is_custom) - Number(a.is_custom)),
    [templates]
  );
  const hasCustomTemplates = templates.some((template) => template.is_custom);

  // The AI assistant uses the same model that generates the minutes.
  const aiModel =
    modelConfig.provider && modelConfig.model
      ? { provider: modelConfig.provider, model: modelConfig.model }
      : null;

  const openEditorFor = async (
    template: TemplateInfo,
    buildState: (full: TemplateFull) => EditorState
  ) => {
    try {
      setEditor(buildState(await templateService.get(template.id)));
    } catch (error) {
      console.error('Failed to load template for editing:', error);
      toast.error('Não foi possível abrir o modelo', {
        description: errorMessage(error, 'Tente novamente.'),
      });
    }
  };

  const handleEdit = (template: TemplateInfo) =>
    openEditorFor(template, (full) => ({
      title: 'Editar modelo',
      templateId: template.id,
      draft: toDraft(full),
    }));

  const handleDuplicate = (template: TemplateInfo) =>
    openEditorFor(template, (full) => ({
      title: 'Duplicar modelo',
      templateId: null,
      draft: toDraft(
        full,
        `${full.name.slice(0, TEMPLATE_LIMITS.name - COPY_SUFFIX.length)}${COPY_SUFFIX}`
      ),
    }));

  const handleSaved = async (template: TemplateInfo) => {
    setEditor(null);
    toast.success('Modelo salvo', { description: `"${template.name}" está pronto para uso.` });
    Analytics.trackFeatureUsed('custom_template_saved');
    await reload();
    await onChange?.({ type: 'saved', template });
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setIsDeleting(true);
    try {
      await templateService.remove(pendingDelete.id);
      toast.success('Modelo excluído');
      Analytics.trackFeatureUsed('custom_template_deleted');
      const deletedId = pendingDelete.id;
      setPendingDelete(null);
      await reload();
      await onChange?.({ type: 'deleted', id: deletedId });
    } catch (error) {
      console.error('Failed to delete template:', error);
      toast.error('Não foi possível excluir o modelo', {
        description: errorMessage(error, 'Tente novamente.'),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {hasCustomTemplates || isLoading
            ? 'Seus modelos aparecem primeiro. Modelos padrão podem ser duplicados para personalização.'
            : 'Você ainda não criou modelos próprios. Crie um do zero ou duplique um modelo padrão.'}
        </p>
        <Button
          variant="blue"
          size="sm"
          className="shrink-0"
          onClick={() =>
            setEditor({ title: 'Novo modelo', templateId: null, draft: NEW_TEMPLATE_DRAFT })
          }
        >
          <Plus />
          Novo modelo
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-gray-500">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : loadError ? (
        <p className="py-4 text-sm text-red-600" role="alert">
          {loadError}
        </p>
      ) : (
        <ul className={cn('space-y-2', className)}>
          {sortedTemplates.map((template) => (
            <li
              key={template.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-gray-900">{template.name}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                      template.is_custom
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-gray-100 text-gray-500'
                    )}
                  >
                    {template.is_custom ? 'Personalizado' : 'Padrão'}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-gray-600">{template.description}</p>
              </div>

              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Duplicar"
                  aria-label={`Duplicar o modelo ${template.name}`}
                  onClick={() => handleDuplicate(template)}
                >
                  <Copy />
                </Button>
                {template.is_custom && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Editar"
                      aria-label={`Editar o modelo ${template.name}`}
                      onClick={() => handleEdit(template)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Excluir"
                      aria-label={`Excluir o modelo ${template.name}`}
                      className="text-red-600 hover:text-red-700"
                      onClick={() => setPendingDelete(template)}
                    >
                      <Trash2 />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor && (
        <TemplateEditorDialog
          title={editor.title}
          templateId={editor.templateId}
          initialDraft={editor.draft}
          aiModel={aiModel}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && !isDeleting && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir modelo</DialogTitle>
            <DialogDescription>
              O modelo &quot;{pendingDelete?.name}&quot; será excluído. Resumos já gerados com ele
              não são alterados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={isDeleting}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting && <Loader2 className="animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
