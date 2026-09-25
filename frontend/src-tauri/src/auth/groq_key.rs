use sqlx::SqlitePool;

use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;

/// Resolves the Groq API key to actually use for a real Groq call
/// (transcription or LLM summary): the logged-in user's per-profile key
/// (from Firestore, mirrored into `AppState.auth` via `set_auth_session`)
/// takes priority over the key saved locally in the `settings` table.
///
/// Only call this at the point where the key is used to talk to Groq.
/// Never return its result from a command that hands data back to the
/// frontend (e.g. `api_get_api_key`, `api_get_transcript_config`) — those
/// must keep surfacing only the locally-saved key, so the profile key is
/// never sent into the webview.
pub async fn resolve_groq_api_key(
    state: &AppState,
    pool: &SqlitePool,
    for_transcription: bool,
) -> Result<Option<String>, String> {
    if let Ok(session) = state.require_auth() {
        if let Some(key) = session.groq_api_key.filter(|k| !k.trim().is_empty()) {
            return Ok(Some(key));
        }
    }

    let local_key = if for_transcription {
        SettingsRepository::get_transcript_api_key(pool, "groq").await
    } else {
        SettingsRepository::get_api_key(pool, "groq").await
    };

    local_key.map_err(|e| format!("Falha ao buscar a chave de API do Groq: {}", e))
}
