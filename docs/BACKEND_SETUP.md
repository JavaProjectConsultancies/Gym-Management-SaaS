# Backend Setup (Google Apps Script + Google Sheets)

> Nothing in this guide has been executed yet. Follow it step by step. **Do not create a
> deployment until the backend has been reviewed and approved** (step 7).

## Overview

```
backend/apps-script/
├── .clasp.json.example     template (real .clasp.json is git-ignored)
└── src/                    pushed to Apps Script (clasp rootDir)
    ├── appsscript.json     manifest: V8, scopes, web-app settings
    ├── Config.gs           schema, roles/permissions, Script Properties
    ├── Router.gs           doGet/doPost, routes, middleware pipeline
    ├── AuthService.gs      token → Users row → user/gym status → context
    ├── FirebaseVerificationService.gs   ID-token verification
    ├── PermissionService.gs             permissions + cross-gym checks
    ├── UserService.gs  GymService.gs    domain services
    ├── SpreadsheetService.gs            all Sheets access, IDs, LockService
    ├── AuditService.gs  ResponseService.gs  ValidationService.gs
    ├── Setup.gs            editor-only: config check, DB init, provisioning
    └── Tests.gs            editor-only: unit + live tests
```

## 1. Create the central spreadsheet

You already have one:
`https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`. The ID is the part between
`/d/` and `/edit`.

- Use a dedicated spreadsheet for the platform, owned by the account that will deploy the script.
- Keep it **private** (do not share it with gym users).
- Leave it empty. `initializeDatabase()` creates the four tabs. The default `Sheet1` can be
  deleted afterwards.
- **Recommended:** create a second, separate *test* spreadsheet and a separate test copy of
  the script for the concurrency test and experiments.

## 2. Put the code into the Apps Script project

Your project: `https://script.google.com/home/projects/<SCRIPT_ID>/edit`.

**Option A: clasp (recommended).** clasp is installed per project, not globally:

```bash
cd backend/apps-script
npm init -y && npm install --save-dev @google/clasp   # one time
npx clasp login                                        # opens browser, stores token in ~/.clasprc.json
# .clasp.json is git-ignored; create it from the example if missing:
#   { "scriptId": "<SCRIPT_ID>", "rootDir": "src" }
npx clasp push                                         # uploads src/ — this is NOT a deployment
```

Enable the Apps Script API for your account first: https://script.google.com/home/usersettings

> `clasp push` **replaces** the files in the online project. If the project already contains
> code you want to keep, run `npx clasp pull` into a separate folder first.

**Option B: copy and paste.** In the editor, create one script file per `.gs` file (same names,
without the extension), paste the contents, and replace `appsscript.json`. To show the manifest,
go to Project Settings → *Show "appsscript.json" manifest file in editor*.

## 3. Configure Firebase details

See [AUTHENTICATION.md](AUTHENTICATION.md) §1. You need:

- the **Firebase project ID**: `gym-management-saas-831ad`
- a **Web API key** for server use. Recommended: Google Cloud console (same project) →
  *APIs & Services* → *Credentials* → *Create credentials* → *API key*. Then:
  - Application restrictions: *None*. Apps Script calls carry no referrer or IP you can pin.
  - API restrictions: *Restrict key* → **Identity Toolkit API** only.

  The browser key from the Firebase config also works, but only if it has no HTTP-referrer
  restriction. A dedicated server key is cleaner.

## 4. Configure Script Properties

Apps Script editor → ⚙ **Project Settings** → **Script Properties** → *Add script property*:

| Property | Required | Value |
| -------- | -------- | ----- |
| `SPREADSHEET_ID` | Yes | Central spreadsheet ID (step 1) |
| `FIREBASE_PROJECT_ID` | Yes | `gym-management-saas-831ad` |
| `FIREBASE_WEB_API_KEY` | Yes | Server API key (step 3) |
| `ENVIRONMENT` | No | `development` / `production` (informational) |
| `TOKEN_CACHE_SECONDS` | No | Default `120`, range 0–600. `0` = check Google on every request |
| `CLOCK_SKEW_SECONDS` | No | Default `60`, range 0–300 |
| `BOOTSTRAP_PROVISION` | Temporary | JSON for step 6. Deleted automatically after use |

Then run **`checkConfiguration`** (select it in the toolbar → *Run*). The first run asks you
to authorize:
- Sheets access (`spreadsheets`)
- external requests (`script.external_request`, needed to reach Google's token endpoint)

## 5. Initialize the database

Run **`initializeDatabase`**. It:

- creates the `Gyms`, `Users`, `Gym_Settings` and `Platform_Audit_Log` tabs with headers;
- formats columns as plain text and freezes the header row;
- **never** deletes or overwrites data. Re-running it is safe. It stops with an error if an
  existing tab has unexpected headers.

Then run **`validateDatabase`** (read-only) and **`runUnitTests`** (no data access). Check the
Execution log.

### 5b. Gym spreadsheets (Phase 4)

Each gym's own data (members, and later memberships, payments, attendance) lives in a
**separate spreadsheet per gym**. Run **`initializeGymDatabases`**. It:

- creates a spreadsheet named `Gym data — <gym name> (<Gym_ID>)` in the script owner's Drive
  for every gym that has none, and records its ID in `Gyms.Spreadsheet_ID`;
- creates or upgrades the per-gym tabs (`Members`, …) with headers;
- **never** deletes or rewrites data, refuses two gyms sharing one spreadsheet, and is safe
  to re-run.

Run it again after every backend update that adds per-gym tabs (Phase 6 added
`Membership_Plans` and `Memberships`; Phase 7 added `Payments`; Phase 8 added `Attendance`; Phase 9 appended `Trainer_ID` to `Members`).

**Staff invites (Phase 9)** use Firebase's password-reset email as the "set your password"
email. Customise its wording in Firebase console → *Authentication* → *Templates* →
*Password reset* (e.g. "Set your password for Gymora"). Web requests never create
spreadsheets; until a gym has one, its member endpoints return `503 GYM_DATABASE_NOT_READY`.
New gyms created by provisioning (step 6) get their spreadsheet automatically.

Do not move gym spreadsheets out of the script owner's Drive, and do not share them with
gym staff: all access must go through the API so permissions and audit logging apply.

## 6. Provision the first gym and owner

1. Create the owner in Firebase console → *Authentication* → *Users* → *Add user*, and copy
   the **User UID**.
2. Add the Script Property `BOOTSTRAP_PROVISION`:
   ```json
   {
     "gym": { "name": "Your Gym Name" },
     "owner": { "firebaseUid": "<owner UID>", "email": "owner@yourgym.com", "fullName": "Owner Name" }
   }
   ```
   Optionally add `"platformAdmin": { "firebaseUid": …, "email": …, "fullName": … }` for
   yourself (a separate Firebase user is recommended).
3. Run **`provisionFromBootstrapProperty`**. The property is deleted when it finishes.
4. Check the `Gyms`, `Users` and `Platform_Audit_Log` tabs. The gym row now has a
   `Spreadsheet_ID` (its gym spreadsheet was created automatically).

## 7. Deploy the web app (only when approved)

1. Run the live tests first (no data writes):
   - **`runLiveTokenTests`**: confirms Google rejects forged, expired and garbage tokens with
     your real configuration.
   - **`runLiveSessionTest`**: put a fresh ID token of the provisioned owner in Script
     Property `TEST_ID_TOKEN` (see AUTHENTICATION.md §4); the property is deleted afterwards.
     Expect `status: 200` with the owner's role and gym.
2. *Deploy* → *New deployment* → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**

   See [SECURITY.md](SECURITY.md) for why "Anyone" is required and what it implies.
3. Copy the `/exec` URL into `web/.env.local` as `VITE_API_BASE_URL` (and later into
   Cloudflare Pages env vars). Restart `npm run dev`.
4. Health check: `curl -sL "<exec URL>?path=/health"`.
5. To publish code changes, use *Deploy* → *Manage deployments* → edit → *New version*. This
   keeps the same URL. Every change requires a new version; `clasp push` alone does not update
   the live web app.

### Concurrency test (test deployment only)

Against a deployment backed by the **test** spreadsheet, using a GYM_OWNER token of a test gym:

```powershell
$env:API_URL="https://script.google.com/macros/s/<test-deployment>/exec"
$env:ID_TOKEN="<fresh token>"
$env:GYM_ID="GYM-..."
$env:CONFIRM_TEST_DEPLOYMENT="yes"
node scripts/concurrency-test.mjs
```

It fires parallel writes to distinct keys and to one shared key, then checks that there are no
lost writes and no duplicate rows. It creates `test.concurrency_*` settings in that test gym.

## Local tests

```bash
npm run test:backend     # 87 tests: Tests.gs unit tests + mocked pipeline tests
```

These run the real `.gs` files in Node with in-memory stubs for Apps Script services, a
**mocked** Google endpoint and an in-memory spreadsheet. They prove the backend's own logic, not
Google's behaviour. The live tests in step 7 cover that.

### Test plan coverage

| Scenario | Local (`npm run test:backend`) | Live (editor / deployed) |
| -------- | ------------------------------ | ------------------------ |
| Invalid Firebase token | ✅ forged signature, garbage, alg none/HS256, wrong project | `runLiveTokenTests` |
| Expired token | ✅ | `runLiveTokenTests` |
| Unknown Firebase UID | ✅ `USER_NOT_REGISTERED` | Sign in with a Firebase user that has no `Users` row |
| Inactive user | ✅ `USER_INACTIVE` | Set `Users.Status=INACTIVE`, call `/auth/session` |
| Inactive gym | ✅ `GYM_INACTIVE` (suspended + inactive) | Set `Gyms.Status=SUSPENDED` |
| Valid user | ✅ role/gym from DB | `runLiveSessionTest` |
| Unauthorized role | ✅ MEMBER `PUT settings` → 403 | Provision a MEMBER, attempt a write |
| Cross-gym access | ✅ read + write → 404, audited, nothing written | Second test gym; use gym A's token on gym B's path |
| Concurrent writes | Upsert/no-duplicate logic ✅ (sequential) | `scripts/concurrency-test.mjs` |

## Quotas to keep in mind (consumer Gmail account; Workspace is higher)

| Quota | Limit (approx.) | Impact |
| ----- | --------------- | ------ |
| URL Fetch calls | 20,000 / day | One per uncached token verification |
| Script runtime | 6 min / execution, 90 min/day for triggers | Requests are short |
| Simultaneous executions | ~30 per user | Web-app concurrency ceiling |

Current limits: https://developers.google.com/apps-script/guides/services/quotas

## Troubleshooting

| Symptom | Cause |
| ------- | ----- |
| `SERVER_MISCONFIGURED` | Script Property missing. Run `checkConfiguration` |
| `DATABASE_NOT_INITIALIZED` | Run `initializeDatabase` |
| `AUTH_SERVICE_UNAVAILABLE` on every call | Wrong API key, Identity Toolkit API not allowed for the key, or quota exceeded. See *Executions* logs |
| `INVALID_TOKEN` with a fresh token | `FIREBASE_PROJECT_ID` doesn't match the token's project |
| Browser: CORS error | Frontend must send `text/plain` (it does), and the deployment must be "Anyone" |
| Changes not live | Create a new deployment version |
