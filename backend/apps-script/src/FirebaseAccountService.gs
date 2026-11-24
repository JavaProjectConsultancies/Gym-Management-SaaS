/**
 * FirebaseAccountService.gs — create staff logins (Phase 9).
 *
 * Uses Firebase Auth's public Identity Toolkit REST endpoints with the web API
 * key (the same key the website uses), so no service-account secret is needed:
 *   - accounts:signUp      create an email/password account with a random
 *                          password that nobody ever sees or stores;
 *   - accounts:sendOobCode send Firebase's "reset your password" email, which
 *                          the new staff member uses to choose their password;
 *   - accounts:delete      remove the account again if saving the Users row fails.
 *
 * Authorisation for staff management happens in StaffService/Router; these
 * functions only talk to Firebase. Errors never expose Firebase internals.
 */

const IDENTITY_TOOLKIT_ = 'https://identitytoolkit.googleapis.com/v1/';

function callIdentityToolkit_(method, payload) {
  const config = getConfig_();
  let response;
  try {
    response = UrlFetchApp.fetch(IDENTITY_TOOLKIT_ + method + '?key=' + encodeURIComponent(config.firebaseWebApiKey), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (e) {
    console.error('Identity Toolkit ' + method + ' failed: ' + e);
    throw new ApiError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Authentication service is temporarily unavailable.');
  }
  let body = {};
  try {
    body = JSON.parse(response.getContentText() || '{}');
  } catch (e) {
    body = {};
  }
  return { status: response.getResponseCode(), body: body };
}

/** Random password that is never shown or stored (the user sets their own). */
function randomPassword_() {
  return Utilities.getUuid() + Utilities.getUuid();
}

/**
 * Create a Firebase email/password account.
 * @return {{ uid: string, idToken: string }}
 */
function createFirebaseAccount_(email) {
  const res = callIdentityToolkit_('accounts:signUp', {
    email: email,
    password: randomPassword_(),
    returnSecureToken: true,
  });
  if (res.status === 200 && res.body.localId) return { uid: res.body.localId, idToken: res.body.idToken };

  const message = res.body.error && res.body.error.message ? String(res.body.error.message) : 'HTTP ' + res.status;
  if (/^EMAIL_EXISTS/.test(message)) {
    throw new ApiError(409, 'EMAIL_HAS_LOGIN', 'This email already has a login for this app.', {
      fields: { email: 'Already has a login. Use a different email, or contact support to link it.' },
    });
  }
  if (/^INVALID_EMAIL/.test(message)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', {
      fields: { email: 'Firebase does not accept this email address.' },
    });
  }
  console.error('accounts:signUp error ' + res.status + ': ' + message);
  throw new ApiError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Could not create the login. Please try again.');
}

/** Ask Firebase to email a password-setup (reset) link. Returns true if sent. */
function sendPasswordSetupEmail_(email) {
  const res = callIdentityToolkit_('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email: email });
  if (res.status === 200) return true;
  const message = res.body.error && res.body.error.message ? String(res.body.error.message) : 'HTTP ' + res.status;
  console.error('accounts:sendOobCode error ' + res.status + ': ' + message);
  return false;
}

/** Best effort: delete an account we just created (we hold its ID token). */
function deleteFirebaseAccount_(idToken) {
  try {
    const res = callIdentityToolkit_('accounts:delete', { idToken: idToken });
    if (res.status !== 200) console.error('accounts:delete failed with HTTP ' + res.status);
  } catch (e) {
    console.error('accounts:delete failed: ' + e);
  }
}
