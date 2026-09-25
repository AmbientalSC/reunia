use log::info;
use tauri::{AppHandle, Emitter, Manager};

use super::manager::DatabaseManager;
use crate::state::AppState;

/// Initialize database on app startup
/// Handles first launch detection and conditional initialization
///
/// The AppState is always managed here, even on first launch: `manager::new`
/// creates a fresh empty SQLite database when neither the tauri nor legacy
/// path exists, so this is safe. It also matters for auth — `AppState.auth`
/// (the mirrored Firebase session, see `state.rs::require_auth`) must exist
/// from boot, since login can complete before the user makes any onboarding
/// choice. If the user later imports a legacy database, `import_and_initialize_database`
/// (database/commands.rs) re-calls `app.manage(AppState::new(..))`, which
/// replaces this placeholder — Tauri allows re-managing the same type.
pub async fn initialize_database_on_startup(app: &AppHandle) -> Result<(), String> {
    // Check if this is the first launch (no database exists yet)
    let is_first_launch = DatabaseManager::is_first_launch(app)
        .await
        .map_err(|e| format!("Failed to check first launch status: {}", e))?;

    let db_manager = DatabaseManager::new_from_app_handle(app)
        .await
        .map_err(|e| format!("Failed to initialize database manager: {}", e))?;
    app.manage(AppState::new(db_manager));
    info!("Database initialized successfully");

    if is_first_launch {
        info!("First launch detected - will notify window when ready");

        // Delay event emission to ensure window is ready and React listeners are registered
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            app_handle
                .emit("first-launch-detected", ())
                .expect("Failed to emit first-launch-detected event");
            info!("Emitted first-launch-detected after delay");
        });
    }

    Ok(())
}
