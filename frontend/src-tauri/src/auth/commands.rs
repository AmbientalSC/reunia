use std::time::Duration;

use log::info as log_info;

use crate::state::{AppState, AuthSession};

use super::{loopback::LoopbackServer, microsoft, pkce};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

/// Orchestrates the desktop OAuth flow: opens the system browser for
/// Microsoft login, captures the redirect via a local loopback listener,
/// exchanges the code for a Microsoft id_token (PKCE, no client secret),
/// then exchanges that id_token for a Firebase custom token via the
/// validating Cloud Function (see `microsoft::exchange_code_for_firebase_token`
/// for why this indirection is required). The frontend takes the result and
/// calls Firebase's `signInWithCustomToken`.
#[tauri::command]
pub async fn login_with_microsoft() -> Result<microsoft::MicrosoftAuthResult, String> {
    let server = LoopbackServer::bind().await?;
    let redirect_uri = format!("http://localhost:{}", server.port());

    let code_verifier = pkce::generate_code_verifier();
    let state_param = pkce::generate_state();

    let authorize_url = microsoft::build_authorize_url(
        &redirect_uri,
        &microsoft::AuthorizeRequest {
            code_verifier: code_verifier.clone(),
            state: state_param.clone(),
        },
    );

    log_info!("Opening system browser for Microsoft login");
    crate::api::open_external_url(authorize_url).await?;

    let code = server.wait_for_code(&state_param, LOGIN_TIMEOUT).await?;
    log_info!("Received authorization code, exchanging for tokens");

    microsoft::exchange_code_for_firebase_token(&code, &code_verifier, &redirect_uri).await
}

/// Mirrors the Firebase session into `AppState`. Called by the frontend on
/// every `onIdTokenChanged` (login, hourly refresh) so Rust commands can
/// check `require_auth()` without crossing back into the webview.
#[tauri::command]
pub async fn set_auth_session(
    state: tauri::State<'_, AppState>,
    uid: String,
    email: String,
    id_token: String,
    expires_at: i64,
    groq_api_key: Option<String>,
) -> Result<(), String> {
    let mut guard = state
        .auth
        .lock()
        .map_err(|_| "Falha ao atualizar a sessão de autenticação".to_string())?;
    *guard = Some(AuthSession {
        uid,
        email,
        id_token,
        expires_at,
        groq_api_key,
    });
    Ok(())
}

/// Clears the mirrored session on logout (also called with no active
/// session by `onIdTokenChanged(null)` before the first login — harmless).
#[tauri::command]
pub async fn clear_auth_session(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut guard = state
        .auth
        .lock()
        .map_err(|_| "Falha ao limpar a sessão de autenticação".to_string())?;
    *guard = None;
    Ok(())
}
