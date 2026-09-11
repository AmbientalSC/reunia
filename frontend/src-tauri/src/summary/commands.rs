use crate::database::repositories::{
    meeting::MeetingsRepository,
    summary::SummaryProcessesRepository, transcript_chunk::TranscriptChunksRepository,
    visual_summary::VisualSummariesRepository,
};
use crate::state::AppState;
use crate::summary::metadata::{
    read_detected_summary_language_from_metadata, read_summary_language_from_metadata,
    write_detected_summary_language_to_metadata, write_summary_language_to_metadata,
};
use crate::summary::language_detection::{
    detect_summary_language, SummaryLanguageDetection,
};
use crate::summary::service::SummaryService;
use log::{error as log_error, info as log_info, warn as log_warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Serialize, Deserialize)]
pub struct SummaryResponse {
    pub status: String,
    #[serde(rename = "meetingName")]
    pub meeting_name: Option<String>,
    pub meeting_id: String,
    pub start: Option<String>,
    pub end: Option<String>,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessTranscriptResponse {
    pub message: String,
    pub process_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VisualSummaryResponse {
    pub status: String,
    pub meeting_id: String,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SummaryLanguageStorage {
    Metadata,
    LocalFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSummaryLanguagePreference {
    pub language: Option<String>,
    pub storage: SummaryLanguageStorage,
}

impl MeetingSummaryLanguagePreference {
    fn metadata(language: Option<String>) -> Self {
        Self {
            language,
            storage: SummaryLanguageStorage::Metadata,
        }
    }

    fn local_fallback() -> Self {
        Self {
            language: None,
            storage: SummaryLanguageStorage::LocalFallback,
        }
    }
}

enum MeetingFolderResolution {
    Folder(PathBuf),
    NoFolder,
}

/// Saves a meeting summary (Native SQLx implementation)
///
/// Expected format: { "markdown": "...", "summary_json": [...BlockNote blocks...] }
#[tauri::command]
pub async fn api_save_meeting_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    summary: serde_json::Value,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_meeting_summary (native) called for meeting_id: {}",
        meeting_id
    );
    let pool = state.db_manager.pool();

    match SummaryProcessesRepository::update_meeting_summary(pool, &meeting_id, &summary).await {
        Ok(true) => {
            log_info!("Summary saved successfully for meeting_id: {}", meeting_id);
            Ok(serde_json::json!({
                "message": "Resumo da reunião salvo com sucesso"
            }))
        }
        Ok(false) => {
            log_warn!(
                "Meeting not found or invalid JSON for meeting_id: {}",
                meeting_id
            );
            Err("Reunião não encontrada ou não foi possível converter o JSON".into())
        }
        Err(e) => {
            log_error!("Failed to save meeting summary for {}: {}", meeting_id, e);
            Err(e.to_string())
        }
    }
}

/// Gets the per-meeting summary language override from metadata.json.
#[tauri::command]
pub async fn api_get_meeting_summary_language<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<MeetingSummaryLanguagePreference, String> {
    log_info!(
        "api_get_meeting_summary_language called for meeting_id: {}",
        meeting_id
    );

    match resolve_meeting_folder(state.db_manager.pool(), &meeting_id).await? {
        MeetingFolderResolution::Folder(folder) => read_summary_language_from_metadata(&folder)
            .map(MeetingSummaryLanguagePreference::metadata)
            .map_err(|e| e.to_string()),
        MeetingFolderResolution::NoFolder => Ok(MeetingSummaryLanguagePreference::local_fallback()),
    }
}

/// Saves or clears the per-meeting summary language override in metadata.json.
#[tauri::command]
pub async fn api_save_meeting_summary_language<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    summary_language: Option<String>,
) -> Result<MeetingSummaryLanguagePreference, String> {
    log_info!(
        "api_save_meeting_summary_language called for meeting_id: {}, language: {:?}",
        meeting_id,
        summary_language
    );

    match resolve_meeting_folder(state.db_manager.pool(), &meeting_id).await? {
        MeetingFolderResolution::Folder(folder) => {
            write_summary_language_to_metadata(&folder, summary_language.as_deref())
                .map_err(|e| e.to_string())?;
            read_summary_language_from_metadata(&folder)
                .map(MeetingSummaryLanguagePreference::metadata)
                .map_err(|e| e.to_string())
        }
        MeetingFolderResolution::NoFolder => Ok(MeetingSummaryLanguagePreference::local_fallback()),
    }
}

/// Gets the cached Auto-detected summary language from metadata.json.
#[tauri::command]
pub async fn api_get_meeting_detected_summary_language<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<MeetingSummaryLanguagePreference, String> {
    log_info!(
        "api_get_meeting_detected_summary_language called for meeting_id: {}",
        meeting_id
    );

    match resolve_meeting_folder(state.db_manager.pool(), &meeting_id).await? {
        MeetingFolderResolution::Folder(folder) => read_detected_summary_language_from_metadata(&folder)
            .map(MeetingSummaryLanguagePreference::metadata)
            .map_err(|e| e.to_string()),
        MeetingFolderResolution::NoFolder => Ok(MeetingSummaryLanguagePreference::local_fallback()),
    }
}

/// Saves or clears the cached Auto-detected summary language in metadata.json.
#[tauri::command]
pub async fn api_save_meeting_detected_summary_language<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    detected_summary_language: Option<String>,
) -> Result<MeetingSummaryLanguagePreference, String> {
    log_info!(
        "api_save_meeting_detected_summary_language called for meeting_id: {}, language: {:?}",
        meeting_id,
        detected_summary_language
    );

    match resolve_meeting_folder(state.db_manager.pool(), &meeting_id).await? {
        MeetingFolderResolution::Folder(folder) => {
            write_detected_summary_language_to_metadata(&folder, detected_summary_language.as_deref())
                .map_err(|e| e.to_string())?;
            read_detected_summary_language_from_metadata(&folder)
                .map(MeetingSummaryLanguagePreference::metadata)
                .map_err(|e| e.to_string())
        }
        MeetingFolderResolution::NoFolder => Ok(MeetingSummaryLanguagePreference::local_fallback()),
    }
}

/// Detects the dominant supported summary language from transcript segments.
#[tauri::command]
pub async fn api_detect_transcript_summary_language(
    transcript_texts: Vec<String>,
) -> Result<SummaryLanguageDetection, String> {
    Ok(detect_summary_language(&transcript_texts))
}

/// Generates a lightweight, real-time insight from a recent window of the
/// in-progress transcript. Separate from the post-meeting summary/report
/// pipeline above: no chunking, no persistence — a single LLM call, result
/// returned directly to the caller.
#[tauri::command]
pub async fn api_generate_live_insight<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    text: String,
    model: String,
    model_name: String,
) -> Result<crate::summary::live_insight::LiveInsightData, String> {
    use crate::summary::visual;
    use tauri::Manager;

    log_info!(
        "api_generate_live_insight called (provider: {}, model: {}, chars: {})",
        model,
        model_name,
        text.len()
    );

    let pool = state.db_manager.pool();
    let app_data_dir = app.path().app_data_dir().ok();
    let config = visual::resolve_visual_llm_config(pool, &model, &model_name, app_data_dir).await?;

    crate::summary::live_insight::generate_live_insight(
        &config.provider,
        &config.model_name,
        &config.api_key,
        config.ollama_endpoint.as_deref(),
        config.custom_openai_endpoint.as_deref(),
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.app_data_dir.as_ref(),
        &text,
        config.token_budget,
    )
    .await
}

async fn resolve_meeting_folder(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<MeetingFolderResolution, String> {
    let meeting = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .map_err(|e| format!("Falha ao carregar os metadados da reunião: {}", e))?
        .ok_or_else(|| format!("Reunião não encontrada: {}", meeting_id))?;

    let Some(folder_path) = meeting.folder_path.filter(|p| !p.trim().is_empty()) else {
        return Ok(MeetingFolderResolution::NoFolder);
    };

    Ok(MeetingFolderResolution::Folder(PathBuf::from(folder_path)))
}

/// Gets summary status and data (Native SQLx implementation)
///
/// Returns summary status (pending/processing/completed/failed) and parsed result data
#[tauri::command]
pub async fn api_get_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    _auth_token: Option<String>,
) -> Result<SummaryResponse, String> {
    log_info!(
        "api_get_summary (native) called for meeting_id: {}",
        meeting_id
    );
    let pool = state.db_manager.pool();

    match SummaryProcessesRepository::get_summary_data_for_meeting(pool, &meeting_id).await {
        Ok(Some(process)) => {
            let status = process.status.to_lowercase();
            let error = process.error;

            // Parse result data if it exists (regardless of status)
            // This allows displaying restored summaries after cancellation or failure
            let data = if let Some(result_str) = process.result {
                match serde_json::from_str::<serde_json::Value>(&result_str) {
                    Ok(parsed) => Some(parsed),
                    Err(e) => {
                        log_error!("Failed to parse summary result JSON: {}", e);
                        None
                    }
                }
            } else {
                None
            };

            // Fetch meeting title from database
            let meeting_name = match MeetingsRepository::get_meeting(pool, &meeting_id).await {
                Ok(Some(meeting_details)) => {
                    log_info!("Fetched meeting title: {}", &meeting_details.title);
                    Some(meeting_details.title)
                }
                Ok(None) => {
                    log_warn!("Meeting not found for meeting_id: {}", meeting_id);
                    None
                }
                Err(e) => {
                    log_error!("Failed to fetch meeting title: {}", e);
                    None
                }
            };

            let response = SummaryResponse {
                status: status.clone(),
                meeting_name,
                meeting_id: meeting_id.clone(),
                start: process.start_time.map(|t| t.to_rfc3339()),
                end: process.end_time.map(|t| t.to_rfc3339()),
                data,
                error,
            };

            log_info!(
                "Summary status for {}: {}, has_data: {}, meeting_name: {:?}",
                meeting_id,
                status,
                response.data.is_some(),
                response.meeting_name
            );
            Ok(response)
        }
        Ok(None) => {
            log_info!("No summary process found for meeting_id: {}", meeting_id);

            // Still fetch meeting title for idle state
            let meeting_name = match MeetingsRepository::get_meeting(pool, &meeting_id).await {
                Ok(Some(meeting_details)) => Some(meeting_details.title),
                _ => None,
            };

            Ok(SummaryResponse {
                status: "idle".to_string(),
                meeting_name,
                meeting_id,
                start: None,
                end: None,
                data: None,
                error: None,
            })
        }
        Err(e) => {
            log_error!("Error retrieving summary for {}: {}", meeting_id, e);
            Err(format!("Falha ao recuperar o resumo: {}", e))
        }
    }
}

/// Processes transcript and generates summary (Native SQLx implementation)
///
/// Spawns a background task and returns immediately with process_id
#[tauri::command]
pub async fn api_process_transcript<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    text: String,
    model: String,
    model_name: String,
    meeting_id: Option<String>,
    _chunk_size: Option<i32>,
    _overlap: Option<i32>,
    custom_prompt: Option<String>,
    template_id: Option<String>,
    summary_language: Option<String>,
    _auth_token: Option<String>,
) -> Result<ProcessTranscriptResponse, String> {
    use uuid::Uuid;

    let m_id = meeting_id.unwrap_or_else(|| format!("meeting-{}", Uuid::new_v4()));
    log_info!(
        "api_process_transcript (native) called for meeting_id: {}, model: {}",
        &m_id,
        &model
    );

    let pool = state.db_manager.pool().clone();
    let final_prompt = custom_prompt.unwrap_or_else(|| "".to_string());
    let final_template_id = template_id.unwrap_or_else(|| "daily_standup".to_string());

    // Normalise empty / whitespace-only to None so "" and null behave identically
    let summary_language = summary_language.and_then(|s| {
        let t = s.trim();
        if t.is_empty() { None } else { Some(t.to_string()) }
    });

    // Create or reset the process entry in the database
    SummaryProcessesRepository::create_or_reset_process(&pool, &m_id)
        .await
        .map_err(|e| format!("Falha ao inicializar o processo: {}", e))?;

    log_info!("✓ Summary process initialized for meeting_id: {}", &m_id);

    // Save transcript chunks data (matching Python backend behavior)
    let chunk_size = _chunk_size.unwrap_or(40000);
    let overlap = _overlap.unwrap_or(1000);

    TranscriptChunksRepository::save_transcript_data(
        &pool,
        &m_id,
        &text,
        &model,
        &model_name,
        chunk_size,
        overlap,
    )
    .await
    .map_err(|e| format!("Falha ao salvar os dados da transcrição: {}", e))?;

    log_info!("✓ Transcript chunks saved for meeting_id: {}", &m_id);

    // Spawn background task for actual processing
    let meeting_id_clone = m_id.clone();
    tauri::async_runtime::spawn(async move {
        SummaryService::process_transcript_background(
            app,
            pool,
            meeting_id_clone.clone(),
            text,
            model,
            model_name,
            final_prompt,
            final_template_id,
            summary_language,
        )
        .await;
    });

    log_info!("🚀 Background task spawned for meeting_id: {}", &m_id);

    Ok(ProcessTranscriptResponse {
        message: "Geração de resumo iniciada".to_string(),
        process_id: m_id,
    })
}

/// Retrieves the visual summary ("Tela") state and data for a meeting
#[tauri::command]
pub async fn api_get_visual_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<VisualSummaryResponse, String> {
    let pool = state.db_manager.pool();

    match VisualSummariesRepository::get(pool, &meeting_id).await {
        Ok(Some(row)) => {
            let data = row.result.as_deref().and_then(|raw| {
                match serde_json::from_str::<serde_json::Value>(raw) {
                    Ok(parsed) => Some(parsed),
                    Err(e) => {
                        log_error!("Failed to parse visual summary JSON for {}: {}", meeting_id, e);
                        None
                    }
                }
            });
            Ok(VisualSummaryResponse {
                status: row.status.to_lowercase(),
                meeting_id,
                data,
                error: row.error,
                updated_at: Some(row.updated_at.to_rfc3339()),
            })
        }
        Ok(None) => Ok(VisualSummaryResponse {
            status: "idle".to_string(),
            meeting_id,
            data: None,
            error: None,
            updated_at: None,
        }),
        Err(e) => {
            log_error!("Error retrieving visual summary for {}: {}", meeting_id, e);
            Err(format!("Falha ao recuperar a tela visual: {}", e))
        }
    }
}

/// Manually triggers the visual summary ("Tela") generation from the already
/// generated meeting summary. Used for meetings that predate the chained
/// generation and as the retry path after a failure.
#[tauri::command]
pub async fn api_generate_visual_summary<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    model: String,
    model_name: String,
) -> Result<serde_json::Value, String> {
    use crate::summary::visual;
    use tauri::Manager;

    log_info!(
        "api_generate_visual_summary called for meeting_id: {}, model: {}",
        meeting_id,
        model
    );
    let pool = state.db_manager.pool();

    // The visual summary is derived from the regular summary markdown
    let process = SummaryProcessesRepository::get_summary_data(pool, &meeting_id)
        .await
        .map_err(|e| format!("Falha ao carregar o resumo: {}", e))?
        .ok_or_else(|| "Gere o resumo da reunião antes de gerar a tela visual".to_string())?;

    let summary_markdown = process
        .result
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|value| value.get("markdown").and_then(|m| m.as_str()).map(str::to_string))
        .filter(|markdown| !markdown.trim().is_empty())
        .ok_or_else(|| {
            "Nenhum resumo em markdown disponível. Regenere o resumo da reunião primeiro."
                .to_string()
        })?;

    let meeting_title = MeetingsRepository::get_meeting(pool, &meeting_id)
        .await
        .ok()
        .flatten()
        .map(|m| m.title);

    let app_data_dir = app.path().app_data_dir().ok();
    let config = visual::resolve_visual_llm_config(pool, &model, &model_name, app_data_dir).await?;

    let pool_clone = pool.clone();
    tauri::async_runtime::spawn(visual::generate_visual_summary_background(
        app.clone(),
        pool_clone,
        meeting_id.clone(),
        summary_markdown,
        meeting_title,
        None,
        config,
    ));

    Ok(serde_json::json!({
        "message": "Geração da tela visual iniciada",
        "meeting_id": meeting_id,
    }))
}

/// Cancels an ongoing summary generation process
///
/// This command triggers the cancellation token for the specified meeting,
/// stopping the summary generation gracefully.
#[tauri::command]
pub async fn api_cancel_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<serde_json::Value, String> {
    log_info!("api_cancel_summary called for meeting_id: {}", meeting_id);

    // Trigger cancellation via the service (main summary + chained visual)
    let outcome = SummaryService::cancel_summary(&meeting_id);

    // Only touch summary_processes when the MAIN generation was cancelled.
    // Cancelling just the chained visual task must not flip an
    // already-completed summary to 'cancelled'; the visual task updates
    // its own visual_summaries row when its token fires.
    if outcome.summary_cancelled {
        let pool = state.db_manager.pool();
        if let Err(e) = SummaryProcessesRepository::update_process_cancelled(pool, &meeting_id).await {
            log_error!("Failed to update DB status to cancelled for {}: {}", meeting_id, e);
            return Err(format!("Falha ao atualizar o status de cancelamento: {}", e));
        }
    }

    if outcome.any() {
        log_info!("Successfully cancelled summary generation for meeting_id: {}", meeting_id);
        Ok(serde_json::json!({
            "message": "Geração de resumo cancelada com sucesso",
            "meeting_id": meeting_id,
        }))
    } else {
        log_warn!("No active summary generation found for meeting_id: {}", meeting_id);
        Ok(serde_json::json!({
            "message": "Nenhuma geração de resumo ativa para cancelar",
            "meeting_id": meeting_id,
        }))
    }
}
