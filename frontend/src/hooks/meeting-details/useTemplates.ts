import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { templateService } from '@/services/templateService';
import { DEFAULT_TEMPLATE_ID, TemplateInfo, TemplatesChange } from '@/types/template';

export function useTemplates() {
  const [availableTemplates, setAvailableTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(DEFAULT_TEMPLATE_ID);

  // Reload the list; if the selected template no longer exists (e.g. it was
  // deleted), fall back to the default one.
  const refreshTemplates = useCallback(async () => {
    try {
      const templates = await templateService.list();
      setAvailableTemplates(templates);
      setSelectedTemplate((current) =>
        templates.some((template) => template.id === current) ? current : DEFAULT_TEMPLATE_ID
      );
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    }
  }, []);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  // Handle template selection
  const handleTemplateSelection = useCallback((templateId: string, templateName: string) => {
    setSelectedTemplate(templateId);
    toast.success('Template selecionado', {
      description: `Usando o template "${templateName}" para geração de resumo`,
    });
    Analytics.trackFeatureUsed('template_selected');
  }, []);

  // Keep the dropdown in sync with edits made in the template manager. A
  // template that was just created or edited becomes the selected one.
  const handleTemplatesChange = useCallback(
    async (change: TemplatesChange) => {
      if (change.type === 'saved') {
        setSelectedTemplate(change.template.id);
      }
      await refreshTemplates();
    },
    [refreshTemplates]
  );

  return {
    availableTemplates,
    selectedTemplate,
    handleTemplateSelection,
    handleTemplatesChange,
  };
}
