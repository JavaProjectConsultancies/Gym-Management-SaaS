/**
 * FirebaseVerificationService.gs — verifies Firebase ID tokens.
 *
 * WHY THIS APPROACH
 * Apps Script has no RSA signature *verification* primitive (Utilities can
 * only *sign* with RSA). Verifying RS256 locally would mean implementing RSA
 * by hand or vendoring an unaudited JS crypto library — both are "homemade
 * crypto" and are deliberately avoided.
 *
 * Instead, the token is verified by Google itself:
 *
 *   1. Google verification — POST the token to the Identity Toolkit
 *      `accounts:lookup` endpoint. Google validates the RS256 signature
 *      against its current Firebase signing keys (so key rotation is handled
 *      by Google), rejects expired/malformed tokens, and returns the account
 *      record (localId, disabled, validSince).
 *   2. Local claim checks (defence in depth, on the payload Google accepted):
 *      header alg=RS256 + kid, iss, aud = FIREBASE_PROJECT_ID, exp, iat,
 *      auth_time, sub (non-empty, ≤128 chars) and sub === localId.
 *   3. Account checks: `disabled` → reject; token issued before `validSince`
 *      (refresh tokens revoked / password changed) → reject.
 *
 * A successful result is cached for min(TOKEN_CACHE_SECONDS, time-to-expiry)
 * keyed by the SHA-256 of the token (the token itself is never stored or
 * logged). Revocations/disables therefore take effect within that window.
 *
 * Alternative if local public-key verification is required: see
 * docs/AUTHENTICATION.md ("Alternative: dedicated verification service").
 */

const FIREBASE_LOOKUP_URL_ = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const TOKEN_CACHE_PREFIX_ = 'fbtok:';
/** Identity Toolkit error messages that mean "this token/account is not valid". */
const TOKEN_ERROR_PATTERN_ = /^(INVALID_ID_TOKEN|TOKEN_EXPIRED|USER_NOT_FOUND|USER_DISABLED|CREDENTIAL_TOO_OLD_LOGIN_AGAIN)\b/;

/**
 * Verify a Firebase ID token.
 * @return {{uid: string, email: string, emailVerified: boolean, iat: number, exp: number}}
 * @throws ApiError 401 on any verification failure
 */
function verifyFirebaseIdToken_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > CONFIG_DEFAULTS.MAX_ID_TOKEN_LENGTH) {
    throw invalidToken_('malformed');
  }

  const config = getConfig_();
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Parse first: cheap rejection of garbage and expired tokens without a network call.
  const parsed = decodeJwtUnverified_(idToken);
  validateTokenClaims_(parsed.header, parsed.payload, config.firebaseProjectId, nowSeconds, config.clockSkewSeconds);

  const cacheKey = TOKEN_CACHE_PREFIX_ + sha256Base64_(idToken);
  const cache = CacheService.getScriptCache();
  if (config.tokenCacheSeconds > 0) {
    const cached = cache.get(cacheKey);
    if (cached) {
      const identity = JSON.parse(cached);
      if (identity.exp > nowSeconds) return identity;
    }
  }

  const account = lookupAccountWithGoogle_(idToken, config.firebaseWebApiKey);
  const identity = checkAccountAgainstToken_(account, parsed.payload);

  if (config.tokenCacheSeconds > 0) {
    const ttl = Math.min(config.tokenCacheSeconds, identity.exp - nowSeconds);
    if (ttl > 0) cache.put(cacheKey, JSON.stringify(identity), ttl);
  }
  return identity;
}

/**
 * Ask Google to verify the token (signature, expiry, project) and return the account.
 * Network/quota problems → 503 (not 401), so clients can retry.
 */
function lookupAccountWithGoogle_(idToken, apiKey) {
  let response;
  try {
    response = UrlFetchApp.fetch(FIREBASE_LOOKUP_URL_ + '?key=' + encodeURIComponent(apiKey), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }),
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (e) {
    console.error('Token verification request failed: ' + e);
    throw new ApiError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Authentication service is temporarily unavailable.');
  }

  const status = response.getResponseCode();
  let body = {};
  try {
    body = JSON.parse(response.getContentText() || '{}');
  } catch (e) {
    body = {};
  }

  if (status === 200) {
    const users = body.users;
    if (!Array.isArray(users) || users.length !== 1) throw invalidToken_('no-account');
    return users[0];
  }

  const message = body.error && body.error.message ? String(body.error.message) : 'HTTP ' + status;
  // Only errors that describe the TOKEN or ACCOUNT are the caller's fault → 401.
  // Everything else (CONFIGURATION_NOT_FOUND = Firebase Auth not enabled, bad API key,
  // API disabled, quota) is a server problem → 503, so it isn't misreported as "sign in again".
  if (status === 400 && TOKEN_ERROR_PATTERN_.test(message)) throw invalidToken_(message);
  console.error('Identity Toolkit error ' + status + ': ' + message);
  throw new ApiError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Authentication service is temporarily unavailable.');
}

/** Pure: combine Google's account record with the (Google-accepted) token payload. */
function checkAccountAgainstToken_(account, payload) {
  if (!account || account.localId !== payload.sub) throw invalidToken_('uid-mismatch');
  if (account.disabled === true) {
    throw new ApiError(401, 'ACCOUNT_DISABLED', 'This account has been disabled.');
  }
  // validSince (seconds) is bumped when refresh tokens are revoked or the password changes.
  const validSince = account.validSince ? parseInt(account.validSince, 10) : 0;
  if (validSince && payload.iat < validSince) {
    throw new ApiError(401, 'TOKEN_REVOKED', 'Your session has been revoked. Please sign in again.');
  }
  return {
    uid: payload.sub,
    email: (account.email || payload.email || '').toLowerCase(),
    emailVerified: account.emailVerified === true,
    iat: payload.iat,
    exp: payload.exp,
  };
}

/**
 * Pure: validate header + claims per Firebase's documented requirements.
 * https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */
function validateTokenClaims_(header, payload, projectId, nowSeconds, skewSeconds) {
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw invalidToken_('bad-header');
  }
  if (!payload || typeof payload !== 'object') throw invalidToken_('bad-payload');
  if (payload.aud !== projectId) throw invalidToken_('bad-audience');
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw invalidToken_('bad-issuer');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) {
    throw invalidToken_('bad-subject');
  }
  if (!isFiniteNumber_(payload.exp) || payload.exp <= nowSeconds - skewSeconds) {
    throw new ApiError(401, 'TOKEN_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  if (!isFiniteNumber_(payload.iat) || payload.iat > nowSeconds + skewSeconds) throw invalidToken_('bad-iat');
  if (!isFiniteNumber_(payload.auth_time) || payload.auth_time > nowSeconds + skewSeconds) {
    throw invalidToken_('bad-auth-time');
  }
  return true;
}

/**
 * Decode header and payload WITHOUT verifying the signature. The result is only
 * trusted after Google has accepted the same token in lookupAccountWithGoogle_.
 */
function decodeJwtUnverified_(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw invalidToken_('not-jwt');
  try {
    return { header: JSON.parse(base64UrlDecode_(parts[0])), payload: JSON.parse(base64UrlDecode_(parts[1])) };
  } catch (e) {
    throw invalidToken_('undecodable');
  }
}

function base64UrlDecode_(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('invalid base64url');
  const padLength = (4 - (segment.length % 4)) % 4;
  if (padLength === 3) throw new Error('invalid base64url length');
  const bytes = Utilities.base64DecodeWebSafe(segment + '='.repeat(padLength));
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function sha256Base64_(text) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8),
  );
}

function isFiniteNumber_(n) {
  return typeof n === 'number' && isFinite(n);
}

/** All token failures share one client-facing error; the reason is logged only. */
function invalidToken_(reason) {
  console.warn('Rejected ID token: ' + reason);
  return new ApiError(401, 'INVALID_TOKEN', 'Authentication failed. Please sign in again.');
}
