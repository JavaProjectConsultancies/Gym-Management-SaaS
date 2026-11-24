# Security

## Principles

1. **Authentication ≠ authorization.** Firebase proves identity only. Gym, role and status come
   from the backend's `Users` and `Gyms` tabs on **every request**.
2. **Never trust the client.** Role and Gym_ID are never read from the request. Unknown
   request fields are rejected. Frontend route guards are UX, not security.
3. **Fail closed.** Any verification, configuration or data-integrity problem denies access.
4. **Least privilege.** Explicit role → permission map. Tenant isolation is enforced on every
   gym-scoped route.
5. **No homemade crypto.** Token signatures are verified by Google (see AUTHENTICATION.md).

## Threat model summary

| Threat | Mitigation |
| ------ | ---------- |
| Forged / tampered ID token | Google verifies the signature (`accounts:lookup`). The local check requires `alg=RS256` and a `kid` (blocks `alg=none` and HS256 confusion) |
| Token from another Firebase project | `aud`/`iss` must match `FIREBASE_PROJECT_ID` (checked locally before any network call) |
| Expired / replayed old token | `exp`, `iat` and `auth_time` checks (60 s skew), plus `validSince` revocation |
| Self-registered Firebase account | No `Users` row → `USER_NOT_REGISTERED` |
| Privilege escalation via request | Role/Gym_ID come only from the DB. Unknown envelope/body fields → 400 |
| Cross-gym access (IDOR) | `requireGymAccess_` on every `/gyms/{gymId}` route. Returns 404 and writes an audit entry |
| Deactivated user / suspended gym | Checked on every request, effective immediately |
| Spreadsheet formula injection | Values starting with `= + - @` are stored as text |
| Race conditions / lost writes | Script lock around all writes. Re-read inside the lock. Upserts are atomic |
| Information leakage | Generic messages for auth failures and 500s. Details go to logs with `requestId`. Tokens are never logged (cache keys are SHA-256 hashes) |
| Open redirect after login | Only same-origin relative paths are accepted |
| Credential exposure | No service-account keys anywhere. Config lives in Script Properties. `.env*`, `.clasp*.json` and key files are git-ignored |

## Apps Script deployment model (important)

The web app is deployed **Execute as: Me** and **Who has access: Anyone**. Firebase users are
not Google accounts, so the endpoint must be publicly reachable.

- **Anyone on the internet can call `doPost`.** The token verification and authorization in
  this codebase are the only gate. Every new route **must** set `permission` and, for gym data,
  `gymParam`.
- The script runs with the **deploying account's** access to Sheets. Keep the central and
  per-gym spreadsheets private to that account (and a small group of admins). Never share them
  with gym users.
- Only `doGet`/`doPost` are reachable. All internal functions end in `_` (private in Apps
  Script). No HTML is served, so `google.script.run` is not exposed. Setup and test functions
  (no underscore) can only be run by project editors from the editor.
- Restrict **editor access** to the Apps Script project. Anyone who can edit the script can
  read Script Properties and all data.

## Secrets and configuration

| Item | Where | Secret? |
| ---- | ----- | ------- |
| Firebase web config (`VITE_FIREBASE_*`) | `web/.env.local`, Cloudflare env vars | No: public identifiers |
| `FIREBASE_WEB_API_KEY` (server) | Apps Script Script Properties | Low sensitivity. Use a separate key restricted to the Identity Toolkit API |
| `SPREADSHEET_ID`, `FIREBASE_PROJECT_ID` | Script Properties | No, but not hard-coded |
| Service-account keys | **Not used. Never create or commit them** | Yes |
| Passwords | Only ever sent to Firebase. Never stored by the app, in localStorage or in Sheets | Yes |

## Client-side caching

- `localStorage` key `gms.session.<firebaseUid>` holds the last `/auth/session` response
  (name, role, gym name, permissions) so the app opens instantly. It contains no token or
  password, only shapes the UI, and is removed on sign-out or when the server reports the
  account as blocked. Tampering with it grants nothing: the backend authorises every request.
- Screen data is cached **in memory only** and cleared on sign-out.
- The service worker caches only same-origin static files (app shell, hashed assets, icons);
  API and Firebase requests are never intercepted.

## Known limitations / future work

- **Revocation delay:** a disabled or revoked Firebase account can keep working for up to
  `TOKEN_CACHE_SECONDS` (default 120 s). Sheet-based deactivation is immediate.
- **Rate limiting:** none yet. Apps Script quotas cap abuse, but a per-UID limit
  (CacheService counters) should be added before public launch.
- **Audit write amplification:** denied requests write an audit row. A malicious *registered*
  user could spam the log. Add rate limiting or sampling if that happens.
- **Single lock:** all writes are serialized. That is correct but limits write throughput.
- **Per-gym spreadsheets** are not implemented yet. When they are, open them only via
  `Gyms.Spreadsheet_ID` from the authenticated context, never from a client-supplied ID.
- **Email verification** is not enforced (`emailVerified` is available on the identity if
  required later).

## Reporting a security issue

Do not open a public issue. Contact the project owner directly.
