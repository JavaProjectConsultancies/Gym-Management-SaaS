/**
 * ResponseService.gs — standard JSON envelope and the API error type.
 *
 * Apps Script web apps ALWAYS return HTTP 200 and cannot set status codes or
 * headers, so the logical HTTP status is carried in the body:
 *
 *   { "ok": true,  "status": 200, "data": {...},                    "requestId": "...", "timestamp": "..." }
 *   { "ok": false, "status": 403, "error": { "code", "message" },   "requestId": "...", "timestamp": "..." }
 */

/** Error with a client-safe code/message. Anything else becomes a generic 500. */
class ApiError extends Error {
  /**
   * @param {number} status logical HTTP status (400, 401, 403, 404, 405, 409, 413, 500, 503)
   * @param {string} code   stable machine-readable code, e.g. "USER_INACTIVE"
   * @param {string} message safe to show to users — never include internals
   * @param {Object=} details optional safe details (e.g. validation field errors)
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function successResponse_(requestId, data, status) {
  return buildEnvelope_({ ok: true, status: status || 200, data: data === undefined ? null : data }, requestId);
}

function errorResponse_(requestId, error) {
  if (error instanceof ApiError) {
    const body = { code: error.code, message: error.message };
    if (error.details) body.details = error.details;
    return buildEnvelope_({ ok: false, status: error.status, error: body }, requestId);
  }
  // Unknown failure: log the details server-side, return nothing internal.
  console.error('[' + requestId + '] Unhandled error: ' + (error && error.stack ? error.stack : error));
  return buildEnvelope_(
    { ok: false, status: 500, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
    requestId,
  );
}

function buildEnvelope_(payload, requestId) {
  payload.requestId = requestId;
  payload.timestamp = nowIso_();
  return payload;
}

/** Serialize an envelope to a web-app TextOutput. */
function toTextOutput_(envelope) {
  return ContentService.createTextOutput(JSON.stringify(envelope)).setMimeType(ContentService.MimeType.JSON);
}

function newRequestId_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}
