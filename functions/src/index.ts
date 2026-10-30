import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { defineSecret } from 'firebase-functions/params';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { normalizeAllowedEmail } from './adminUsers';
import { ensureUserProfile, pickDefaultGroqKey, type ProvisionResult } from './provisioning';

initializeApp();

export { listUsers, upsertUser, setUserRole, setUserGroqKey, setUserAuthorized, deleteUser } from './adminUsers';
export { recordUsage } from './usage';

// Same single-tenant Azure AD app as frontend/src-tauri/src/auth/microsoft.rs.
// Not secrets — public client identifiers, same reasoning as documented there.
const AZURE_TENANT_ID = '9afa5a5d-1b9d-46f1-9e93-5689a998a4b2';
const AZURE_CLIENT_ID = 'e844cfc3-97dd-4bb4-b3b4-b1f7bff575d3';

// Shared Groq key copied into the profile of every auto-provisioned user.
// Set with: firebase functions:secrets:set GROQ_DEFAULT_API_KEY --project reunia-5974f
const groqDefaultApiKey = defineSecret('GROQ_DEFAULT_API_KEY');

const issuer = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`;
const jwks = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`)
);

interface MicrosoftIdTokenClaims {
  oid?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
}

/**
 * Firebase's built-in "microsoft.com" provider only supports multi-tenant
 * Azure AD apps and rejects tokens issued by a single-tenant app registration
 * (see frontend/src-tauri/src/auth/microsoft.rs for why we need single
 * -tenant). This function is the documented workaround: validate the
 * Microsoft id_token ourselves (signature via the tenant's own JWKS, issuer,
 * audience, expiry) and exchange it for a Firebase custom token instead of
 * calling signInWithCredential from the client.
 *
 * It is also where access is granted: anyone from the Ambiental tenant with an
 * @ambiental.sc e-mail gets a `user_profiles` doc created on first login. An
 * existing profile is never modified, so `authorized: false` still blocks.
 */
export const exchangeMicrosoftToken = onRequest(
  { cors: false, region: 'us-central1', secrets: [groqDefaultApiKey] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : null;
    if (!idToken) {
      res.status(400).json({ error: 'missing_id_token' });
      return;
    }

    let claims: MicrosoftIdTokenClaims;
    try {
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer,
        audience: AZURE_CLIENT_ID,
      });
      claims = payload as MicrosoftIdTokenClaims;
    } catch (error) {
      logger.warn('Rejected Microsoft id_token', { error: String(error) });
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    const rawEmail = claims.email ?? claims.preferred_username;
    if (!claims.oid || !rawEmail) {
      res.status(400).json({ error: 'missing_claims' });
      return;
    }
    // Same strict, ASCII-first normalization the admin callables use, so a login
    // can only ever create a profile that the admin screen could also have created.
    const email = normalizeAllowedEmail(rawEmail);
    if (email === null) {
      logger.warn('Rejected login outside allowed domain', { email: rawEmail });
      res.status(403).json({ error: 'domain_not_allowed' });
      return;
    }

    const rawDefaultKey = groqDefaultApiKey.value();
    const defaultGroqKey = pickDefaultGroqKey(rawDefaultKey);
    if (rawDefaultKey?.trim() && !defaultGroqKey) {
      logger.warn('GROQ_DEFAULT_API_KEY is malformed; provisioning profiles without a Groq key');
    }

    let provisioned: ProvisionResult;
    try {
      provisioned = await ensureUserProfile(email, defaultGroqKey);
    } catch (error) {
      // Fail closed: without a profile the client gate would reject the login anyway.
      logger.error('Failed to provision user profile', { email, error: String(error) });
      res.status(500).json({ error: 'profile_provision_failed' });
      return;
    }
    if (provisioned === 'blocked') {
      logger.warn('Rejected login of a blocked user', { email });
      res.status(403).json({ error: 'access_denied' });
      return;
    }
    if (provisioned === 'created') {
      // The key value is never logged.
      logger.info('Auto-provisioned user profile', { email, withGroqKey: defaultGroqKey !== undefined });
    }

    // Prefixed to keep the namespace distinct if another IdP is added later;
    // the Azure AD Object ID (oid) is stable per user within the tenant.
    const uid = `msft:${claims.oid}`;

    try {
      const customToken = await getAuth().createCustomToken(uid, {
        email,
        name: claims.name ?? null,
      });
      res.status(200).json({ customToken, uid });
    } catch (error) {
      logger.error('Failed to mint custom token', { error: String(error) });
      res.status(500).json({ error: 'custom_token_failed' });
    }
  }
);
