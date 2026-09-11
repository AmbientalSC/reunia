/// Visual summary generation — the "second dispatch".
///
/// After the regular meeting summary completes, this module sends the generated
/// markdown back to the same LLM provider asking for a strict JSON payload that
/// the frontend renders as a visual dashboard (the "Tela" tab).
use crate::database::repositories::setting::SettingsRepository;
use crate::database::repositories::visual_summary::VisualSummariesRepository;
use crate::summary::llm_client::{self, LLMProvider};
use crate::summary::processor::language_name_from_code;
use once_cell::sync::Lazy;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

/// Event emitted to the frontend whenever the visual summary state changes.
pub const VISUAL_SUMMARY_EVENT: &str = "visual-summary-update";

// Active visual generation per meeting: (generation id, cancellation token).
// The generation id lets a superseded task detect it lost the race and skip
// its DB writes, so a slow stale LLM response can never overwrite a fresher one.
static VISUAL_TASKS: Lazy<Arc<Mutex<HashMap<String, (u64, CancellationToken)>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

/// Everything the LLM call needs, already resolved (API key, endpoints, limits).
#[derive(Debug, Clone)]
pub struct VisualLlmConfig {
    pub provider: LLMProvider,
    pub model_name: String,
    pub api_key: String,
    pub ollama_endpoint: Option<String>,
    pub custom_openai_endpoint: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub app_data_dir: Option<PathBuf>,
    /// Context budget in tokens for the target model; used to cap the input size.
    pub token_budget: usize,
}

/// Resolves provider configuration from the database for a standalone
/// (manually triggered) visual summary generation. The chained path inside
/// `SummaryService` builds `VisualLlmConfig` directly from its own resolved
/// values instead of calling this.
pub async fn resolve_visual_llm_config(
    pool: &SqlitePool,
    model_provider: &str,
    model_name: &str,
    app_data_dir: Option<PathBuf>,
) -> Result<VisualLlmConfig, String> {
    let provider = LLMProvider::from_str(model_provider)?;

    let api_key = if provider == LLMProvider::Ollama
        || provider == LLMProvider::BuiltInAI
        || provider == LLMProvider::CustomOpenAI
    {
        String::new()
    } else {
        match SettingsRepository::get_api_key(pool, model_provider).await {
            Ok(Some(key)) if !key.is_empty() => key,
            Ok(None) | Ok(Some(_)) => {
                return Err(format!("Chave de API não encontrada para {}", model_provider));
            }
            Err(e) => {
                return Err(format!(
                    "Falha ao recuperar a chave de API para {}: {}",
                    model_provider, e
                ));
            }
        }
    };

    let ollama_endpoint = if provider == LLMProvider::Ollama {
        match SettingsRepository::get_model_config(pool).await {
            Ok(Some(config)) => config.ollama_endpoint,
            Ok(None) => None,
            Err(e) => {
                info!("Failed to retrieve Ollama endpoint: {}, using default", e);
                None
            }
        }
    } else {
        None
    };

    let (custom_openai_endpoint, custom_api_key, max_tokens, temperature, top_p) =
        if provider == LLMProvider::CustomOpenAI {
            match SettingsRepository::get_custom_openai_config(pool).await {
                Ok(Some(config)) => (
                    Some(config.endpoint),
                    config.api_key,
                    config.max_tokens.map(|t| t as u32),
                    config.temperature,
                    config.top_p,
                ),
                Ok(None) => {
                    return Err(
                        "Provedor Custom OpenAI selecionado, mas nenhuma configuração foi encontrada"
                            .to_string(),
                    );
                }
                Err(e) => {
                    return Err(format!(
                        "Falha ao recuperar a configuração do Custom OpenAI: {}",
                        e
                    ));
                }
            }
        } else {
            (None, None, None, None, None)
        };

    let final_api_key = if provider == LLMProvider::CustomOpenAI {
        custom_api_key.unwrap_or_default()
    } else {
        api_key
    };

    // Conservative default budget; the input is the compact markdown summary,
    // so small local model contexts are the only real constraint here.
    let token_budget = if provider == LLMProvider::BuiltInAI {
        use crate::summary::summary_engine::models;
        models::get_model_by_name(model_name)
            .map(|m| (m.context_size as usize).saturating_sub(300))
            .unwrap_or(1748)
    } else if provider == LLMProvider::Ollama {
        4000
    } else {
        100000
    };

    Ok(VisualLlmConfig {
        provider,
        model_name: model_name.to_string(),
        api_key: final_api_key,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        token_budget,
    })
}

/// Cancels an in-flight visual summary generation, if any.
pub fn cancel_visual_summary(meeting_id: &str) -> bool {
    if let Ok(registry) = VISUAL_TASKS.lock() {
        if let Some((_, token)) = registry.get(meeting_id) {
            info!("Cancelling visual summary generation for meeting: {}", meeting_id);
            token.cancel();
            return true;
        }
    }
    false
}

/// Registers a new generation for the meeting, superseding (and cancelling)
/// any generation still in flight for it.
fn begin_generation(meeting_id: &str) -> (u64, CancellationToken) {
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    let token = CancellationToken::new();
    if let Ok(mut registry) = VISUAL_TASKS.lock() {
        if let Some((old_generation, old_token)) =
            registry.insert(meeting_id.to_string(), (generation, token.clone()))
        {
            info!(
                "Superseding in-flight visual summary generation {} for meeting: {}",
                old_generation, meeting_id
            );
            old_token.cancel();
        }
    }
    (generation, token)
}

/// Whether this generation is still the active one for the meeting.
fn is_current_generation(meeting_id: &str, generation: u64) -> bool {
    VISUAL_TASKS
        .lock()
        .map(|registry| {
            registry
                .get(meeting_id)
                .map_or(false, |(current, _)| *current == generation)
        })
        .unwrap_or(false)
}

/// Removes the registry entry, but only if it still belongs to this generation.
fn finish_generation(meeting_id: &str, generation: u64) {
    if let Ok(mut registry) = VISUAL_TASKS.lock() {
        let still_current = registry
            .get(meeting_id)
            .map_or(false, |(current, _)| *current == generation);
        if still_current {
            registry.remove(meeting_id);
        }
    }
}

fn build_system_prompt(language: Option<&str>) -> String {
    let language_instruction = match language.and_then(language_name_from_code) {
        Some(name) => format!("Write ALL string values in {}.", name),
        None => "Write ALL string values in the same language as the provided summary.".to_string(),
    };

    format!(
        r#"You are a meeting-visualization assistant. Convert a meeting summary into a strict JSON object used to render a visual dashboard.

Return ONLY a valid JSON object — no markdown, no code fences, no comments, no text before or after it.

Schema:
{{
  "tagline": string,
  "overview": string,
  "participants": string[],
  "highlights": string[],
  "decisions": string[],
  "action_items": [{{"task": string, "owner": string or null, "due": string or null}}],
  "topics": [{{"title": string, "summary": string}}],
  "quotes": [{{"text": string, "speaker": string or null}}]
}}

Field meanings:
- tagline: one short sentence capturing the essence of the meeting.
- overview: a 2-3 sentence overview of what happened.
- participants: names of people mentioned as present; [] if unknown.
- highlights: 3 to 6 key points.
- decisions: decisions that were made; [] if none.
- action_items: concrete follow-up tasks, with owner and due date when stated.
- topics: the main topics discussed, in the order they appear.
- quotes: up to 2 notable statements; [] if none stand out.

Rules:
- {language_instruction}
- Use only information from the provided summary; never invent facts.
- Copy every number, value, date, monetary amount, percentage, deadline, and proper name EXACTLY as written in the summary — never recalculate, round, convert, or rephrase them.
- Prefer reusing the summary's own wording (short literal excerpts) over paraphrasing; shorten by omitting words, not by rewriting them.
- Keep each string concise (at most ~200 characters).
- When a field has no information, use [] or null."#,
        language_instruction = language_instruction
    )
}

fn build_user_prompt(summary_markdown: &str, meeting_title: Option<&str>, token_budget: usize) -> String {
    // Reserve room for the system prompt and the JSON output; ~3 chars per token
    // is conservative for both English and Portuguese text.
    let char_budget = token_budget.saturating_sub(900).saturating_mul(3).max(2000);
    let trimmed: String = if summary_markdown.len() > char_budget {
        let mut cut = char_budget;
        while cut > 0 && !summary_markdown.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}\n[resumo truncado]", &summary_markdown[..cut])
    } else {
        summary_markdown.to_string()
    };

    match meeting_title {
        Some(title) if !title.trim().is_empty() => {
            format!("Meeting title: {}\n\nMeeting summary:\n{}", title, trimmed)
        }
        _ => format!("Meeting summary:\n{}", trimmed),
    }
}

/// Extracts the first JSON object from a raw LLM response, tolerating code
/// fences and stray prose around it.
fn extract_json_object(raw: &str) -> Result<serde_json::Value, String> {
    let start = raw
        .find('{')
        .ok_or_else(|| "A resposta do LLM não contém um objeto JSON".to_string())?;
    let end = raw
        .rfind('}')
        .filter(|&end| end > start)
        .ok_or_else(|| "A resposta do LLM contém um objeto JSON incompleto".to_string())?;

    let value: serde_json::Value = serde_json::from_str(&raw[start..=end])
        .map_err(|e| format!("Falha ao analisar o JSON da tela visual: {}", e))?;

    if value.is_object() {
        Ok(value)
    } else {
        Err("A resposta do LLM não é um objeto JSON".to_string())
    }
}

fn emit_status<R: tauri::Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    status: &str,
    error: Option<&str>,
) {
    let payload = serde_json::json!({
        "meeting_id": meeting_id,
        "status": status,
        "error": error,
    });
    if let Err(e) = app.emit(VISUAL_SUMMARY_EVENT, payload) {
        warn!("Failed to emit {} event: {}", VISUAL_SUMMARY_EVENT, e);
    }
}

/// Generates the visual summary in the background and persists the result.
///
/// Designed to be spawned with `tauri::async_runtime::spawn` — either chained
/// by `SummaryService` right after the regular summary completes, or triggered
/// manually through `api_generate_visual_summary`.
pub async fn generate_visual_summary_background<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: SqlitePool,
    meeting_id: String,
    summary_markdown: String,
    meeting_title: Option<String>,
    summary_language: Option<String>,
    config: VisualLlmConfig,
) {
    info!("Starting visual summary generation for meeting_id: {}", meeting_id);

    // Register before any await so a cancel/supersede can never miss this task
    let (generation, cancellation_token) = begin_generation(&meeting_id);

    if let Err(e) = VisualSummariesRepository::create_or_reset(&pool, &meeting_id).await {
        error!("Failed to initialize visual summary row for {}: {}", meeting_id, e);
        finish_generation(&meeting_id, generation);
        return;
    }
    emit_status(&app, &meeting_id, "processing", None);

    let system_prompt = build_system_prompt(summary_language.as_deref());
    let user_prompt = build_user_prompt(
        &summary_markdown,
        meeting_title.as_deref(),
        config.token_budget,
    );

    let client = reqwest::Client::new();
    let result = llm_client::generate_summary(
        &client,
        &config.provider,
        &config.model_name,
        &config.api_key,
        &system_prompt,
        &user_prompt,
        config.ollama_endpoint.as_deref(),
        config.custom_openai_endpoint.as_deref(),
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.app_data_dir.as_ref(),
        Some(&cancellation_token),
    )
    .await;

    // A newer generation may have superseded this one while the LLM call was
    // in flight; if so, it owns the row now — skip all writes and events.
    if !is_current_generation(&meeting_id, generation) {
        info!(
            "Visual summary generation {} for meeting {} was superseded; discarding result",
            generation, meeting_id
        );
        return;
    }
    finish_generation(&meeting_id, generation);

    match result.and_then(|raw| extract_json_object(&raw)) {
        Ok(data) => {
            if let Err(e) =
                VisualSummariesRepository::update_completed(&pool, &meeting_id, &data).await
            {
                error!("Failed to save visual summary for {}: {}", meeting_id, e);
                emit_status(&app, &meeting_id, "failed", Some("Falha ao salvar a tela visual"));
                return;
            }
            info!("Visual summary saved for meeting_id: {}", meeting_id);
            emit_status(&app, &meeting_id, "completed", None);
        }
        Err(e) => {
            if e.contains("cancelada") || e.contains("cancelled") {
                info!("Visual summary generation cancelled for meeting_id: {}", meeting_id);
                if let Err(db_err) =
                    VisualSummariesRepository::update_cancelled(&pool, &meeting_id).await
                {
                    error!(
                        "Failed to mark visual summary cancelled for {}: {}",
                        meeting_id, db_err
                    );
                }
                emit_status(&app, &meeting_id, "cancelled", None);
            } else {
                error!("Visual summary generation failed for {}: {}", meeting_id, e);
                if let Err(db_err) =
                    VisualSummariesRepository::update_failed(&pool, &meeting_id, &e).await
                {
                    error!(
                        "Failed to mark visual summary failed for {}: {}",
                        meeting_id, db_err
                    );
                }
                emit_status(&app, &meeting_id, "failed", Some(&e));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_plain_json_object() {
        let raw = r#"{"tagline": "ok", "highlights": []}"#;
        let value = extract_json_object(raw).unwrap();
        assert_eq!(value["tagline"], "ok");
    }

    #[test]
    fn extracts_json_wrapped_in_code_fences() {
        let raw = "```json\n{\"tagline\": \"ok\"}\n```";
        let value = extract_json_object(raw).unwrap();
        assert_eq!(value["tagline"], "ok");
    }

    #[test]
    fn extracts_json_with_surrounding_prose() {
        let raw = "Here is the JSON you asked for:\n{\"tagline\": \"ok\"}\nHope it helps!";
        let value = extract_json_object(raw).unwrap();
        assert_eq!(value["tagline"], "ok");
    }

    #[test]
    fn rejects_response_without_json() {
        assert!(extract_json_object("no json here").is_err());
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(extract_json_object("{\"tagline\": }").is_err());
    }

    #[test]
    fn rejects_incomplete_object() {
        assert!(extract_json_object("prefix } suffix {").is_err());
    }

    #[test]
    fn user_prompt_truncates_oversized_summaries() {
        let long_summary = "a".repeat(50_000);
        let prompt = build_user_prompt(&long_summary, None, 2000);
        assert!(prompt.len() < long_summary.len());
        assert!(prompt.contains("[resumo truncado]"));
    }

    #[test]
    fn user_prompt_keeps_small_summaries_intact() {
        let prompt = build_user_prompt("## Decisões\n- Aprovado", Some("Reunião"), 100000);
        assert!(prompt.contains("Meeting title: Reunião"));
        assert!(prompt.contains("## Decisões"));
        assert!(!prompt.contains("[resumo truncado]"));
    }

    #[test]
    fn system_prompt_names_target_language() {
        let prompt = build_system_prompt(Some("pt"));
        assert!(prompt.contains("Portuguese"));
    }

    #[test]
    fn system_prompt_falls_back_to_summary_language() {
        let prompt = build_system_prompt(None);
        assert!(prompt.contains("same language as the provided summary"));
    }

    #[test]
    fn system_prompt_enforces_verbatim_values() {
        // Guards the no-divergence rule: figures and names must be copied
        // exactly from the summary, never recalculated or rephrased.
        let prompt = build_system_prompt(None);
        assert!(prompt.contains("EXACTLY as written in the summary"));
        assert!(prompt.contains("never recalculate"));
    }
}
