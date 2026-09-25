use crate::database::manager::DatabaseManager;
use std::sync::Mutex;

/// Firebase session mirrored in-memory from the frontend (`set_auth_session`,
/// called on every `onIdTokenChanged`). Not persisted to disk — the Firebase
/// JS SDK (IndexedDB) is the single source of truth; this is just a cache so
/// Rust commands can check `require_auth()` before touching the database.
#[derive(Debug, Clone)]
pub struct AuthSession {
    pub uid: String,
    pub email: String,
    pub id_token: String,
    /// Unix seconds (Firebase ID tokens are short-lived, ~1h).
    pub expires_at: i64,
    /// Per-user Groq key from the admin-managed Firestore profile (see
    /// `fetchUserProfile` on the frontend). Never surfaced in the UI —
    /// only read by the transcription/summary pipeline.
    pub groq_api_key: Option<String>,
}

pub struct AppState {
    pub db_manager: DatabaseManager,
    pub auth: Mutex<Option<AuthSession>>,
}

impl AppState {
    pub fn new(db_manager: DatabaseManager) -> Self {
        Self {
            db_manager,
            auth: Mutex::new(None),
        }
    }

    /// Returns the current session, or an error if the user isn't logged in
    /// or the mirrored token has expired. Commands that touch meetings,
    /// transcripts or saved API keys must call this before hitting the DB.
    pub fn require_auth(&self) -> Result<AuthSession, String> {
        let guard = self
            .auth
            .lock()
            .map_err(|_| "Falha ao verificar a sessão de autenticação".to_string())?;

        match guard.as_ref() {
            Some(session) if session.expires_at > chrono::Utc::now().timestamp() => {
                Ok(session.clone())
            }
            Some(_) => Err("Sessão expirada, faça login novamente".to_string()),
            None => Err("É necessário fazer login para acessar este recurso".to_string()),
        }
    }
}
