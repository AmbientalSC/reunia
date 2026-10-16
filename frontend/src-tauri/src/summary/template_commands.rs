use crate::state::AppState;
use crate::summary::template_assistant::{self, SectionContext};
use crate::summary::templates::{self, Template, TemplateSection};
use crate::summary::visual::{self, VisualLlmConfig};
use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime};
use tracing::{info, warn};

/// Template metadata for UI display
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateInfo {
    /// Template identifier (e.g., "daily_standup", "standard_meeting")
    pub id: String,

    /// Display name for the template
    pub name: String,

    /// Brief description of the template's purpose
    pub description: String,

    /// True for user-created templates, which can be edited and deleted
    pub is_custom: bool,
}

/// Complete template content, used to populate the template editor
#[derive(Debug, Serialize)]
pub struct TemplateFull {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sections: Vec<TemplateSection>,
    pub is_custom: bool,
}

/// Detailed template structure for preview/debugging
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateDetails {
    /// Template identifier
    pub id: String,

    /// Display name
    pub name: String,

    /// Description
    pub description: String,

    /// List of section titles in order
    pub sections: Vec<String>,
}

/// Lists all available templates
///
/// Returns templates from both built-in (embedded) and custom (user data directory) sources.
/// Templates are automatically discovered - no code changes needed to add new templates.
///
/// # Returns
/// Vector of TemplateInfo with id, name, and description for each template
#[tauri::command]
pub async fn api_list_templates<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<Vec<TemplateInfo>, String> {
    info!("api_list_templates called");

    let templates = templates::list_templates();

    let template_infos: Vec<TemplateInfo> = templates
        .into_iter()
        .map(|(id, name, description)| TemplateInfo {
            is_custom: templates::is_custom_template(&id),
            id,
            name,
            description,
        })
        .collect();

    info!("Found {} available templates", template_infos.len());

    Ok(template_infos)
}

/// Gets detailed information about a specific template
///
/// # Arguments
/// * `template_id` - Template identifier (e.g., "daily_standup")
///
/// # Returns
/// TemplateDetails with full template structure
#[tauri::command]
pub async fn api_get_template_details<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
) -> Result<TemplateDetails, String> {
    info!("api_get_template_details called for template_id: {}", template_id);

    let template = templates::get_template(&template_id)?;

    let section_titles: Vec<String> = template
        .sections
        .iter()
        .map(|section| section.title.clone())
        .collect();

    let details = TemplateDetails {
        id: template_id,
        name: template.name,
        description: template.description,
        sections: section_titles,
    };

    info!("Retrieved template details for '{}'", details.name);

    Ok(details)
}

/// Gets the complete content of a template (all sections), for editing or duplicating
///
/// # Arguments
/// * `template_id` - Template identifier
#[tauri::command]
pub async fn api_get_template(template_id: String) -> Result<TemplateFull, String> {
    info!("api_get_template called for template_id: {:?}", template_id);

    let template = templates::get_template(&template_id)?;

    Ok(TemplateFull {
        is_custom: templates::is_custom_template(&template_id),
        id: template_id,
        name: template.name,
        description: template.description,
        sections: template.sections,
    })
}

/// Creates or updates a user template
///
/// # Arguments
/// * `template_id` - `None` creates a new template (id generated from its name);
///   `Some(id)` updates the existing custom template with that id
/// * `template` - Template content; validated before anything is written
///
/// # Returns
/// TemplateInfo of the saved template
#[tauri::command]
pub async fn api_save_custom_template(
    template_id: Option<String>,
    template: Template,
) -> Result<TemplateInfo, String> {
    // The name is not validated yet: log it escaped and truncated.
    info!(
        "api_save_custom_template called (template_id: {:?}, name: {:?})",
        template_id,
        template.name.chars().take(80).collect::<String>()
    );

    let id = templates::save_custom_template(template_id.as_deref(), &template)
        .map_err(|e| {
            warn!("Failed to save custom template: {}", e);
            e
        })?;

    let saved = templates::get_template(&id)?;

    Ok(TemplateInfo {
        id,
        name: saved.name,
        description: saved.description,
        is_custom: true,
    })
}

/// Deletes a user template. Built-in templates cannot be deleted.
///
/// # Arguments
/// * `template_id` - Identifier of the custom template to delete
#[tauri::command]
pub async fn api_delete_custom_template(template_id: String) -> Result<(), String> {
    info!("api_delete_custom_template called for template_id: {:?}", template_id);

    templates::delete_custom_template(&template_id).map_err(|e| {
        warn!("Failed to delete custom template {:?}: {}", template_id, e);
        e
    })
}

/// Resolves the user's configured summary model (API keys, endpoints) for the
/// template assistant, the same way the other one-shot LLM commands do.
async fn resolve_assistant_config<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &tauri::State<'_, AppState>,
    model: &str,
    model_name: &str,
) -> Result<VisualLlmConfig, String> {
    if model.trim().is_empty() || model_name.trim().is_empty() {
        return Err(
            "Nenhum modelo de IA configurado. Configure um em Configurações > Resumo.".to_string(),
        );
    }

    let session = state.require_auth()?;
    visual::resolve_visual_llm_config(
        state.db_manager.pool(),
        model,
        model_name,
        app.path().app_data_dir().ok(),
        session.groq_api_key,
    )
    .await
}

/// Asks the AI to draft a whole template from a free-text description
///
/// # Arguments
/// * `description` - What the user wants (e.g. "ata de reunião de condomínio")
/// * `model` / `model_name` - Provider and model configured for summaries
///
/// # Returns
/// A validated template; nothing is saved until the user saves the editor form
#[tauri::command]
pub async fn api_ai_generate_template<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    description: String,
    model: String,
    model_name: String,
) -> Result<Template, String> {
    info!("api_ai_generate_template called (provider: {:?})", model);

    let config = resolve_assistant_config(&app, &state, &model, &model_name).await?;
    template_assistant::generate_template(&config, &description)
        .await
        .map_err(|e| {
            warn!("AI template generation failed: {}", e);
            e
        })
}

/// Asks the AI to rewrite the instruction ("prompt") of one template section
///
/// # Arguments
/// * `template_name` / `template_description` - Context from the editor form (may be empty)
/// * `section_title` / `section_format` / `instruction` - The section being improved
/// * `model` / `model_name` - Provider and model configured for summaries
///
/// # Returns
/// The suggested single-line instruction
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn api_ai_improve_instruction<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    template_name: String,
    template_description: String,
    section_title: String,
    section_format: String,
    instruction: String,
    model: String,
    model_name: String,
) -> Result<String, String> {
    info!("api_ai_improve_instruction called (provider: {:?})", model);

    let config = resolve_assistant_config(&app, &state, &model, &model_name).await?;
    let context = SectionContext {
        template_name: &template_name,
        template_description: &template_description,
        section_title: &section_title,
        section_format: &section_format,
        instruction: &instruction,
    };

    template_assistant::improve_instruction(&config, &context)
        .await
        .map_err(|e| {
            warn!("AI instruction improvement failed: {}", e);
            e
        })
}

/// Validates a custom template JSON string
///
/// Useful for template editor UI or validation before saving custom templates
///
/// # Arguments
/// * `template_json` - Raw JSON string of the template
///
/// # Returns
/// Ok(template_name) if valid, Err(error_message) if invalid
#[tauri::command]
pub async fn api_validate_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_json: String,
) -> Result<String, String> {
    info!("api_validate_template called");

    match templates::validate_and_parse_template(&template_json) {
        Ok(template) => {
            info!("Template '{}' validated successfully", template.name);
            Ok(template.name)
        }
        Err(e) => {
            warn!("Template validation failed: {}", e);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_list_templates() {
        // This test requires the templates to be embedded/available
        // In a real test environment, you might want to mock the templates module

        // For now, just verify the function compiles and runs
        // You can expand this with more specific assertions
    }

    #[tokio::test]
    async fn test_validate_template_valid() {
        let valid_json = r#"
        {
            "name": "Test Template",
            "description": "A test template",
            "sections": [
                {
                    "title": "Summary",
                    "instruction": "Provide a summary",
                    "format": "paragraph"
                }
            ]
        }"#;

        // Mock app handle would be needed for actual testing
        // For now, test the validation logic directly
        let result = templates::validate_and_parse_template(valid_json);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_validate_template_invalid() {
        let invalid_json = "invalid json";

        let result = templates::validate_and_parse_template(invalid_json);
        assert!(result.is_err());
    }
}
