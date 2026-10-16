use crate::database::repositories::meeting_insight::MeetingInsightsRepository;
use crate::state::AppState;
use crate::summary::live_insight::{normalize_keywords, LiveInsightData};
use log::{info as log_info, warn as log_warn};
use serde::Serialize;

/// A real insight is a few KB; this only stops a buggy or compromised caller from bloating the database.
const MAX_INSIGHT_JSON_BYTES: usize = 64 * 1024;

/// The last live insight kept with a meeting.
#[derive(Debug, Serialize)]
pub struct SavedInsight {
    pub data: LiveInsightData,
    pub updated_at: String,
}

/// Returns the insight saved for a meeting, if any.
///
/// A stored value that no longer parses is treated as missing: the Insight tab
/// then offers to generate a new one instead of failing.
#[tauri::command]
pub async fn api_get_live_insight(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<SavedInsight>, String> {
    state.require_auth()?;

    let stored = MeetingInsightsRepository::get(state.db_manager.pool(), &meeting_id)
        .await
        .map_err(|e| format!("Falha ao carregar o insight: {}", e))?;

    Ok(stored.and_then(|row| match serde_json::from_str::<LiveInsightData>(&row.result) {
        Ok(data) => Some(SavedInsight {
            data,
            updated_at: row.updated_at.to_rfc3339(),
        }),
        Err(e) => {
            log_warn!("Ignoring unreadable saved insight for {}: {}", meeting_id, e);
            None
        }
    }))
}

/// Saves (or replaces) the insight of a meeting.
#[tauri::command]
pub async fn api_save_live_insight(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    mut insight: LiveInsightData,
) -> Result<(), String> {
    state.require_auth()?;

    insight.keywords = normalize_keywords(insight.keywords);
    let json = serde_json::to_string(&insight)
        .map_err(|e| format!("Falha ao serializar o insight: {}", e))?;
    if json.len() > MAX_INSIGHT_JSON_BYTES {
        return Err("O insight é grande demais para ser salvo".to_string());
    }

    MeetingInsightsRepository::upsert(state.db_manager.pool(), &meeting_id, &json)
        .await
        .map_err(|e| format!("Falha ao salvar o insight: {}", e))?;

    log_info!("Saved live insight for meeting {}", meeting_id);
    Ok(())
}
