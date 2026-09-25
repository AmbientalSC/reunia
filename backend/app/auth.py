"""Firebase ID token validation for the FastAPI server mode.

Note: the packaged desktop app talks to SQLite directly via Rust/sqlx and
never starts this server — protection there lives in src-tauri's AppState
(see frontend/src-tauri/src/state.rs::require_auth). This module protects
the secondary Docker/server deployment mode of the same codebase.
"""
import logging
import os

import firebase_admin
from fastapi import Header, HTTPException
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials

logger = logging.getLogger(__name__)

ALLOWED_EMAIL_DOMAIN = "@ambiental.sc"

_service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
if _service_account_path and not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(_service_account_path))
elif not _service_account_path:
    logger.warning(
        "FIREBASE_SERVICE_ACCOUNT_PATH not set — all requests will be rejected. "
        "See backend/.env.example."
    )


async def get_current_user(authorization: str = Header(default=None)) -> dict:
    """FastAPI dependency: validates the Firebase ID token and the
    corporate email domain. Raises 401/403 on any failure."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Cabeçalho Authorization ausente ou inválido")

    token = authorization.removeprefix("Bearer ").strip()

    try:
        decoded_token = firebase_auth.verify_id_token(token)
    except Exception as exc:  # firebase_admin raises several distinct error types
        logger.warning("Failed to verify Firebase ID token: %s", exc)
        raise HTTPException(status_code=401, detail="Token inválido ou expirado") from exc

    email = decoded_token.get("email", "")
    if not email.lower().endswith(ALLOWED_EMAIL_DOMAIN):
        logger.warning("Rejected login for email outside allowed domain: %s", email)
        raise HTTPException(status_code=403, detail="Domínio de e-mail não autorizado")

    return decoded_token
