# API Documentation

Base URL: the Apps Script web app URL, `https://script.google.com/macros/s/<deployment-id>/exec`
(the frontend reads it from `VITE_API_BASE_URL`).

## Google Apps Script web app limitations

| Limitation | Consequence / design |
| ---------- | -------------------- |
| Only `doGet` and `doPost` exist (no PUT/PATCH/DELETE) | The logical method goes in the JSON body; every API call is an HTTP `POST` |
| Request headers cannot be read | No `Authorization` header; the ID token travels in the body (never in the URL, where it would be logged) |
| Responses are always HTTP 200 and custom headers are impossible | The logical status is `status` in the body; clients must check `ok` |
| No CORS preflight (`OPTIONS`) support | Send `Content-Type: text/plain;charset=utf-8` (a "simple" request). The browser follows Google's 302 redirect to `script.googleusercontent.com`, which allows any origin |
| Execution limit 6 min/request; daily quotas (UrlFetch, runtime) | Keep requests small; see BACKEND_SETUP.md for quotas |
| One script lock for all writes | Writes are serialized; a busy server returns `503 LOCK_TIMEOUT` |
| Cold starts | The first request after idle can take 1–3 s |

## Request format

```http
POST /exec
Content-Type: text/plain;charset=utf-8

{
  "method": "PUT",
  "path": "/gyms/GYM-3f2b.../settings/business.name",
  "idToken": "<Firebase ID token>",
  "body": { "value": "Iron Temple" },
  "requestId": "optional-client-correlation-id"
}
```

- Only these five top-level fields are accepted; any other field → `400 BAD_REQUEST`.
- `path` may contain `A–Z a–z 0–9 _ . - /` only, with no `..`. Max request size is 20 KB.
- `body` fields are validated per endpoint. Unknown fields are rejected, so a client cannot
  send `Gym_ID`, `Role` and so on.

## Response format

```json
{ "ok": true, "status": 200, "data": { ... }, "requestId": "…", "timestamp": "2026-11-24T10:15:30.000Z" }
```

```json
{ "ok": false, "status": 403, "error": { "code": "FORBIDDEN", "message": "…", "details": { } },
  "requestId": "…", "timestamp": "…" }
```

`message` is safe to show to users. Internal details are logged server-side only (use
`requestId` to find them in Executions / Cloud Logging).

## Request pipeline

1. **Parse:** valid JSON, size limit, allowed fields.
2. **Route:** method + path; `404` or `405` otherwise.
3. **Authenticate** (all routes except `/health`): verify the token, then load the `Users` row
   by Firebase UID, then check user status, gym existence and gym status.
4. **Authorize:** the role's permission, then the tenant check (the path's `gymId` must be the
   user's own gym, unless `PLATFORM_ADMIN`).
5. **Validate** the body.
6. **Handler**, then the standard envelope. Errors are handled centrally in `handleRequest_`.

## Endpoints

### `GET /health` (public)

Also available as an HTTP GET: `<base>/exec?path=/health`.

```json
{ "status": "ok", "service": "gym-management-saas-api", "version": "0.1.0" }
```

### `GET /auth/session`

Permission `session:read`. Returns the caller's profile, gym and effective permissions, all from
the database. The frontend uses this to detect blocked accounts.

```json
{
  "user": { "userId": "USR-…", "email": "owner@gym.com", "fullName": "…", "role": "GYM_OWNER", "status": "ACTIVE", "gymId": "GYM-…" },
  "gym": { "gymId": "GYM-…", "name": "Iron Temple", "status": "ACTIVE", "createdAt": "…" },
  "permissions": ["session:read", "gym:read", "settings:read", "settings:write", "audit:read"]
}
```

### `GET /gyms/{gymId}`

Permission `gym:read` plus the tenant check. Returns `{ "gym": { … } }`. `ownerUid` and
`spreadsheetId` are included only for `PLATFORM_ADMIN`.

### `GET /gyms/{gymId}/settings`

Permission `settings:read` plus the tenant check. Returns
`{ "settings": [ { "settingId", "key", "value", "updatedAt" } ] }`.

### `PUT /gyms/{gymId}/settings/{settingKey}`

Permission `settings:write` plus the tenant check. Body: `{ "value": "<string ≤2000>" }`.
Creates the setting (`201`) or updates it (`200`), atomically under the script lock, and writes
an audit entry. Returns `{ "setting": { … } }`.

### Members (Phase 5)

All member endpoints run the tenant check on `{gymId}` (another gym → `404`), read and write
only the gym's own spreadsheet, and filter on `Gym_ID`. Writes run under the script lock and
are audited (`MEMBER_CREATED`, `MEMBER_UPDATED`, `MEMBER_DEACTIVATED`, `MEMBER_REACTIVATED`).
If the gym's spreadsheet has not been set up yet, they return `503 GYM_DATABASE_NOT_READY`.

A member object:

```json
{
  "memberId": "MEM-…", "fullName": "Ravi Kumar", "phone": "+919876543210",
  "email": "ravi@example.com", "gender": "MALE", "dateOfBirth": "1995-04-12",
  "address": null, "emergencyContactName": null, "emergencyContactPhone": null,
  "joinDate": "2026-11-24", "status": "ACTIVE", "notes": null,
  "createdAt": "2026-11-24T09:10:00.000Z", "updatedAt": "2026-11-24T09:10:00.000Z"
}
```

#### `GET /gyms/{gymId}/members` — `members:read`

Paths cannot carry a query string, so parameters go in `body` (all optional):
`{ "search": "<≤100>", "status": "ACTIVE"|"INACTIVE", "page": 1, "pageSize": 25 }`
(`pageSize` ≤ 100). `search` matches name or email (substring), member ID (exact), or phone
digits (≥ 3 digits, separators ignored). Newest members first.
Returns `{ "members": [...], "page", "pageSize", "total", "counts": { "all", "active", "inactive" } }`.

#### `POST /gyms/{gymId}/members` — `members:write`

Body: `fullName` and `phone` (required); `email`, `gender`, `dateOfBirth`, `address`,
`emergencyContactName`, `emergencyContactPhone`, `joinDate` (default today), `notes`.
`status`, IDs, `Gym_ID` and creator are set by the server; sending them is a `400`.
Returns `201 { "member": … }`. A phone already used in this gym → `409 MEMBER_PHONE_EXISTS`
with `details.fields.phone` and `details.memberId` of the existing member.

#### `GET /gyms/{gymId}/members/{memberId}` — `members:read`

Returns `{ "member": … }`. Unknown member, or a member of another gym → `404`.

#### `PATCH /gyms/{gymId}/members/{memberId}` — `members:write`

Partial update: send only the fields to change, plus optionally `status`. An optional field
sent as `""` or `null` is cleared; required fields (`fullName`, `phone`, `joinDate`,
`status`) cannot be cleared. Deactivate with `{ "status": "INACTIVE" }`. There is no DELETE.
Returns `{ "member": … }`.

### Plans (Phase 6)

A plan: `{ "planId": "PLN-…", "name": "Monthly", "durationDays": 30, "price": 1500, "description": null, "status": "ACTIVE", "createdAt", "updatedAt" }`.
Plan names are unique per gym (ignoring case). Plans are never deleted — deactivate them.

| Endpoint | Permission | Notes |
| -------- | ---------- | ----- |
| `GET /gyms/{gymId}/plans` | `plans:read` | Body: `{ "status"?: "ACTIVE"\|"INACTIVE" }`. Active first, then by name |
| `POST /gyms/{gymId}/plans` | `plans:write` | Body: `name` (2–80), `durationDays` (1–3650, whole), `price` (0–10,000,000, ≤ 2 decimals, a JSON number), `description`? → `201 { plan }`. Duplicate name → `409 PLAN_NAME_EXISTS` |
| `PATCH /gyms/{gymId}/plans/{planId}` | `plans:write` | Partial; also `status`. Changes apply to **future** sales only |

### Memberships (Phase 6)

A membership is a member's subscription to a plan for a date range. Plan name and price are
**snapshots** taken at sale time. Only `ACTIVE`/`CANCELLED` is stored; `state` is computed
from the dates in the gym's time zone on every request:

| `state` | Meaning |
| ------- | ------- |
| `UPCOMING` | Starts in the future (`daysLeft` = days until start) |
| `ACTIVE` | Running, more than 7 days left (`daysLeft` includes today) |
| `EXPIRING` | Running, 7 days or fewer left |
| `EXPIRED` | Ended |
| `CANCELLED` | Cancelled (kept in history) |

A membership: `{ "membershipId": "MSP-…", "memberId", "planId", "planName", "startDate", "endDate", "price", "status", "state", "daysLeft", "notes", "cancelReason", "createdAt", "updatedAt", "member"?: { "memberId", "fullName", "phone", "status" } }`.

| Endpoint | Permission | Notes |
| -------- | ---------- | ----- |
| `GET /gyms/{gymId}/memberships` | `memberships:read` | Body: `state`?, `search`? (member name/phone or plan), `page`, `pageSize` (≤ 100). Default excludes cancelled. `state: "EXPIRED"` returns **lapsed members**: each active member's latest expired membership, only if nothing is running or upcoming. Returns `counts` per state (EXPIRED = lapsed members) |
| `GET /gyms/{gymId}/members/{memberId}/memberships` | `memberships:read` | `{ memberships (newest first), current, next, suggestedStartDate }` |
| `POST /gyms/{gymId}/members/{memberId}/memberships` | `memberships:write` | Body: `planId`, `startDate`? (default `suggestedStartDate`: the day after the latest running/upcoming one ends, else today; must be within ±1 year), `price`? (default plan price), `notes`? → `201 { membership }`. End date = start + duration − 1 |
| `POST /gyms/{gymId}/memberships/{membershipId}/cancel` | `memberships:write` | Body: `{ "reason"? }` → `{ membership }`. Frees the dates |

Sale rules (checked inside the script lock): member must be `ACTIVE` (`409 MEMBER_INACTIVE`),
plan must belong to the gym (`400`) and be `ACTIVE` (`409 PLAN_INACTIVE`), and dates may not
overlap another non-cancelled membership of the member (`409 MEMBERSHIP_OVERLAP`, with
`details.suggestedStartDate`). Audit actions: `PLAN_CREATED`, `PLAN_UPDATED`,
`PLAN_DEACTIVATED`, `PLAN_REACTIVATED`, `MEMBERSHIP_CREATED`, `MEMBERSHIP_CANCELLED`.

### Payments (Phase 7)

Money is recorded **against a membership**. Membership objects now include `amountPaid` and
`balanceDue` (price snapshot − recorded payments; 0 when cancelled). Payments are never edited
or deleted: a mistake is **voided** with a reason, which makes the amount due again. Receipt
numbers are sequential per gym (`R-000001`, …), assigned inside the script lock and never
reused. Amounts are computed in paise (integers) to avoid rounding errors.

A payment: `{ "paymentId": "PAY-…", "receiptNo": "R-000001", "memberId", "membershipId", "amount", "method", "paymentDate", "reference", "notes", "status": "RECORDED"|"VOIDED", "voidReason", "createdAt", "updatedAt", "member"?, "membership"? }`.
Methods: `CASH`, `UPI`, `CARD`, `BANK_TRANSFER`, `OTHER`.

| Endpoint | Permission | Notes |
| -------- | ---------- | ----- |
| `POST /gyms/{gymId}/memberships/{membershipId}/payments` | `payments:write` | Body: `amount` (> 0, ≤ balance due, ≤ 2 decimals), `method`, `paymentDate`? (today default; not future; ≤ 1 year back), `reference`?, `notes`? → `201 { payment, membership }`. Over balance → `409 PAYMENT_EXCEEDS_BALANCE` (`details.balanceDue`); cancelled membership → `409 MEMBERSHIP_CANCELLED` |
| `GET /gyms/{gymId}/payments` | `payments:read` | Body: `from`?, `to`? (default: this month), `method`?, `search`? (member, phone, receipt no., reference), `includeVoided`?, `page`, `pageSize`. Returns `totals: { count, amount, byMethod }` of recorded payments in the range |
| `GET /gyms/{gymId}/payments/{paymentId}` | `payments:read` | Receipt: payment + member + membership (with current `balanceDue`) + `gymName` |
| `GET /gyms/{gymId}/members/{memberId}/payments` | `payments:read` | Member's payments, newest first |
| `GET /gyms/{gymId}/dues` | `payments:read` | Memberships not cancelled with `balanceDue > 0`, oldest first, plus `totalDue` |
| `POST /gyms/{gymId}/payments/{paymentId}/void` | `payments:void` | Body: `{ "reason" }` (3–300 chars, required). `409 PAYMENT_ALREADY_VOIDED` |

**Pay at sale:** `POST …/members/{memberId}/memberships` also accepts `paymentAmount`,
`paymentMethod` (required with an amount) and `paymentReference`. The membership and its
first payment are saved in one locked step; an amount above the price is refused before
anything is written. The response includes `payment`.

Audit actions: `PAYMENT_RECORDED`, `PAYMENT_VOIDED`.

### Attendance (Phase 8)

One visit per member per gym-local day. Check-in/out times are **server** timestamps (UTC ISO);
the client cannot set the time, date or status. Visits are never deleted: mistakes are voided.

A visit: `{ "attendanceId": "ATT-…", "memberId", "membershipId" (covering membership, or null), "visitDate", "checkInAt", "checkOutAt", "status": "IN"|"OUT"|"VOIDED", "overrideReason", "voidReason", "member"? }`.

| Endpoint | Permission | Notes |
| -------- | ---------- | ----- |
| `GET /gyms/{gymId}/attendance/lookup` | `attendance:write` | Body: `{ "query" }` (≥ 2 chars: name, phone digits, member ID). Up to 10 members with `membership` covering today (with `balanceDue`), `lastMembershipEnd`, and `today` (their visit, if any) |
| `POST /gyms/{gymId}/attendance/check-in` | `attendance:write` | Body: `memberId`, `override`?, `overrideReason`? → `201 { attendance, membership, warnings }`. `warnings`: `BALANCE_DUE`, `EXPIRING_SOON`, `NO_ACTIVE_MEMBERSHIP` (money owed never blocks entry). Errors: `409 MEMBER_INACTIVE`, `409 ALREADY_CHECKED_IN` (`details.attendance`), `409 NO_ACTIVE_MEMBERSHIP` (`details.canOverride`) — retry with `override: true` and a reason (≥ 3 chars), which is stored |
| `POST /gyms/{gymId}/attendance/{attendanceId}/check-out` | `attendance:write` | `409 NOT_CHECKED_IN` if already out/voided |
| `POST /gyms/{gymId}/attendance/{attendanceId}/void` | `attendance:void` | Body: `{ "reason" }` (required). The member may check in again that day |
| `GET /gyms/{gymId}/attendance` | `attendance:read` | Body: `date`? (default today), `status`? (`IN`/`OUT`), `search`?, `includeVoided`?, paging (≤ 200). Returns `counts: { total, in, out, overrides }` |
| `GET /gyms/{gymId}/members/{memberId}/attendance` | `attendance:read` | Last 90 days of visits + `stats: { last30Days, last90Days, lastVisit }` |

Audit actions: `CHECKED_IN`, `CHECKED_IN_OVERRIDE`, `CHECKED_OUT`, `ATTENDANCE_VOIDED`.

### Team: staff & trainers (Phase 9)

Staff are rows in the central `Users` tab with a Firebase login. **Inviting** creates the login
through Firebase's public `accounts:signUp` endpoint (web API key) with a random password that
is never shown or stored, then calls `accounts:sendOobCode` (`PASSWORD_RESET`) so Firebase
emails the person a link to choose their own password. If saving the Users row fails, the new
login is deleted again (`accounts:delete`).

Rules: assignable roles are `GYM_ADMIN`, `TRAINER`, `STAFF` only (owners and members are
never created/changed here). A `GYM_ADMIN` manages trainers and staff only; only the owner
(or a platform admin) manages admins. Nobody changes their own role or status. One login per
email across the platform. Deactivation (`status: INACTIVE`) blocks the person's next request.

A team member: `{ "userId": "USR-…", "fullName", "email", "role", "status", "createdAt", "updatedAt" }`.

| Endpoint | Permission | Notes |
| -------- | ---------- | ----- |
| `GET /gyms/{gymId}/staff` | `staff:read` | Owner first, then admins, trainers, staff; active before inactive |
| `POST /gyms/{gymId}/staff` | `staff:write` | Body: `fullName`, `email`, `role` → `201 { staff, inviteEmailSent }`. `409 EMAIL_IN_USE` (already a user), `409 EMAIL_HAS_LOGIN` (Firebase login exists), `403` for roles you may not give |
| `PATCH /gyms/{gymId}/staff/{userId}` | `staff:write` | Partial: `fullName`, `role`, `status` |
| `POST /gyms/{gymId}/staff/{userId}/resend-invite` | `staff:write` | Sends the password-setup email again (active users only) |
| `GET /gyms/{gymId}/trainers` | `members:read` | Active trainers `[{ userId, fullName }]`, for assigning members |

**Members ↔ trainers:** member create/update accept `trainerId` (an active trainer of the same
gym; `""` clears it); member objects include `trainerId` and `trainerName`;
`GET …/members` accepts `trainerId` to list one trainer's members ("My members").

Audit actions: `STAFF_INVITED`, `STAFF_UPDATED`, `STAFF_DEACTIVATED`, `STAFF_REACTIVATED`,
`STAFF_INVITE_RESENT`, `MEMBER_TRAINER_ASSIGNED`.

## Error codes

| Status | Code | Meaning |
| ------ | ---- | ------- |
| 400 | `BAD_REQUEST` | Malformed JSON/envelope, unknown fields, bad path |
| 400 | `VALIDATION_FAILED` | Body or path parameter invalid (`details.fields`) |
| 401 | `UNAUTHENTICATED` | No `idToken` supplied |
| 401 | `INVALID_TOKEN` | Token malformed, forged, wrong project, or rejected by Google |
| 401 | `TOKEN_EXPIRED` | Token expired. The client should refresh it (`getIdToken(true)`) and retry once |
| 401 | `TOKEN_REVOKED` | Sessions revoked / password changed. Sign in again |
| 401 | `ACCOUNT_DISABLED` | Firebase account disabled |
| 403 | `USER_NOT_REGISTERED` | Valid Firebase user without a `Users` row |
| 403 | `USER_INACTIVE` | `Users.Status` is not `ACTIVE` |
| 403 | `GYM_INACTIVE` | User's gym is `SUSPENDED` or `INACTIVE` |
| 403 | `GYM_NOT_FOUND` | User references a missing gym |
| 403 | `ACCOUNT_CONFLICT` | Duplicate rows, invalid role, or invalid role/gym combination |
| 403 | `FORBIDDEN` | Role lacks the required permission |
| 404 | `NOT_FOUND` | Unknown endpoint, missing record, **or another gym's resource** (cross-tenant requests get 404 so other gyms' IDs are not revealed) |
| 405 | `METHOD_NOT_ALLOWED` | Path exists, method doesn't |
| 409 | `USER_EXISTS` | Provisioning: Firebase UID already registered |
| 409 | `MEMBER_PHONE_EXISTS` | Another member of this gym already has this phone number (matched ignoring country code / leading 0) |
| 409 | `PLAN_NAME_EXISTS` | Plan name already used in this gym |
| 409 | `MEMBER_INACTIVE` / `PLAN_INACTIVE` | Cannot sell to an inactive member / an inactive plan |
| 409 | `MEMBERSHIP_OVERLAP` | Dates overlap the member's other membership (`details.suggestedStartDate`) |
| 409 | `MEMBERSHIP_ALREADY_CANCELLED` | Cancel requested twice |
| 409 | `PAYMENT_EXCEEDS_BALANCE` | Amount is more than the balance due (`details.balanceDue`) |
| 409 | `MEMBERSHIP_CANCELLED` | Payment for a cancelled membership |
| 409 | `PAYMENT_ALREADY_VOIDED` | Void requested twice |
| 409 | `ALREADY_CHECKED_IN` | Member already has a visit today |
| 409 | `NO_ACTIVE_MEMBERSHIP` | No membership running today (can be overridden with a reason) |
| 409 | `NOT_CHECKED_IN` / `ATTENDANCE_ALREADY_VOIDED` | Check-out / void not possible in the visit's state |
| 409 | `EMAIL_IN_USE` / `EMAIL_HAS_LOGIN` | Invite: email already a user / already has a Firebase login |
| 413 | `PAYLOAD_TOO_LARGE` | Request > 20 KB |
| 500 | `SERVER_MISCONFIGURED` | Script Properties missing |
| 500 | `DATA_INTEGRITY_ERROR` | Duplicate IDs/settings detected |
| 500 | `INTERNAL_ERROR` | Unexpected error (details in logs only) |
| 503 | `AUTH_SERVICE_UNAVAILABLE` | Google verification unreachable, quota exceeded, or bad server API key |
| 503 | `DATABASE_UNAVAILABLE` / `DATABASE_NOT_INITIALIZED` | Spreadsheet unreachable / tabs missing |
| 503 | `LOCK_TIMEOUT` | Server busy. Retry with backoff |
| 503 | `GYM_DATABASE_NOT_READY` | The gym's spreadsheet has not been created yet (run `initializeGymDatabases`) |

## Example (curl)

```bash
curl -sL -X POST "$API_URL" -H 'Content-Type: text/plain;charset=utf-8' \
  --data '{"method":"GET","path":"/auth/session","idToken":"'"$ID_TOKEN"'"}'
```

`-L` is required to follow Google's redirect.

## Adding an endpoint

Add a route object to `getRoutes_()` in `Router.gs` with `method`, `path`, `permission`,
`gymParam` (for tenant-scoped resources) and `bodyRules`. Add any new permission to
`PERMISSIONS` and `ROLE_PERMISSIONS` in `Config.gs`. Add tests to `Tests.gs` and
`scripts/test-backend.mjs`.
