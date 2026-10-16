use crate::state::AppState;
use crate::summary::ask_ai::{self, AskAnswer, AskRequest};
use crate::summary::visual;
use log::{info as log_info, warn as log_warn};
use tauri::{AppHandle, Manager, Runtime};

/// Answers a question about a keyword, a selected phrase or a follow-up, using
/// the web when the configured provider can search it (see `ask_ai`).
///
/// Stateless, like `api_generate_live_insight`: the frontend sends the whole
/// conversation each time and nothing is persisted.
#[tauri::command]
pub async fn api_ask_ai<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    request: AskRequest,
    model: String,
    model_name: String,
) -> Result<AskAnswer, String> {
    log_info!(
        "api_ask_ai called (provider: {}, kind: {:?}, web: {})",
        model,
        request.kind,
        request.use_web
    );

    if model.trim().is_empty() || model_name.trim().is_empty() {
        return Err(
            "Nenhum modelo de IA configurado. Configure um em Configurações > Resumo.".to_string(),
        );
    }

    let session = state.require_auth()?;
    let config = visual::resolve_visual_llm_config(
        state.db_manager.pool(),
        &model,
        &model_name,
        app.path().app_data_dir().ok(),
        session.groq_api_key,
    )
    .await?;

    ask_ai::ask(&config, &request).await.map_err(|e| {
        log_warn!("api_ask_ai failed: {}", e);
        e
    })
}
