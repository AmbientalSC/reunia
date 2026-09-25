use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

fn random_url_safe_token(byte_len: usize) -> String {
    let mut bytes = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// PKCE code_verifier (RFC 7636): 43-128 char URL-safe string.
pub fn generate_code_verifier() -> String {
    random_url_safe_token(64)
}

/// PKCE code_challenge (S256) derived from the verifier — RFC 7636 mandates
/// base64url (no padding) here.
pub fn generate_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

/// Anti-CSRF state parameter for the OAuth authorize request.
pub fn generate_state() -> String {
    random_url_safe_token(32)
}
