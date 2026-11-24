# Authentication

Firebase Authentication proves **who** a user is. It does **not** decide what they may do.
Every authorization decision (gym, role, status) is made by the Apps Script backend from the
central database. See [SECURITY.md](SECURITY.md).

```
Browser                         Firebase Auth                 Apps Script backend
  │  email + password  ───────────►│                                  │
  │◄─────────── ID token (1 h) ────│                                  │
  │  POST {path, idToken} ─────────────────────────────────────────►  │
  │                                │◄── accounts:lookup(idToken) ──── │  Google verifies signature
  │                                │──── account record ────────────► │  + local claim checks
  │                                                                   │  Users/Gyms lookup → role, gym
  │◄──────────────────────────── JSON response ────────────────────── │  permission + tenant checks
```

## 1. Firebase console setup (manual)

Project: `gym-management-saas-831ad`.

1. **Enable Email/Password sign-in:** Firebase console → *Authentication* → *Sign-in method* →
   *Email/Password* → Enable (leave "Email link" off) → Save.
2. **Get the web config:** *Project settings* (gear) → *General* → *Your apps* → the web app →
   *SDK setup and configuration* → *Config*. Copy `apiKey` (the other values are already in
   `web/.env.local`, and `storageBucket` should be checked against this screen).
3. **Create users:** *Authentication* → *Users* → *Add user*. There is no public sign-up screen;
   accounts are created by an administrator. Copy each user's **User UID** — the backend needs it.
4. **Authorized domains:** *Authentication* → *Settings* → *Authorized domains*. `localhost` is
   included by default. Add your Cloudflare Pages domain when you deploy.
5. **Recommended hardening:**
   - Keep *Email enumeration protection* enabled (*Authentication* → *Settings*).
   - Anyone holding the public API key can create a Firebase account through the REST API. The
     backend rejects such accounts (`USER_NOT_REGISTERED`) because they have no `Users` row. If
     your project offers *User actions → Enable create (sign-up)*, turn it off as well.

## 2. Frontend configuration

`web/.env.local` (git-ignored) holds the Firebase web config:

| Variable                            | Required | Source                              |
| ----------------------------------- | -------- | ----------------------------------- |
| `VITE_FIREBASE_API_KEY`             | Yes      | Config → `apiKey`                   |
| `VITE_FIREBASE_AUTH_DOMAIN`         | Yes      | Config → `authDomain`               |
| `VITE_FIREBASE_PROJECT_ID`          | Yes      | Config → `projectId`                |
| `VITE_FIREBASE_APP_ID`              | Yes      | Config → `appId`                    |
| `VITE_FIREBASE_STORAGE_BUCKET`      | No       | Config → `storageBucket`            |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | No       | Config → `messagingSenderId`        |
| `VITE_API_BASE_URL`                 | No (yet) | Apps Script web app `/exec` URL     |

These are **public identifiers**, not secrets. Restart `npm run dev` after editing env files.
If a required value is missing, the login page shows a configuration notice and the browser
console names the missing variables.

### Frontend code map

| File                                    | Responsibility                                                   |
| --------------------------------------- | ---------------------------------------------------------------- |
| `services/firebase/firebaseConfig.ts`   | Reads/validates env vars; singleton Firebase app                 |
| `services/firebase/firebaseAuth.ts`     | Sign-in/out, persistence, ID tokens, error mapping               |
| `services/auth/accountAccess.ts`        | Calls `GET /auth/session` to detect inactive accounts (UX only)  |
| `services/api/apiClient.ts`             | Backend client (POST envelope, see API_DOCUMENTATION.md)         |
| `contexts/AuthContext.tsx`              | `AuthProvider`: session state from `onAuthStateChanged`          |
| `hooks/useAuth.ts`                      | `useAuth()` hook                                                 |
| `routes/ProtectedRoute.tsx`             | Redirects signed-out users to `/login` (original URL in router state) |
| `pages/auth/LoginPage.tsx`              | Login UI; redirects signed-in users to their original page       |

### Behaviour

- **Persistence:** "Keep me signed in" → `browserLocalPersistence` (survives refresh and
  restarts). Unchecked → `browserSessionPersistence` (ends when the tab closes). Firebase keeps
  its own tokens; the app never stores passwords or tokens itself.
- **Errors:** Firebase codes are mapped to friendly messages. Wrong password and unknown email
  both show "Incorrect email or password" (no account enumeration).
- **Account check:** after sign-in and on every reload, the app calls `GET /auth/session`. If the
  backend reports the account as blocked (inactive, unregistered, gym inactive…) the user is
  signed out with a message. If the backend is not configured or unreachable the status is
  `unverified` and the UI continues, because **the backend enforces access on every request anyway**.
- **Redirects:** only same-origin relative paths are accepted as the post-login target
  (prevents open redirects).

## 3. Backend token verification

Implemented in `backend/apps-script/src/FirebaseVerificationService.gs`.

### Why not verify the RS256 signature locally?

Firebase recommends verifying ID tokens with the Admin SDK or a vetted JWT library. Apps Script
can run neither: it has no Node runtime, and its `Utilities` service can **sign** with RSA but
cannot **verify** RSA signatures. Hand-written RSA or a pasted-in JS crypto library would be
homemade cryptography, which this project forbids.

### What the backend does instead

1. **Cheap local rejection:** must be a 3-part JWT ≤ 4096 chars, with header `alg = RS256` and a
   `kid`. The decoded claims must satisfy all of these:
   - `aud` = `FIREBASE_PROJECT_ID`
   - `iss` = `https://securetoken.google.com/<FIREBASE_PROJECT_ID>`
   - `sub` is a non-empty string of at most 128 characters
   - `exp` is in the future
   - `iat` and `auth_time` are not in the future

   A clock skew of 60 s is allowed (`CLOCK_SKEW_SECONDS`). Expired or foreign tokens never
   reach the network.
2. **Google verification:** `POST https://identitytoolkit.googleapis.com/v1/accounts:lookup`
   with the token. Google checks the signature against the current Firebase signing keys
   (**key rotation is handled by Google**) and returns the account, or `INVALID_ID_TOKEN`.
3. **Account checks:** Google's `localId` must equal the token's `sub`. The backend then rejects
   these cases:
   - `disabled: true` → `ACCOUNT_DISABLED`
   - token `iat` earlier than the account's `validSince` → `TOKEN_REVOKED`
4. **Cache:** a successful result is cached in `CacheService` for
   `min(TOKEN_CACHE_SECONDS (default 120), token lifetime)`. The cache is keyed by the token's
   SHA-256 hash; tokens are never stored or logged.

### Revocation: what is and isn't covered

| Event                                                    | Detected? | Delay                       |
| -------------------------------------------------------- | --------- | --------------------------- |
| User disabled in Firebase console                        | Yes       | ≤ `TOKEN_CACHE_SECONDS`     |
| Refresh tokens revoked (Admin SDK) / password changed    | Yes (`validSince`) | ≤ `TOKEN_CACHE_SECONDS` |
| User deleted in Firebase                                 | Yes (lookup fails) | ≤ `TOKEN_CACHE_SECONDS` |
| `Users.Status` set to `INACTIVE` in the sheet            | Yes       | Immediate (read every request) |
| `Gyms.Status` not `ACTIVE`                               | Yes       | Immediate                   |

Set `TOKEN_CACHE_SECONDS=0` for immediate Firebase-side revocation, at the cost of one Google
call per request (UrlFetch quotas apply; see BACKEND_SETUP.md).

### Trade-offs of this approach

- Every uncached request makes one outbound call to Google, which adds latency (typically about
  100–300 ms) and counts against the `UrlFetchApp` daily quota.
- The backend needs a Firebase Web API key (`FIREBASE_WEB_API_KEY` Script Property). Use a
  **separate key restricted to the Identity Toolkit API** with no browser restrictions. Never
  reuse a key that has HTTP-referrer restrictions: server calls carry no referrer and would fail.
- `accounts:lookup` is a documented Google REST endpoint, but its exact error strings can
  change. All non-200 responses fail closed, as 401 or 503.

### Alternative: dedicated verification service

If you need local signature verification against Google's public keys (for example for
higher throughput, or for no per-request Google call), put a small verifier in front of Apps
Script:

- **Cloudflare Worker** (free tier) using [`jose`](https://github.com/panva/jose):
  `createRemoteJWKSet('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')`
  plus `jwtVerify(token, jwks, { issuer, audience: projectId, algorithms: ['RS256'] })`.
  `jose` caches the keys and refetches them when an unknown `kid` appears (rotation).
- **Cloud Run / Cloud Functions** with `firebase-admin` `verifyIdToken(token, true)`, which also
  checks revocation.

The verifier would forward the verified UID to Apps Script, authenticated with a shared secret
held in Script Properties and in the Worker's secret store. The rest of the backend (Users
lookup, permissions, tenant checks) stays unchanged. Only `verifyFirebaseIdToken_` is swapped.

## 4. Testing

| Scenario                         | How it is tested                                                   | Status          |
| -------------------------------- | ------------------------------------------------------------------ | --------------- |
| Claim rules (exp/iat/iss/aud/sub/alg) | `npm run test:backend` (unit)                                 | ✅ passing locally |
| Forged / invalid / expired token | `npm run test:backend` (mocked Google) + `runLiveTokenTests()` in the editor (real Google) | Mocked ✅, live ⏳ needs setup |
| Unknown UID / inactive user / inactive gym / valid user / role / cross-gym | `npm run test:backend` (pipeline, in-memory sheet) | ✅ passing locally |
| Real token end-to-end            | `runLiveSessionTest()` in the editor                               | ⏳ needs setup  |
| Login, wrong password, logout, refresh, protected routes (frontend) | Manual checklist below                | ⏳ needs API key |

### Get an ID token for live tests

Sign in to the app running under `npm run dev`, then in the browser DevTools console:

```js
await __devGetIdToken()
```

This helper exists only in development builds; it is stripped from `npm run build` output.
Never commit or share tokens; they expire after one hour.

### Frontend manual checklist

1. `npm run dev`, open `http://localhost:5173/` → redirected to `/login` (protected route).
2. Wrong password → "Incorrect email or password", password field cleared.
3. Malformed email → inline validation, no request sent.
4. Valid credentials → returned to the page you originally requested.
5. Refresh the page → still signed in (with "Keep me signed in" checked).
6. Uncheck "Keep me signed in", sign in, close the tab, reopen → signed out.
7. Click **Sign out** → back on `/login`; browser Back does not show protected pages.
8. Visit `/login` while signed in → redirected to `/`.
9. Disable the user in Firebase console → next sign-in shows "This account has been disabled".
