use serde::{Deserialize, Serialize};

/// Azure AD (Entra ID) App Registration for the "Ambiental" single tenant.
/// Not secrets: this is a public client (PKCE, no client secret), same as
/// `APP_SERVER_URL` in `api/api.rs` is a hardcoded, non-sensitive constant.
pub const AZURE_CLIENT_ID: &str = "e844cfc3-97dd-4bb4-b3b4-b1f7bff575d3";
pub const AZURE_TENANT_ID: &str = "9afa5a5d-1b9d-46f1-9e93-5689a998a4b2";

/// Firebase's built-in "microsoft.com" provider only supports multi-tenant
/// Azure AD apps (it validates against the `/common/` endpoint and rejects
/// tokens issued by a single-tenant registration like ours, regardless of
/// client-side workarounds — this is documented as unsupported for the
/// manual `signInWithCredential` flow). The workaround is a Cloud Function
/// that validates the Microsoft id_token itself and mints a Firebase custom
/// token instead. See functions/src/index.ts.
const EXCHANGE_FUNCTION_URL: &str =
    "https://us-central1-reunia-5974f.cloudfunctions.net/exchangeMicrosoftToken";

const SCOPE: &str = "openid profile email";

pub struct AuthorizeRequest {
    pub code_verifier: String,
    pub state: String,
}

/// Result handed back to the frontend: a Firebase custom token, consumed via
/// `signInWithCustomToken` (not `signInWithCredential` — see module docs).
#[derive(Debug, Serialize, Deserialize)]
pub struct MicrosoftAuthResult {
    pub custom_token: String,
    pub uid: String,
}

#[derive(Debug, Deserialize)]
struct MicrosoftTokenResponse {
    id_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeFunctionResponse {
    custom_token: String,
    uid: String,
}

/// Builds the tenant-specific `/authorize` URL. Using the tenant-specific
/// endpoint (never `/common/` or `/organizations/`) is what restricts login
/// to the Ambiental Azure AD tenant.
pub fn build_authorize_url(redirect_uri: &str, req: &AuthorizeRequest) -> String {
    let code_challenge = super::pkce::generate_code_challenge(&req.code_verifier);
    let params = [
        ("client_id", AZURE_CLIENT_ID),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
        ("response_mode", "query"),
        ("scope", SCOPE),
        ("code_challenge", &code_challenge),
        ("code_challenge_method", "S256"),
        ("state", &req.state),
    ];

    let query = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(params)
        .finish();

    format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize?{}",
        AZURE_TENANT_ID, query
    )
}

/// Exchanges the authorization code for a Microsoft id_token using PKCE (no
/// client secret required — public client), then exchanges that id_token
/// for a Firebase custom token via the validating Cloud Function.
pub(crate) async fn exchange_code_for_firebase_token(
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<MicrosoftAuthResult, String> {
    let id_token = exchange_code_for_microsoft_id_token(code, code_verifier, redirect_uri).await?;
    exchange_id_token_for_custom_token(&id_token).await
}

async fn exchange_code_for_microsoft_id_token(
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<String, String> {
    let token_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        AZURE_TENANT_ID
    );

    let params = [
        ("client_id", AZURE_CLIENT_ID),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("code_verifier", code_verifier),
        // The v2.0 token endpoint rejects the request without this
        // (AADSTS900144) even though it was already sent to /authorize.
        ("scope", SCOPE),
    ];

    let client = reqwest::Client::new();
    let response = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Falha ao contatar o servidor de login da Microsoft: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Falha ao ler a resposta do login da Microsoft: {}", e))?;

    if !status.is_success() {
        log::error!("Microsoft token exchange failed ({}): {}", status, body);
        return Err("Falha ao concluir o login com a Microsoft".to_string());
    }

    let parsed: MicrosoftTokenResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Resposta inesperada do login da Microsoft: {}", e))?;
    Ok(parsed.id_token)
}

async fn exchange_id_token_for_custom_token(id_token: &str) -> Result<MicrosoftAuthResult, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(EXCHANGE_FUNCTION_URL)
        .json(&serde_json::json!({ "idToken": id_token }))
        .send()
        .await
        .map_err(|e| format!("Falha ao validar o login com o servidor: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Falha ao ler a resposta do servidor de login: {}", e))?;

    if !status.is_success() {
        log::error!("Custom token exchange failed ({}): {}", status, body);
        return Err(
            "Não foi possível validar seu login. Verifique se seu usuário está autorizado."
                .to_string(),
        );
    }

    let parsed: ExchangeFunctionResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Resposta inesperada do servidor de login: {}", e))?;

    Ok(MicrosoftAuthResult {
        custom_token: parsed.custom_token,
        uid: parsed.uid,
    })
}
