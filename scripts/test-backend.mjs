#!/usr/bin/env node
/**
 * Local test runner for the Apps Script backend.
 *
 * Loads backend/apps-script/src/*.gs into a Node `vm` sandbox with in-memory
 * stand-ins for the Apps Script services (Utilities, PropertiesService,
 * CacheService, LockService, SpreadsheetApp, UrlFetchApp, ContentService), then:
 *
 *   1. runs the pure unit tests defined in Tests.gs, and
 *   2. runs pipeline tests here with a MOCKED Google verification endpoint and an
 *      in-memory spreadsheet.
 *
 * What this does NOT prove: that Google's real endpoint behaves as mocked. Run
 * runLiveTokenTests() / runLiveSessionTest() in the Apps Script editor for that.
 *
 * Usage: node scripts/test-backend.mjs
 */
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const SRC = process.env.BACKEND_SRC ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'apps-script', 'src')
const PROJECT = 'test-project'

/* ------------------------------------------------------------------ */
/* Apps Script service stubs                                           */
/* ------------------------------------------------------------------ */

function toBytes(value) {
  return typeof value === 'string' ? [...Buffer.from(value, 'utf8')] : value
}

const Utilities = {
  Charset: { UTF_8: 'UTF-8' },
  DigestAlgorithm: { SHA_256: 'sha256' },
  getUuid: () => randomUUID(),
  base64EncodeWebSafe: (v) => Buffer.from(toBytes(v)).toString('base64url') + '='.repeat((3 - (toBytes(v).length % 3)) % 3),
  base64DecodeWebSafe: (s) => {
    // Apps Script throws on malformed input; Node's decoder is lenient, so check strictly.
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s) || s.length % 4 !== 0) throw new Error('Invalid argument')
    return [...Buffer.from(s.replace(/=+$/, ''), 'base64url')].map((b) => (b > 127 ? b - 256 : b))
  },
  newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('utf8') }),
  computeDigest: (alg, text) => [...createHash(alg).update(text, 'utf8').digest()],
  formatDate: (date, timeZone, pattern) => {
    if (pattern !== 'yyyy-MM-dd') throw new Error('formatDate stub supports yyyy-MM-dd only')
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  },
}

/** Spreadsheet_ID recorded on a gym's central row. */
function env_gymSpreadsheetId(sheets, gymId) {
  const row = sheets.get('Gyms')._rows.find((r) => r[0] === gymId)
  return row && row[3]
}

function createEnv() {
  let lockHeld = false
  const properties = {
    SPREADSHEET_ID: 'test-spreadsheet',
    FIREBASE_PROJECT_ID: PROJECT,
    FIREBASE_WEB_API_KEY: 'test-api-key',
    TOKEN_CACHE_SECONDS: '120',
  }
  const cacheStore = new Map()
  const fetchCalls = []
  let fetchHandler = () => ({ code: 500, body: {} })

  // In-memory spreadsheets. Cells are strings; a leading apostrophe is a "force text" marker (stripped).
  function makeSheet(name) {
    const rows = []
    const sheet = {
      getName: () => name,
      getLastRow: () => rows.length,
      getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
      getMaxRows: () => Math.max(rows.length, 1000),
      appendRow: (values) => {
        assertLocked('appendRow on ' + name)
        rows.push(values.map(store))
      },
      setFrozenRows: () => sheet,
      getRange: (row, col, numRows = 1, numCols = 1) => ({
        getDisplayValues: () =>
          Array.from({ length: numRows }, (_, r) =>
            Array.from({ length: numCols }, (_, c) => (rows[row - 1 + r] || [])[col - 1 + c] ?? ''),
          ),
        setValues: (values) => {
          if (row > 1) assertLocked('setValues on ' + name) // data rows only; headers are written by setup
          values.forEach((vals, r) => {
            rows[row - 1 + r] = rows[row - 1 + r] || []
            vals.forEach((v, c) => (rows[row - 1 + r][col - 1 + c] = store(v)))
          })
        },
        setNumberFormat: function () { return this },
        setFontWeight: function () { return this },
        setBackground: function () { return this },
        setFontColor: function () { return this },
      }),
      _rows: rows,
    }
    return sheet
  }
  const store = (v) => {
    const s = String(v ?? '')
    if (/^[=+\-@]/.test(s)) throw new Error('Unescaped formula-like value written to sheet: ' + s)
    if (s.startsWith("'")) return s.slice(1)
    // Like real Google Sheets: unescaped number-like text is re-interpreted ("1500.00" → "1500").
    if (/^-?[0-9]+(\.[0-9]+)?$/.test(s.trim())) return String(Number(s.trim()))
    return s
  }

  /** Every data write must happen while the script lock is held (LockService). */
  const assertLocked = (what) => {
    if (!lockHeld) throw new Error('Write outside the script lock: ' + what)
  }

  /** All spreadsheets by ID; `sheets` (central) is kept for the older tests. */
  const spreadsheets = new Map()
  function makeSpreadsheet(id, name) {
    const tabs = new Map()
    const ss = {
      getId: () => id,
      getName: () => name,
      getSheetByName: (n) => tabs.get(n) || null,
      getSheets: () => [...tabs.values()],
      insertSheet: (n) => {
        const s = makeSheet(n)
        tabs.set(n, s)
        return s
      },
      deleteSheet: (s) => tabs.delete(s.getName()),
      _tabs: tabs,
    }
    spreadsheets.set(id, ss)
    return ss
  }
  const central = makeSpreadsheet('test-spreadsheet', 'Test DB')
  const sheets = central._tabs
  let created = 0

  const context = {
    console: { log() {}, warn() {}, error() {} },
    Utilities,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({ ...properties }),
        getProperty: (k) => properties[k] ?? null,
        deleteProperty: (k) => delete properties[k],
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => cacheStore.get(k) ?? null,
        put: (k, v) => cacheStore.set(k, v),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (lockHeld) throw new Error('Nested lock acquisition detected')
          lockHeld = true
          return true
        },
        releaseLock: () => (lockHeld = false),
      }),
    },
    SpreadsheetApp: {
      openById: (id) => {
        const ss = spreadsheets.get(id)
        if (!ss) throw new Error('Spreadsheet not found: ' + id)
        return ss
      },
      create: (name) => {
        const ss = makeSpreadsheet(`gymSheet${String(++created).padStart(4, '0')}_${randomUUID().slice(0, 12)}`, name)
        ss.insertSheet('Sheet1')
        return ss
      },
      flush: () => {},
    },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    UrlFetchApp: {
      fetch: (url, options) => {
        fetchCalls.push({ url, options })
        const res = fetchHandler(JSON.parse(options.payload), url)
        if (res instanceof Error) throw res
        return { getResponseCode: () => res.code, getContentText: () => JSON.stringify(res.body) }
      },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this } }),
    },
  }

  vm.createContext(context)
  const files = readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort()
  const code = files.map((f) => `// ---- ${f}\n${readFileSync(join(SRC, f), 'utf8')}`).join('\n')
  // Expose top-level declarations for the test code below.
  vm.runInContext(code + '\n;globalThis.__gs = { ApiError, StatusResult };', context, { filename: 'backend.gs' })

  return {
    run: (expr) => vm.runInContext(expr, context),
    context,
    properties,
    sheets,
    spreadsheets,
    gymRows: (gymId) => {
      const id = env_gymSpreadsheetId(sheets, gymId)
      return spreadsheets.get(id)._tabs.get('Members')._rows.slice(1)
    },
    cacheStore,
    fetchCalls,
    setGoogle: (fn) => (fetchHandler = fn),
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
function makeToken(overrides = {}, header = { alg: 'RS256', kid: 'k1' }) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'uid-owner-a',
    iat: now - 10,
    exp: now + 3000,
    auth_time: now - 10,
    email: 'owner@a.com',
    ...overrides,
  }
  return `${b64(header)}.${b64(payload)}.${'s'.repeat(40)}`
}

/** Google mock: accepts tokens whose signature segment is all "s" (our "valid" marker). */
function googleAccepting(accounts = {}) {
  return ({ idToken }) => {
    const [, p, sig] = idToken.split('.')
    if (!/^s+$/.test(sig)) return { code: 400, body: { error: { message: 'INVALID_ID_TOKEN' } } }
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
    return { code: 200, body: { users: [{ localId: payload.sub, email: payload.email, ...(accounts[payload.sub] || {}) }] } }
  }
}

let passed = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (e) {
    failures.push(`${name}: ${e.message}`)
  }
}
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

/** Seed: gym A (active, owner + member + inactive user), gym B (active), gym C (suspended). */
function seed(env) {
  env.run('initializeSheets_()')
  const ids = JSON.parse(
    env.run(`(() => {
      const a = createGym_({ Gym_Name: 'Gym A', Owner_UID: 'uid-owner-a' });
      const b = createGym_({ Gym_Name: 'Gym B', Owner_UID: 'uid-owner-b' });
      const c = createGym_({ Gym_Name: 'Gym C', Owner_UID: 'uid-owner-c', Status: 'SUSPENDED' });
      createUser_({ Firebase_UID: 'uid-owner-a', Gym_ID: a.Gym_ID, Email: 'owner@a.com', Full_Name: 'Owner A', Role: 'GYM_OWNER' });
      createUser_({ Firebase_UID: 'uid-member-a', Gym_ID: a.Gym_ID, Email: 'member@a.com', Full_Name: 'Member A', Role: 'MEMBER' });
      createUser_({ Firebase_UID: 'uid-inactive-a', Gym_ID: a.Gym_ID, Email: 'x@a.com', Full_Name: 'Gone', Role: 'STAFF', Status: 'INACTIVE' });
      createUser_({ Firebase_UID: 'uid-owner-c', Gym_ID: c.Gym_ID, Email: 'owner@c.com', Full_Name: 'Owner C', Role: 'GYM_OWNER' });
      createUser_({ Firebase_UID: 'uid-admin', Email: 'admin@platform.com', Full_Name: 'Admin', Role: 'PLATFORM_ADMIN' });
      return JSON.stringify({ a: a.Gym_ID, b: b.Gym_ID, c: c.Gym_ID });
    })()`),
  )
  return ids
}

function call(env, envelope) {
  env.context.__envelope = JSON.stringify(envelope)
  const out = env.run(`doPost({ postData: { contents: __envelope } })`)
  return JSON.parse(out.text)
}

/* ------------------------------------------------------------------ */
/* 1. Tests.gs unit tests                                              */
/* ------------------------------------------------------------------ */

{
  const env = createEnv()
  const result = env.run('runTestSuite_(getUnitTests_())')
  passed += result.total - result.failed
  result.failures.forEach((f) => failures.push('[Tests.gs] ' + f))
  console.log(`Tests.gs unit tests: ${result.total - result.failed}/${result.total}`)
}

/* ------------------------------------------------------------------ */
/* 2. Verification flow with mocked Google                             */
/* ------------------------------------------------------------------ */

const before = passed
{
  const env = createEnv()
  env.setGoogle(googleAccepting())

  test('verify: valid token accepted', () => {
    const id = JSON.parse(env.run(`JSON.stringify(verifyFirebaseIdToken_(${JSON.stringify(makeToken())}))`))
    eq(id.uid, 'uid-owner-a', 'uid')
  })
  test('verify: second call served from cache (no extra Google call)', () => {
    const n = env.fetchCalls.length
    env.run(`verifyFirebaseIdToken_(${JSON.stringify(makeToken())})`)
    eq(env.fetchCalls.length, n, 'fetch count')
  })
  test('verify: raw token is never used as cache key', () => {
    for (const k of env.cacheStore.keys()) if (k.includes('.')) throw new Error('token-like cache key ' + k)
  })
  test('verify: API key sent only to Google over HTTPS', () => {
    for (const c of env.fetchCalls) if (!c.url.startsWith('https://identitytoolkit.googleapis.com/')) throw new Error(c.url)
  })
}

function expectCode(env, token, status, code) {
  const r = call(env, { method: 'GET', path: '/auth/session', idToken: token })
  eq(r.status, status, `status for ${code}`)
  eq(r.error && r.error.code, code, 'code')
  return r
}

{
  const env = createEnv()
  seed(env)

  test('invalid token: forged signature rejected (Google 400 INVALID_ID_TOKEN)', () => {
    env.setGoogle(googleAccepting())
    expectCode(env, makeToken().replace(/s+$/, 'forgedforgedforgedforged'), 401, 'INVALID_TOKEN')
  })
  test('invalid token: Google TOKEN_EXPIRED → 401', () => {
    env.setGoogle(() => ({ code: 400, body: { error: { message: 'TOKEN_EXPIRED' } } }))
    expectCode(env, makeToken({ sub: 'uid-x1' }), 401, 'INVALID_TOKEN')
  })
  test('expired token rejected locally, Google never called', () => {
    const n = env.fetchCalls.length
    expectCode(env, makeToken({ exp: Math.floor(Date.now() / 1000) - 3600 }), 401, 'TOKEN_EXPIRED')
    eq(env.fetchCalls.length, n, 'fetch count')
  })
  test('token for another Firebase project rejected, Google never called', () => {
    const n = env.fetchCalls.length
    expectCode(env, makeToken({ aud: 'evil-project', iss: 'https://securetoken.google.com/evil-project' }), 401, 'INVALID_TOKEN')
    eq(env.fetchCalls.length, n, 'fetch count')
  })
  test('Google says a different UID than the token → rejected', () => {
    env.setGoogle(() => ({ code: 200, body: { users: [{ localId: 'someone-else' }] } }))
    expectCode(env, makeToken({ sub: 'uid-x2' }), 401, 'INVALID_TOKEN')
  })
  test('disabled Firebase account → 401 ACCOUNT_DISABLED', () => {
    env.setGoogle(googleAccepting({ 'uid-x3': { disabled: true } }))
    expectCode(env, makeToken({ sub: 'uid-x3' }), 401, 'ACCOUNT_DISABLED')
  })
  test('revoked session (iat < validSince) → 401 TOKEN_REVOKED', () => {
    env.setGoogle(googleAccepting({ 'uid-x4': { validSince: String(Math.floor(Date.now() / 1000)) } }))
    expectCode(env, makeToken({ sub: 'uid-x4', iat: Math.floor(Date.now() / 1000) - 100 }), 401, 'TOKEN_REVOKED')
  })
  test('Firebase Auth not enabled (400 CONFIGURATION_NOT_FOUND) → 503, not 401', () => {
    env.setGoogle(() => ({ code: 400, body: { error: { message: 'CONFIGURATION_NOT_FOUND' } } }))
    expectCode(env, makeToken({ sub: 'uid-x7' }), 503, 'AUTH_SERVICE_UNAVAILABLE')
  })
  test('invalid API key (400 API_KEY_INVALID) → 503, not 401', () => {
    env.setGoogle(() => ({ code: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }))
    expectCode(env, makeToken({ sub: 'uid-x8' }), 503, 'AUTH_SERVICE_UNAVAILABLE')
  })
  test('Google USER_NOT_FOUND (deleted account) → 401', () => {
    env.setGoogle(() => ({ code: 400, body: { error: { message: 'USER_NOT_FOUND' } } }))
    expectCode(env, makeToken({ sub: 'uid-x9' }), 401, 'INVALID_TOKEN')
  })
  test('bad API key / Google 403 → 503, not 401', () => {
    env.setGoogle(() => ({ code: 403, body: { error: { message: 'API key not valid' } } }))
    expectCode(env, makeToken({ sub: 'uid-x5' }), 503, 'AUTH_SERVICE_UNAVAILABLE')
  })
  test('network failure → 503', () => {
    env.setGoogle(() => new Error('DNS failure'))
    expectCode(env, makeToken({ sub: 'uid-x6' }), 503, 'AUTH_SERVICE_UNAVAILABLE')
  })
}

/* ------------------------------------------------------------------ */
/* 3. Multi-tenant pipeline with in-memory spreadsheet                 */
/* ------------------------------------------------------------------ */

{
  const env = createEnv()
  const gyms = seed(env)
  env.setGoogle(googleAccepting())
  const owner = makeToken({ sub: 'uid-owner-a' })
  const member = makeToken({ sub: 'uid-member-a', email: 'member@a.com' })
  const admin = makeToken({ sub: 'uid-admin', email: 'admin@platform.com' })
  const auditRows = () => env.sheets.get('Platform_Audit_Log')._rows.slice(1)

  test('unknown Firebase UID → 403 USER_NOT_REGISTERED', () => {
    expectCode(env, makeToken({ sub: 'uid-stranger' }), 403, 'USER_NOT_REGISTERED')
  })
  test('inactive user → 403 USER_INACTIVE', () => {
    expectCode(env, makeToken({ sub: 'uid-inactive-a' }), 403, 'USER_INACTIVE')
  })
  test('user of suspended gym → 403 GYM_INACTIVE', () => {
    expectCode(env, makeToken({ sub: 'uid-owner-c' }), 403, 'GYM_INACTIVE')
  })
  test('valid user → session with role/gym from DB', () => {
    const r = call(env, { method: 'GET', path: '/auth/session', idToken: owner })
    eq(r.status, 200, 'status')
    eq(r.data.user.role, 'GYM_OWNER', 'role')
    eq(r.data.gym.gymId, gyms.a, 'gym')
    eq(r.data.gym.spreadsheetId, undefined, 'Spreadsheet_ID hidden from gym users')
  })
  test('client cannot inject role/gym via envelope', () => {
    const r = call(env, { method: 'GET', path: '/auth/session', idToken: member, role: 'PLATFORM_ADMIN' })
    eq(r.status, 400, 'status')
  })
  test('client cannot inject Gym_ID via body', () => {
    const r = call(env, { method: 'PUT', path: `/gyms/${gyms.a}/settings/business.name`, idToken: owner, body: { value: 'x', Gym_ID: gyms.b } })
    eq(r.status, 400, 'status')
  })
  test('own gym readable', () => {
    eq(call(env, { method: 'GET', path: `/gyms/${gyms.a}`, idToken: owner }).status, 200, 'status')
  })
  test('cross-gym access → 404 and audited', () => {
    const n = auditRows().length
    const r = call(env, { method: 'GET', path: `/gyms/${gyms.b}/settings`, idToken: owner })
    eq(r.status, 404, 'status')
    eq(auditRows().length, n + 1, 'audit rows')
    eq(auditRows().at(-1)[2], 'CROSS_GYM_ACCESS_DENIED', 'audit action')
  })
  test('cross-gym write blocked, nothing written to other gym', () => {
    const r = call(env, { method: 'PUT', path: `/gyms/${gyms.b}/settings/business.name`, idToken: owner, body: { value: 'hijack' } })
    eq(r.status, 404, 'status')
    const leaked = env.sheets.get('Gym_Settings')._rows.slice(1).filter((row) => row[1] === gyms.b)
    eq(leaked.length, 0, 'gym B settings')
  })
  test('unauthorized role (MEMBER) cannot write settings → 403', () => {
    const r = call(env, { method: 'PUT', path: `/gyms/${gyms.a}/settings/business.name`, idToken: member, body: { value: 'x' } })
    eq(r.status, 403, 'status')
    eq(r.error.code, 'FORBIDDEN', 'code')
  })
  test('owner creates setting (201) then updates it (200) without duplicates', () => {
    const p = `/gyms/${gyms.a}/settings/business.name`
    eq(call(env, { method: 'PUT', path: p, idToken: owner, body: { value: 'Iron Temple' } }).status, 201, 'create')
    const r = call(env, { method: 'PUT', path: p, idToken: owner, body: { value: '=IMPORTXML("x")' } })
    eq(r.status, 200, 'update')
    eq(r.data.setting.value, '=IMPORTXML("x")', 'value round-trips as text')
    const rows = env.sheets.get('Gym_Settings')._rows.slice(1).filter((row) => row[2] === 'business.name')
    eq(rows.length, 1, 'one row')
  })
  test('settings listed for own gym only', () => {
    const r = call(env, { method: 'GET', path: `/gyms/${gyms.a}/settings`, idToken: owner })
    eq(r.status, 200, 'status')
    eq(r.data.settings.length, 1, 'count')
  })
  test('platform admin may read any gym and sees Spreadsheet_ID field', () => {
    const r = call(env, { method: 'GET', path: `/gyms/${gyms.b}`, idToken: admin })
    eq(r.status, 200, 'status')
    eq('spreadsheetId' in r.data.gym, true, 'field')
  })
  test('malformed gym ID in path → 400', () => {
    eq(call(env, { method: 'GET', path: '/gyms/GYM-1', idToken: owner }).status, 400, 'status')
  })
  test('oversized request → 413', () => {
    eq(call(env, { method: 'GET', path: '/health', requestId: 'x', body: { a: 'x'.repeat(30000) } }).status, 413, 'status')
  })
  test('doGet only serves /health', () => {
    eq(JSON.parse(env.run(`doGet({ parameter: {} }).text`)).status, 200, 'health')
    eq(JSON.parse(env.run(`doGet({ parameter: { path: '/auth/session' } }).text`)).status, 405, 'other')
  })
  test('initializeSheets_ is idempotent and keeps data', () => {
    const before = env.sheets.get('Users')._rows.length
    env.run('initializeSheets_()')
    eq(env.sheets.get('Users')._rows.length, before, 'rows')
  })
  test('structure validation detects wrong headers', () => {
    const users = env.sheets.get('Users')._rows
    const original = users[0][3]
    users[0][3] = 'E-mail'
    const problems = env.run('validateSpreadsheetStructure_()')
    users[0][3] = original
    if (!problems.some((p) => p.includes('E-mail'))) throw new Error(JSON.stringify(problems))
  })
  test('structure validation passes on clean DB', () => {
    eq(env.run('validateSpreadsheetStructure_().length'), 0, 'problems')
  })
  test('duplicate Firebase UID cannot be provisioned', () => {
    const r = env.run(`(() => { try { createUser_({ Firebase_UID: 'uid-owner-a', Gym_ID: '${gyms.a}', Email: 'a@a.com', Full_Name: 'Dup', Role: 'STAFF' }); return 'created'; } catch (e) { return e.code; } })()`)
    eq(r, 'USER_EXISTS', 'code')
  })
  test('missing Script Properties → 500 SERVER_MISCONFIGURED without details', () => {
    const saved = env.properties.FIREBASE_WEB_API_KEY
    delete env.properties.FIREBASE_WEB_API_KEY
    env.run('spreadsheetCache_ = null')
    const r = call(env, { method: 'GET', path: '/auth/session', idToken: makeToken({ sub: 'uid-cfg' }) })
    env.properties.FIREBASE_WEB_API_KEY = saved
    eq(r.error.code, 'SERVER_MISCONFIGURED', 'code')
    if (JSON.stringify(r).includes('FIREBASE')) throw new Error('leaked property name')
  })
}

/* ------------------------------------------------------------------ */
/* 4. Phase 4 — per-gym spreadsheets                                   */
/* ------------------------------------------------------------------ */

{
  const env = createEnv()
  const gyms = seed(env)
  env.setGoogle(googleAccepting())
  const owner = makeToken({ sub: 'uid-owner-a' })
  const ensure = (gymId) =>
    JSON.parse(
      env.run(
        `JSON.stringify(withScriptLock_(() => { const r = ensureGymDatabaseLocked_('${gymId}'); return { created: r.created, id: r.gym.Spreadsheet_ID }; }))`,
      ),
    )

  test('gym db: request before setup → 503 GYM_DATABASE_NOT_READY', () => {
    const r = call(env, { method: 'GET', path: `/gyms/${gyms.a}/members`, idToken: owner })
    eq(r.status, 503, 'status')
    eq(r.error.code, 'GYM_DATABASE_NOT_READY', 'code')
  })
  test('gym db: requests never create spreadsheets', () => {
    eq(env.spreadsheets.size, 1, 'only the central spreadsheet exists')
  })
  test('gym db: setup creates one spreadsheet per gym and records its ID', () => {
    const a = ensure(gyms.a)
    const b = ensure(gyms.b)
    eq(a.created && b.created, true, 'created')
    if (a.id === b.id) throw new Error('gyms share a spreadsheet')
    eq(env.spreadsheets.size, 3, 'spreadsheet count')
    eq(env_gymSpreadsheetId(env.sheets, gyms.a), a.id, 'Spreadsheet_ID on Gyms row')
  })
  test('gym db: new spreadsheet has Members tab with headers and no Sheet1', () => {
    const ss = env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gyms.a))
    eq(ss.getSheetByName('Sheet1'), null, 'Sheet1 removed')
    eq(ss.getSheetByName('Members')._rows[0][0], 'Member_ID', 'header')
  })
  test('gym db: setup is idempotent (no second spreadsheet)', () => {
    eq(ensure(gyms.a).created, false, 'created')
    eq(env.spreadsheets.size, 3, 'spreadsheet count')
  })
  test('gym db: creation is audited', () => {
    const rows = env.sheets.get('Platform_Audit_Log')._rows.filter((r) => r[2] === 'GYM_DATABASE_CREATED')
    eq(rows.length, 2, 'audit rows')
  })
  test('gym db: Spreadsheet_ID never returned to gym users', () => {
    const r = call(env, { method: 'GET', path: '/auth/session', idToken: owner })
    eq(r.data.gym.spreadsheetId, undefined, 'hidden')
    eq(r.data.gym.dataStoreReady, true, 'ready flag')
  })
  test('gym db: two gyms sharing a spreadsheet are refused and reported', () => {
    const aId = env_gymSpreadsheetId(env.sheets, gyms.a)
    const row = env.sheets.get('Gyms')._rows.find((r) => r[0] === gyms.c)
    row[3] = aId
    const res = env.run(
      `(() => { try { withScriptLock_(() => ensureGymDatabaseLocked_('${gyms.c}')); return 'ok'; } catch (e) { return e.message; } })()`,
    )
    const problems = env.run('validateGymDatabases_()')
    row[3] = ''
    if (!/share one spreadsheet/.test(res)) throw new Error(res)
    if (!problems.some((p) => /share one spreadsheet/.test(p))) throw new Error(JSON.stringify(problems))
  })
  test('gym db: validation reports gyms without a spreadsheet', () => {
    const problems = env.run('validateGymDatabases_()')
    if (!problems.some((p) => p.includes(gyms.c) && p.includes('no Spreadsheet_ID'))) throw new Error(JSON.stringify(problems))
  })
  test('gym db: validation detects wrong headers in a gym spreadsheet', () => {
    const tab = env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gyms.a)).getSheetByName('Members')
    tab._rows[0][2] = 'Name'
    const problems = env.run('validateGymDatabases_()')
    tab._rows[0][2] = 'Full_Name'
    if (!problems.some((p) => p.includes('"Name"'))) throw new Error(JSON.stringify(problems))
  })
  test('gym db: initializeGymDatabases() admin function runs cleanly', () => {
    const results = env.run('initializeGymDatabases()')
    eq(results.length, 3, 'gyms processed')
    eq(results.filter((r) => r.created).length, 1, 'only gym C needed a new spreadsheet')
  })
  test('gym db: provisioning a new gym also creates its spreadsheet', () => {
    env.properties.BOOTSTRAP_PROVISION = JSON.stringify({
      gym: { name: 'Gym D' },
      owner: { firebaseUid: 'uid-owner-d', email: 'd@d.com', fullName: 'Owner D' },
    })
    const before = env.spreadsheets.size
    env.run('provisionFromBootstrapProperty()')
    eq(env.spreadsheets.size, before + 1, 'spreadsheet created')
    eq(env.properties.BOOTSTRAP_PROVISION, undefined, 'property removed')
  })
}

/* ------------------------------------------------------------------ */
/* 5. Phase 5 — Members                                                */
/* ------------------------------------------------------------------ */

{
  const env = createEnv()
  const gyms = seed(env)
  env.setGoogle(googleAccepting())
  env.run(`withScriptLock_(() => { ensureGymDatabaseLocked_('${gyms.a}'); ensureGymDatabaseLocked_('${gyms.b}'); })`)
  env.run(`(() => {
    createUser_({ Firebase_UID: 'uid-trainer-a', Gym_ID: '${gyms.a}', Email: 't@a.com', Full_Name: 'Trainer A', Role: 'TRAINER' });
    createUser_({ Firebase_UID: 'uid-staff-a', Gym_ID: '${gyms.a}', Email: 's@a.com', Full_Name: 'Staff A', Role: 'STAFF' });
    createUser_({ Firebase_UID: 'uid-owner-b', Gym_ID: '${gyms.b}', Email: 'owner@b.com', Full_Name: 'Owner B', Role: 'GYM_OWNER' });
  })()`)
  const tok = (sub) => makeToken({ sub })
  const owner = tok('uid-owner-a')
  const ownerB = tok('uid-owner-b')
  const staff = tok('uid-staff-a')
  const trainer = tok('uid-trainer-a')
  const member = tok('uid-member-a')
  const admin = tok('uid-admin')
  const base = `/gyms/${gyms.a}/members`
  const create = (body, token = owner, gymId = gyms.a) =>
    call(env, { method: 'POST', path: `/gyms/${gymId}/members`, idToken: token, body })
  const list = (body = {}, token = owner, gymId = gyms.a) =>
    call(env, { method: 'GET', path: `/gyms/${gymId}/members`, idToken: token, body })
  const patch = (id, body, token = owner) => call(env, { method: 'PATCH', path: `${base}/${id}`, idToken: token, body })
  const audit = (action) => env.sheets.get('Platform_Audit_Log')._rows.filter((r) => r[2] === action)
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  let ravi
  const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10)

  test('members: owner creates a member (201) with server-set fields', () => {
    const r = create({ fullName: 'Ravi Kumar', phone: '+91 98765 43210', email: 'Ravi@Example.com', gender: 'MALE', dateOfBirth: '1995-04-12' })
    eq(r.status, 201, 'status')
    ravi = r.data.member
    if (!/^MEM-[0-9a-f]{32}$/.test(ravi.memberId)) throw new Error('id ' + ravi.memberId)
    eq(ravi.phone, '+919876543210', 'phone normalised')
    eq(ravi.email, 'ravi@example.com', 'email lower-cased')
    eq(ravi.status, 'ACTIVE', 'status')
    eq(ravi.joinDate, today, 'join date defaults to today (gym time zone)')
    eq('gymId' in ravi, false, 'Gym_ID not exposed')
  })
  test('members: stored only in gym A spreadsheet, with Gym_ID and creator', () => {
    const rows = env.gymRows(gyms.a)
    eq(rows.length, 1, 'gym A rows')
    eq(rows[0][1], gyms.a, 'Gym_ID column')
    eq(env.gymRows(gyms.b).length, 0, 'gym B untouched')
    eq(env.sheets.has('Members'), false, 'not in central DB')
    const creator = env.sheets.get('Users')._rows.find((u) => u[1] === 'uid-owner-a')[0]
    eq(rows[0][13], creator, 'Created_By = acting user')
  })
  test('members: creation audited', () => {
    eq(audit('MEMBER_CREATED').length, 1, 'audit rows')
    eq(audit('MEMBER_CREATED')[0][4], ravi.memberId, 'entity id')
  })
  test('members: staff can create, phone with separators accepted', () => {
    eq(create({ fullName: 'Priya Shah', phone: '98200-11122', joinDate: '2026-01-15' }, staff).status, 201, 'status')
  })
  test('members: duplicate phone → 409 MEMBER_PHONE_EXISTS', () => {
    const r = create({ fullName: 'Someone Else', phone: '+919876543210' })
    eq(r.status, 409, 'status')
    eq(r.error.code, 'MEMBER_PHONE_EXISTS', 'code')
    eq(env.gymRows(gyms.a).length, 2, 'nothing written')
  })
  test('members: same number without country code → 409 (as found in UI testing)', () => {
    eq(create({ fullName: 'Someone Else', phone: '9876543210' }).error.code, 'MEMBER_PHONE_EXISTS', 'national form')
    eq(create({ fullName: 'Someone Else', phone: '098765 43210' }).error.code, 'MEMBER_PHONE_EXISTS', 'trunk zero')
  })
  test('members: same phone allowed in another gym', () => {
    eq(create({ fullName: 'Ravi B', phone: '+919876543210' }, ownerB, gyms.b).status, 201, 'status')
  })
  test('members: missing required fields → 400 with field errors', () => {
    const r = create({ email: 'x@y.com' })
    eq(r.status, 400, 'status')
    eq(Boolean(r.error.details.fields.fullName && r.error.details.fields.phone), true, 'field errors')
  })
  test('members: invalid phone, email, gender and date rejected', () => {
    eq(create({ fullName: 'A B', phone: '12' }).status, 400, 'phone')
    eq(create({ fullName: 'A B', phone: '9000000001', email: 'nope' }).status, 400, 'email')
    eq(create({ fullName: 'A B', phone: '9000000001', gender: 'X' }).status, 400, 'gender')
    eq(create({ fullName: 'A B', phone: '9000000001', dateOfBirth: '2001-02-30' }).status, 400, 'date')
  })
  test('members: future date of birth rejected', () => {
    const r = create({ fullName: 'A B', phone: '9000000002', dateOfBirth: shift(today, 30), joinDate: shift(today, 60) })
    eq(r.status, 400, 'status')
    eq(r.error.details.fields.dateOfBirth, 'Cannot be in the future.', 'field')
  })
  test('members: client cannot set Gym_ID, status, id or creator on create', () => {
    const extras = [{ gymId: gyms.b }, { Gym_ID: gyms.b }, { status: 'INACTIVE' }, { memberId: 'MEM-' + 'a'.repeat(32) }, { createdBy: 'x' }]
    for (const extra of extras) {
      eq(create({ fullName: 'A B', phone: '9000000003', ...extra }).status, 400, JSON.stringify(extra))
    }
    eq(env.gymRows(gyms.b).length, 1, 'nothing written to gym B')
  })
  test('members: formula injection stored as text and returned verbatim', () => {
    const r = create({ fullName: '=HYPERLINK("http://evil","x")', phone: '9000000004', notes: '+cmd|calc' })
    eq(r.status, 201, 'status')
    eq(r.data.member.fullName, '=HYPERLINK("http://evil","x")', 'round trip')
  })
  test('members: get one (200), unknown (404), malformed id (400)', () => {
    eq(call(env, { method: 'GET', path: `${base}/${ravi.memberId}`, idToken: trainer }).data.member.fullName, 'Ravi Kumar', 'get')
    eq(call(env, { method: 'GET', path: `${base}/MEM-${'0'.repeat(32)}`, idToken: owner }).status, 404, 'unknown')
    eq(call(env, { method: 'GET', path: `${base}/MEM-1`, idToken: owner }).status, 400, 'malformed')
    eq(call(env, { method: 'GET', path: `${base}/USR-${'0'.repeat(32)}`, idToken: owner }).status, 400, 'wrong prefix')
  })
  test('members: list newest first with counts', () => {
    const r = list()
    eq(r.status, 200, 'status')
    eq(r.data.total, 3, 'total')
    eq(r.data.counts.active, 3, 'active count')
    eq(r.data.members[2].fullName, 'Ravi Kumar', 'oldest last')
  })
  test('members: search by name, phone digits, email and ID', () => {
    eq(list({ search: 'ravi' }).data.total, 1, 'name')
    eq(list({ search: '98200 111' }).data.members[0].fullName, 'Priya Shah', 'phone digits')
    eq(list({ search: 'ravi@example' }).data.total, 1, 'email')
    eq(list({ search: ravi.memberId }).data.total, 1, 'id')
    eq(list({ search: 'nobody-here' }).data.total, 0, 'none')
  })
  test('members: pagination', () => {
    const p1 = list({ pageSize: 2, page: 1 }).data
    const p2 = list({ pageSize: 2, page: 2 }).data
    eq(p1.members.length, 2, 'page 1')
    eq(p2.members.length, 1, 'page 2')
    eq(p1.total, 3, 'total')
    eq(list({ pageSize: 500 }).status, 400, 'pageSize capped')
    eq(list({ page: 0 }).status, 400, 'page >= 1')
  })
  test('members: update fields (PATCH) and clear an optional one', () => {
    const r = patch(ravi.memberId, { address: '12 MG Road', email: '' })
    eq(r.status, 200, 'status')
    eq(r.data.member.address, '12 MG Road', 'address')
    eq(r.data.member.email, null, 'email cleared')
    eq(r.data.member.fullName, 'Ravi Kumar', 'other fields kept')
    eq(audit('MEMBER_UPDATED').length, 1, 'audited')
  })
  test('members: PATCH cannot blank required fields or touch immutable ones', () => {
    eq(patch(ravi.memberId, { fullName: '' }).status, 400, 'blank name')
    eq(patch(ravi.memberId, { phone: null }).status, 400, 'null phone')
    eq(patch(ravi.memberId, { gymId: gyms.b }).status, 400, 'gymId')
    eq(patch(ravi.memberId, { createdBy: 'x' }).status, 400, 'createdBy')
    eq(patch(ravi.memberId, {}).status, 400, 'empty patch')
  })
  test("members: PATCH phone to another member's number → 409; own number OK", () => {
    eq(patch(ravi.memberId, { phone: '9820011122' }).status, 409, 'clash')
    eq(patch(ravi.memberId, { phone: '+91 98765 43210' }).status, 200, 'own number')
  })
  test('members: deactivate and reactivate (audited, never deleted)', () => {
    eq(patch(ravi.memberId, { status: 'INACTIVE' }).data.member.status, 'INACTIVE', 'deactivated')
    eq(list({ status: 'ACTIVE' }).data.total, 2, 'active filter')
    eq(list({ status: 'INACTIVE' }).data.total, 1, 'inactive filter')
    eq(patch(ravi.memberId, { status: 'ACTIVE' }).data.member.status, 'ACTIVE', 'reactivated')
    eq(audit('MEMBER_DEACTIVATED').length, 1, 'deactivation audited')
    eq(audit('MEMBER_REACTIVATED').length, 1, 'reactivation audited')
    eq(env.gymRows(gyms.a).length, 3, 'row kept')
  })
  test('members: there is no DELETE endpoint', () => {
    eq(call(env, { method: 'DELETE', path: `${base}/${ravi.memberId}`, idToken: owner }).status, 405, 'status')
  })
  test('members: TRAINER can read but not write → 403', () => {
    eq(list({}, trainer).status, 200, 'read')
    eq(create({ fullName: 'T T', phone: '9000000005' }, trainer).status, 403, 'create')
    eq(patch(ravi.memberId, { notes: 'x' }, trainer).status, 403, 'update')
  })
  test('members: MEMBER role cannot list members → 403', () => {
    eq(list({}, member).status, 403, 'status')
  })
  test('tenant: gym A owner cannot list/create/read/update gym B members → 404', () => {
    const bMember = list({}, ownerB, gyms.b).data.members[0]
    eq(list({}, owner, gyms.b).status, 404, 'list')
    eq(create({ fullName: 'X Y', phone: '9000000006' }, owner, gyms.b).status, 404, 'create')
    eq(call(env, { method: 'GET', path: `/gyms/${gyms.b}/members/${bMember.memberId}`, idToken: owner }).status, 404, 'read via B path')
    eq(call(env, { method: 'GET', path: `${base}/${bMember.memberId}`, idToken: owner }).status, 404, 'read B id via A path')
    eq(patch(bMember.memberId, { notes: 'hijack' }).status, 404, 'update B id via A path')
    eq(call(env, { method: 'PATCH', path: `/gyms/${gyms.b}/members/${bMember.memberId}`, idToken: owner, body: { notes: 'hijack' } }).status, 404, 'update via B path')
    eq(env.gymRows(gyms.b)[0][12], '', 'gym B notes untouched')
  })
  test("tenant: a foreign row inside gym A's spreadsheet is invisible (Gym_ID filter)", () => {
    const rows = env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gyms.a)).getSheetByName('Members')._rows
    const foreign = [...rows[1]]
    foreign[0] = 'MEM-' + 'f'.repeat(32)
    foreign[1] = gyms.b
    foreign[3] = '+910000000000'
    rows.push(foreign)
    eq(list({ search: '+910000000000' }).data.total, 0, 'not listed')
    eq(call(env, { method: 'GET', path: `${base}/${foreign[0]}`, idToken: owner }).status, 404, 'not readable')
    eq(patch(foreign[0], { notes: 'x' }).status, 404, 'not writable')
    rows.pop()
  })
  test("members: platform admin can read any gym's members", () => {
    eq(list({}, admin, gyms.b).status, 200, 'status')
  })
}

/* ------------------------------------------------------------------ */
/* 6. Phase 6 — Plans and memberships                                  */
/* ------------------------------------------------------------------ */

{
  const env = createEnv()
  const gyms = seed(env)
  env.setGoogle(googleAccepting())
  env.run(`withScriptLock_(() => { ensureGymDatabaseLocked_('${gyms.a}'); ensureGymDatabaseLocked_('${gyms.b}'); })`)
  env.run(`(() => {
    createUser_({ Firebase_UID: 'uid-trainer-a', Gym_ID: '${gyms.a}', Email: 't@a.com', Full_Name: 'Trainer A', Role: 'TRAINER' });
    createUser_({ Firebase_UID: 'uid-staff-a', Gym_ID: '${gyms.a}', Email: 's@a.com', Full_Name: 'Staff A', Role: 'STAFF' });
    createUser_({ Firebase_UID: 'uid-owner-b', Gym_ID: '${gyms.b}', Email: 'owner@b.com', Full_Name: 'Owner B', Role: 'GYM_OWNER' });
  })()`)
  const tok = (sub) => makeToken({ sub })
  const owner = tok('uid-owner-a')
  const ownerB = tok('uid-owner-b')
  const staff = tok('uid-staff-a')
  const trainer = tok('uid-trainer-a')
  const req = (method, path, body, token = owner) => call(env, { method, path, idToken: token, body })
  const A = `/gyms/${gyms.a}`
  const B = `/gyms/${gyms.b}`
  const audit = (action) => env.sheets.get('Platform_Audit_Log')._rows.filter((r) => r[2] === action)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10)
  const gymTab = (gymId, tab) => env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gymId)).getSheetByName(tab)._rows.slice(1)

  let monthly, quarterly, ravi, priya, inactiveMember, bPlan, bMember

  test('plans: owner creates plans (201); price/duration stored as text', () => {
    const r = req('POST', `${A}/plans`, { name: 'Monthly', durationDays: 30, price: 1500, description: 'Gym floor access' })
    eq(r.status, 201, 'status')
    monthly = r.data.plan
    eq(monthly.price, 1500, 'price number in API')
    eq(monthly.durationDays, 30, 'days number in API')
    eq(gymTab(gyms.a, 'Membership_Plans')[0][4], '1500.00', 'price text in sheet')
    quarterly = req('POST', `${A}/plans`, { name: 'Quarterly', durationDays: 90, price: 3999.5 }).data.plan
    eq(audit('PLAN_CREATED').length, 2, 'audited')
  })
  test('plans: validation (name, days, price decimals, unknown fields)', () => {
    eq(req('POST', `${A}/plans`, { name: 'X', durationDays: 30, price: 10 }).status, 400, 'short name')
    eq(req('POST', `${A}/plans`, { name: 'Daily', durationDays: 0, price: 10 }).status, 400, 'days 0')
    eq(req('POST', `${A}/plans`, { name: 'Daily', durationDays: 1.5, price: 10 }).status, 400, 'fractional days')
    eq(req('POST', `${A}/plans`, { name: 'Daily', durationDays: 1, price: 10.001 }).status, 400, '3 decimals')
    eq(req('POST', `${A}/plans`, { name: 'Daily', durationDays: 1, price: -1 }).status, 400, 'negative')
    eq(req('POST', `${A}/plans`, { name: 'Daily', durationDays: 1, price: '100' }).status, 400, 'price as string')
    eq(req('POST', `${A}/plans`, { name: 'Daily', durationDays: 1, price: 100, status: 'INACTIVE' }).status, 400, 'status on create')
    eq(req('POST', `${A}/plans`, { name: 'Daily', durationDays: 1, price: 100, gymId: gyms.b }).status, 400, 'gymId')
  })
  test('plans: duplicate name (case-insensitive) → 409', () => {
    const r = req('POST', `${A}/plans`, { name: ' monthly ', durationDays: 31, price: 1 })
    eq(r.status, 409, 'status')
    eq(r.error.code, 'PLAN_NAME_EXISTS', 'code')
  })
  test('plans: same name allowed in another gym', () => {
    const r = req('POST', `${B}/plans`, { name: 'Monthly', durationDays: 30, price: 900 }, ownerB)
    eq(r.status, 201, 'status')
    bPlan = r.data.plan
  })
  test('plans: STAFF and TRAINER can list but not create or edit', () => {
    eq(req('GET', `${A}/plans`, {}, staff).data.plans.length, 2, 'staff list')
    eq(req('GET', `${A}/plans`, {}, trainer).status, 200, 'trainer list')
    eq(req('POST', `${A}/plans`, { name: 'Staff Plan', durationDays: 1, price: 1 }, staff).status, 403, 'staff create')
    eq(req('PATCH', `${A}/plans/${monthly.planId}`, { price: 1 }, staff).status, 403, 'staff edit')
  })
  test('plans: cross-gym list/edit → 404', () => {
    eq(req('GET', `${B}/plans`).status, 404, 'list B')
    eq(req('PATCH', `${A}/plans/${bPlan.planId}`, { price: 1 }).status, 404, 'edit B plan via A')
    eq(req('PATCH', `${B}/plans/${bPlan.planId}`, { price: 1 }).status, 404, 'edit B plan via B')
  })

  test('memberships: setup members', () => {
    ravi = req('POST', `${A}/members`, { fullName: 'Ravi Kumar', phone: '9876543210' }).data.member
    priya = req('POST', `${A}/members`, { fullName: 'Priya Shah', phone: '9820011122' }).data.member
    inactiveMember = req('POST', `${A}/members`, { fullName: 'Old Timer', phone: '9000000099' }).data.member
    req('PATCH', `${A}/members/${inactiveMember.memberId}`, { status: 'INACTIVE' })
    bMember = req('POST', `${B}/members`, { fullName: 'B Person', phone: '9111111111' }, ownerB).data.member
    eq(Boolean(ravi && priya && bMember), true, 'created')
  })
  let raviFirst
  test('memberships: staff sells a plan; starts today, end = start + days − 1, price snapshot', () => {
    const r = req('POST', `${A}/members/${ravi.memberId}/memberships`, { planId: monthly.planId }, staff)
    eq(r.status, 201, 'status')
    raviFirst = r.data.membership
    eq(raviFirst.startDate, today, 'start')
    eq(raviFirst.endDate, shift(today, 29), 'end')
    eq(raviFirst.price, 1500, 'price from plan')
    eq(raviFirst.planName, 'Monthly', 'plan name snapshot')
    eq(raviFirst.state, 'ACTIVE', 'state')
    eq(raviFirst.daysLeft, 30, 'days left inclusive')
    eq(audit('MEMBERSHIP_CREATED').length, 1, 'audited')
  })
  test('memberships: overlapping dates → 409 with suggested start', () => {
    const r = req('POST', `${A}/members/${ravi.memberId}/memberships`, { planId: quarterly.planId, startDate: shift(today, 10) })
    eq(r.status, 409, 'status')
    eq(r.error.code, 'MEMBERSHIP_OVERLAP', 'code')
    eq(r.error.details.suggestedStartDate, shift(today, 30), 'suggestion')
  })
  test('memberships: renewal without a start date queues after the current one (UPCOMING)', () => {
    const r = req('POST', `${A}/members/${ravi.memberId}/memberships`, { planId: quarterly.planId, price: 3500, notes: 'Loyalty discount' })
    eq(r.status, 201, 'status')
    eq(r.data.membership.startDate, shift(today, 30), 'starts after current')
    eq(r.data.membership.state, 'UPCOMING', 'upcoming')
    eq(r.data.membership.price, 3500, 'price override')
  })
  test('memberships: member history with current and next', () => {
    const r = req('GET', `${A}/members/${ravi.memberId}/memberships`, undefined, trainer)
    eq(r.status, 200, 'status')
    eq(r.data.memberships.length, 2, 'count')
    eq(r.data.current.membershipId, raviFirst.membershipId, 'current')
    eq(r.data.next.planName, 'Quarterly', 'next')
    eq(r.data.suggestedStartDate, shift(today, 120), 'next suggested start after both')
  })
  test('memberships: backdated membership allowed within a year; too old rejected', () => {
    const r = req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: monthly.planId, startDate: shift(today, -40) })
    eq(r.status, 201, 'status')
    eq(r.data.membership.state, 'EXPIRED', 'expired')
    eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: monthly.planId, startDate: shift(today, -400) }).status, 400, 'too old')
  })
  test('memberships: inactive member, inactive plan, unknown plan, other gym\'s plan rejected', () => {
    eq(req('POST', `${A}/members/${inactiveMember.memberId}/memberships`, { planId: monthly.planId }).error.code, 'MEMBER_INACTIVE', 'inactive member')
    const daily = req('POST', `${A}/plans`, { name: 'Day Pass', durationDays: 1, price: 100 }).data.plan
    eq(req('PATCH', `${A}/plans/${daily.planId}`, { status: 'INACTIVE' }).data.plan.status, 'INACTIVE', 'plan deactivated')
    eq(audit('PLAN_DEACTIVATED').length, 1, 'plan deactivation audited')
    eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: daily.planId }).error.code, 'PLAN_INACTIVE', 'inactive plan')
    eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: 'PLN-' + '0'.repeat(32) }).status, 400, 'unknown plan')
    eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: bPlan.planId }).status, 400, "gym B's plan")
    eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: ravi.memberId }).status, 400, 'wrong ID prefix')
  })
  test('memberships: client cannot set end date, status or plan name', () => {
    for (const extra of [{ endDate: '2099-01-01' }, { status: 'CANCELLED' }, { planName: 'Free' }, { gymId: gyms.b }]) {
      eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: monthly.planId, ...extra }).status, 400, JSON.stringify(extra))
    }
  })
  test('memberships: plan edits do not change sold memberships', () => {
    eq(req('PATCH', `${A}/plans/${monthly.planId}`, { price: 1800, name: 'Monthly Plus' }).status, 200, 'edit plan')
    const r = req('GET', `${A}/members/${ravi.memberId}/memberships`)
    const first = r.data.memberships.find((m) => m.membershipId === raviFirst.membershipId)
    eq(first.price, 1500, 'price snapshot kept')
    eq(first.planName, 'Monthly', 'name snapshot kept')
  })
  test('memberships: gym-wide list by state with counts and member names', () => {
    const all = req('GET', `${A}/memberships`, {}).data
    eq(all.counts.ACTIVE, 1, 'active count')
    eq(all.counts.UPCOMING, 1, 'upcoming count')
    eq(all.counts.EXPIRED, 1, 'lapsed members count')
    eq(all.total, 3, 'default list excludes cancelled')
    const expired = req('GET', `${A}/memberships`, { state: 'EXPIRED' }).data
    eq(expired.memberships[0].member.fullName, 'Priya Shah', 'lapsed member')
    eq(req('GET', `${A}/memberships`, { search: 'ravi' }).data.total, 2, 'search by member name')
    eq(req('GET', `${A}/memberships`, { state: 'BOGUS' }).status, 400, 'invalid state')
  })
  test('memberships: renewing a lapsed member removes them from EXPIRED', () => {
    eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: monthly.planId }).data.membership.startDate, today, 'renewed from today')
    eq(req('GET', `${A}/memberships`, { state: 'EXPIRED' }).data.total, 0, 'no lapsed members')
  })
  test('memberships: cancel (audited), cannot cancel twice, frees the dates', () => {
    const upcoming = req('GET', `${A}/members/${ravi.memberId}/memberships`).data.next
    const r = req('POST', `${A}/memberships/${upcoming.membershipId}/cancel`, { reason: 'Changed mind' }, staff)
    eq(r.status, 200, 'status')
    eq(r.data.membership.state, 'CANCELLED', 'state')
    eq(r.data.membership.cancelReason, 'Changed mind', 'reason')
    eq(req('POST', `${A}/memberships/${upcoming.membershipId}/cancel`, {}).error.code, 'MEMBERSHIP_ALREADY_CANCELLED', 'twice')
    eq(audit('MEMBERSHIP_CANCELLED').length, 1, 'audited')
    eq(req('POST', `${A}/members/${ravi.memberId}/memberships`, { planId: quarterly.planId, startDate: shift(today, 30) }).status, 201, 'dates free again')
    eq(gymTab(gyms.a, 'Memberships').length, 5, 'nothing deleted (5 sold, 1 of them cancelled)')
  })
  test('memberships: TRAINER cannot sell or cancel → 403', () => {
    eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: quarterly.planId }, trainer).status, 403, 'sell')
    eq(req('POST', `${A}/memberships/${raviFirst.membershipId}/cancel`, {}, trainer).status, 403, 'cancel')
  })
  test('tenant: gym A cannot sell to, read or cancel gym B memberships → 404', () => {
    const bMs = req('POST', `${B}/members/${bMember.memberId}/memberships`, { planId: bPlan.planId }, ownerB).data.membership
    eq(req('GET', `${B}/memberships`, {}).status, 404, 'list B')
    eq(req('POST', `${B}/members/${bMember.memberId}/memberships`, { planId: bPlan.planId }).status, 404, 'sell via B path')
    eq(req('POST', `${A}/members/${bMember.memberId}/memberships`, { planId: monthly.planId }).status, 404, 'sell to B member via A')
    eq(req('GET', `${A}/members/${bMember.memberId}/memberships`).status, 404, 'read B member via A')
    eq(req('POST', `${A}/memberships/${bMs.membershipId}/cancel`, {}).status, 404, 'cancel B membership via A')
    eq(gymTab(gyms.b, 'Memberships')[0][8], 'ACTIVE', 'gym B membership untouched')
  })
  test("tenant: foreign plan/membership rows inside gym A's spreadsheet are invisible (Gym_ID filter)", () => {
    const ss = env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gyms.a))
    const plansTab = ss.getSheetByName('Membership_Plans')._rows
    const msTab = ss.getSheetByName('Memberships')._rows
    const memTab = ss.getSheetByName('Members')._rows
    const fPlan = [...plansTab[1]]
    fPlan[0] = 'PLN-' + 'f'.repeat(32)
    fPlan[1] = gyms.b
    fPlan[2] = 'Foreign Plan'
    const fMem = [...memTab[1]]
    fMem[0] = 'MEM-' + 'f'.repeat(32)
    fMem[1] = gyms.b
    fMem[3] = '+910000000001'
    const fMs = [...msTab[1]]
    fMs[0] = 'MSP-' + 'f'.repeat(32)
    fMs[1] = gyms.b
    fMs[2] = fMem[0]
    fMs[4] = 'Foreign Plan'
    plansTab.push(fPlan)
    memTab.push(fMem)
    msTab.push(fMs)
    try {
      eq(req('GET', `${A}/plans`, {}).data.plans.some((p) => p.name === 'Foreign Plan'), false, 'plan not listed')
      eq(req('PATCH', `${A}/plans/${fPlan[0]}`, { price: 1 }).status, 404, 'plan not editable')
      eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: fPlan[0] }).status, 400, 'foreign plan not sellable')
      eq(req('POST', `${A}/members/${fMem[0]}/memberships`, { planId: quarterly.planId }).status, 404, 'foreign member not sellable')
      eq(req('GET', `${A}/memberships`, { search: 'Foreign Plan' }).data.total, 0, 'membership not listed')
      eq(req('POST', `${A}/memberships/${fMs[0]}/cancel`, {}).status, 404, 'membership not cancellable')
      eq(fMs[8], 'ACTIVE', 'foreign row untouched')
    } finally {
      plansTab.pop()
      memTab.pop()
      msTab.pop()
    }
  })
  test('memberships: MEMBER role has no access', () => {
    eq(req('GET', `${A}/memberships`, {}, tok('uid-member-a')).status, 403, 'status')
  })
}

/* ------------------------------------------------------------------ */
/* 7. Phase 7 — Payments                                               */
/* ------------------------------------------------------------------ */

{
  const env = createEnv()
  const gyms = seed(env)
  env.setGoogle(googleAccepting())
  env.run(`withScriptLock_(() => { ensureGymDatabaseLocked_('${gyms.a}'); ensureGymDatabaseLocked_('${gyms.b}'); })`)
  env.run(`(() => {
    createUser_({ Firebase_UID: 'uid-trainer-a', Gym_ID: '${gyms.a}', Email: 't@a.com', Full_Name: 'Trainer A', Role: 'TRAINER' });
    createUser_({ Firebase_UID: 'uid-staff-a', Gym_ID: '${gyms.a}', Email: 's@a.com', Full_Name: 'Staff A', Role: 'STAFF' });
    createUser_({ Firebase_UID: 'uid-owner-b', Gym_ID: '${gyms.b}', Email: 'owner@b.com', Full_Name: 'Owner B', Role: 'GYM_OWNER' });
  })()`)
  const tok = (sub) => makeToken({ sub })
  const owner = tok('uid-owner-a')
  const ownerB = tok('uid-owner-b')
  const staff = tok('uid-staff-a')
  const trainer = tok('uid-trainer-a')
  const req = (method, path, body, token = owner) => call(env, { method, path, idToken: token, body })
  const A = `/gyms/${gyms.a}`
  const B = `/gyms/${gyms.b}`
  const audit = (action) => env.sheets.get('Platform_Audit_Log')._rows.filter((r) => r[2] === action)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10)
  const gymTab = (gymId, tab) => env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gymId)).getSheetByName(tab)._rows.slice(1)

  const plan = req('POST', `${A}/plans`, { name: 'Monthly', durationDays: 30, price: 1500 }).data.plan
  const ravi = req('POST', `${A}/members`, { fullName: 'Ravi Kumar', phone: '9876543210' }).data.member
  const priya = req('POST', `${A}/members`, { fullName: 'Priya Shah', phone: '9820011122' }).data.member
  const bPlan = req('POST', `${B}/plans`, { name: 'Monthly', durationDays: 30, price: 900 }, ownerB).data.plan
  const bMember = req('POST', `${B}/members`, { fullName: 'B Person', phone: '9111111111' }, ownerB).data.member
  let raviMs, pay1, pay2

  test('payments: membership shows full balance due before any payment', () => {
    raviMs = req('POST', `${A}/members/${ravi.memberId}/memberships`, { planId: plan.planId }).data
    const ms = req('GET', `${A}/members/${ravi.memberId}/memberships`).data.memberships[0]
    eq(ms.amountPaid, 0, 'paid')
    eq(ms.balanceDue, 1500, 'due')
  })
  test('payments: staff records a part payment (201) with receipt R-000001', () => {
    const r = req('POST', `${A}/memberships/${raviMs.membership.membershipId}/payments`, { amount: 1000, method: 'UPI', reference: 'UPI-123' }, staff)
    eq(r.status, 201, 'status')
    pay1 = r.data.payment
    eq(pay1.receiptNo, 'R-000001', 'receipt')
    eq(pay1.amount, 1000, 'amount')
    eq(pay1.paymentDate, today, 'date defaults to today')
    eq(pay1.member.fullName, 'Ravi Kumar', 'member')
    eq(r.data.membership.balanceDue, 500, 'balance after')
    eq(gymTab(gyms.a, 'Payments')[0][5], '1000.00', 'stored as text')
    eq(audit('PAYMENT_RECORDED').length, 1, 'audited')
  })
  test('payments: amount above the balance → 409 with balanceDue', () => {
    const r = req('POST', `${A}/memberships/${raviMs.membership.membershipId}/payments`, { amount: 500.01, method: 'CASH' })
    eq(r.status, 409, 'status')
    eq(r.error.code, 'PAYMENT_EXCEEDS_BALANCE', 'code')
    eq(r.error.details.balanceDue, 500, 'balance')
  })
  test('payments: paying the exact balance (paise-precise) settles it; next receipt R-000002', () => {
    const r = req('POST', `${A}/memberships/${raviMs.membership.membershipId}/payments`, { amount: 500, method: 'CASH', paymentDate: shift(today, -1) })
    eq(r.status, 201, 'status')
    pay2 = r.data.payment
    eq(pay2.receiptNo, 'R-000002', 'receipt')
    eq(r.data.membership.balanceDue, 0, 'settled')
    eq(req('POST', `${A}/memberships/${raviMs.membership.membershipId}/payments`, { amount: 1, method: 'CASH' }).error.code, 'PAYMENT_EXCEEDS_BALANCE', 'nothing due')
  })
  test('payments: validation (zero, method, future/old date, unknown fields)', () => {
    const p = `${A}/memberships/${raviMs.membership.membershipId}/payments`
    eq(req('POST', p, { amount: 0, method: 'CASH' }).status, 400, 'zero')
    eq(req('POST', p, { amount: 1, method: 'CHEQUE' }).status, 400, 'method')
    eq(req('POST', p, { amount: 1 }).status, 400, 'method required')
    eq(req('POST', p, { amount: 1.005, method: 'CASH' }).status, 400, '3 decimals')
    eq(req('POST', p, { amount: '1', method: 'CASH' }).status, 400, 'string amount')
    eq(req('POST', p, { amount: 1, method: 'CASH', receiptNo: 'R-1' }).status, 400, 'receiptNo')
    const ms2 = req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: plan.planId }).data.membership
    const p2 = `${A}/memberships/${ms2.membershipId}/payments`
    eq(req('POST', p2, { amount: 1, method: 'CASH', paymentDate: shift(today, 1) }).error.details.fields.paymentDate !== undefined, true, 'future date')
    eq(req('POST', p2, { amount: 1, method: 'CASH', paymentDate: shift(today, -400) }).status, 400, 'too old')
  })
  test('payments: sale with first payment in one step (atomic)', () => {
    const r = req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: plan.planId, startDate: shift(today, 30), paymentAmount: 1500, paymentMethod: 'CARD' })
    eq(r.status, 201, 'status')
    eq(r.data.membership.balanceDue, 0, 'paid in full')
    eq(r.data.membership.payment.receiptNo, 'R-000003', 'receipt')
    eq(r.data.membership.payment.paymentDate, today, 'paid today though it starts later')
  })
  test('payments: sale with a payment above the price is refused and saves NOTHING', () => {
    const before = gymTab(gyms.a, 'Memberships').length
    const r = req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: plan.planId, startDate: shift(today, 60), paymentAmount: 2000, paymentMethod: 'CASH' })
    eq(r.error.code, 'PAYMENT_EXCEEDS_BALANCE', 'code')
    eq(gymTab(gyms.a, 'Memberships').length, before, 'no membership written')
    eq(req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: plan.planId, startDate: shift(today, 60), paymentAmount: 10 }).error.details.fields.paymentMethod !== undefined, true, 'method required with amount')
  })
  test('payments: list by date range with totals by method', () => {
    const r = req('GET', `${A}/payments`, { from: shift(today, -7), to: today })
    eq(r.status, 200, 'status')
    eq(r.data.totals.count, 3, 'count')
    eq(r.data.totals.amount, 3000, 'amount')
    eq(r.data.totals.byMethod.UPI, 1000, 'UPI')
    eq(r.data.totals.byMethod.CARD, 1500, 'CARD')
    eq(r.data.payments[0].paymentDate, today, 'newest first')
    eq(req('GET', `${A}/payments`, { from: today, to: today }).data.totals.amount, 2500, 'today only')
    eq(req('GET', `${A}/payments`, { from: today, to: shift(today, -1) }).status, 400, 'from after to')
    eq(req('GET', `${A}/payments`, { from: shift(today, -7), search: 'R-000002' }).data.total, 1, 'search receipt')
    eq(req('GET', `${A}/payments`, { from: shift(today, -7), search: 'priya' }).data.total, 1, 'search member')
    eq(req('GET', `${A}/payments`, { from: shift(today, -7), method: 'CASH' }).data.totals.amount, 500, 'method filter')
  })
  test('payments: dues list shows who owes money', () => {
    const r = req('GET', `${A}/dues`, {})
    eq(r.status, 200, 'status')
    eq(r.data.total, 1, 'one membership with a balance')
    eq(r.data.dues[0].member.fullName, 'Priya Shah', 'member')
    eq(r.data.dues[0].balanceDue, 1500, 'balance')
    eq(r.data.totalDue, 1500, 'total')
  })
  test('payments: receipt view', () => {
    const r = req('GET', `${A}/payments/${pay1.paymentId}`)
    eq(r.status, 200, 'status')
    eq(r.data.payment.gymName, 'Gym A', 'gym name')
    eq(r.data.payment.membership.planName, 'Monthly', 'plan')
    eq(r.data.payment.membership.balanceDue, 0, 'balance now')
    eq(req('GET', `${A}/payments/PAY-${'0'.repeat(32)}`).status, 404, 'unknown')
    eq(req('GET', `${A}/payments/PAY-1`).status, 400, 'malformed')
  })
  test('payments: member payment history', () => {
    const r = req('GET', `${A}/members/${ravi.memberId}/payments`)
    eq(r.data.payments.length, 2, 'count')
    eq(r.data.payments[0].receiptNo, 'R-000002', 'newest receipt first')
  })
  test('payments: STAFF cannot void; owner voids with reason (audited); balance comes back', () => {
    eq(req('POST', `${A}/payments/${pay2.paymentId}/void`, { reason: 'Wrong amount' }, staff).status, 403, 'staff')
    eq(req('POST', `${A}/payments/${pay2.paymentId}/void`, {}).status, 400, 'reason required')
    const r = req('POST', `${A}/payments/${pay2.paymentId}/void`, { reason: 'Wrong amount' })
    eq(r.status, 200, 'status')
    eq(r.data.payment.status, 'VOIDED', 'voided')
    eq(r.data.payment.voidReason, 'Wrong amount', 'reason')
    eq(req('POST', `${A}/payments/${pay2.paymentId}/void`, { reason: 'again' }).error.code, 'PAYMENT_ALREADY_VOIDED', 'twice')
    eq(audit('PAYMENT_VOIDED').length, 1, 'audited')
    eq(req('GET', `${A}/members/${ravi.memberId}/memberships`).data.memberships[0].balanceDue, 500, 'balance restored')
    eq(req('GET', `${A}/payments`, { from: shift(today, -7) }).data.totals.amount, 2500, 'excluded from totals')
    eq(req('GET', `${A}/payments`, { from: shift(today, -7), includeVoided: true }).data.total, 3, 'listed on request')
    eq(gymTab(gyms.a, 'Payments').length, 3, 'nothing deleted')
  })
  test('payments: next receipt continues after voided one (no reuse)', () => {
    const r = req('POST', `${A}/memberships/${raviMs.membership.membershipId}/payments`, { amount: 500, method: 'CASH' })
    eq(r.data.payment.receiptNo, 'R-000004', 'receipt')
  })
  test('payments: cancelled membership accepts no payments; its balance is 0', () => {
    const ms = req('GET', `${A}/members/${priya.memberId}/memberships`).data.memberships.find((m) => m.balanceDue > 0)
    eq(req('POST', `${A}/memberships/${ms.membershipId}/cancel`, {}).status, 200, 'cancel')
    eq(req('POST', `${A}/memberships/${ms.membershipId}/payments`, { amount: 1, method: 'CASH' }).error.code, 'MEMBERSHIP_CANCELLED', 'refused')
    eq(req('GET', `${A}/dues`, {}).data.total, 0, 'no dues left')
  })
  test('payments: TRAINER and MEMBER have no access', () => {
    eq(req('GET', `${A}/payments`, {}, trainer).status, 403, 'trainer list')
    eq(req('GET', `${A}/dues`, {}, trainer).status, 403, 'trainer dues')
    eq(req('POST', `${A}/memberships/${raviMs.membership.membershipId}/payments`, { amount: 1, method: 'CASH' }, trainer).status, 403, 'trainer pay')
    eq(req('GET', `${A}/payments`, {}, tok('uid-member-a')).status, 403, 'member')
  })
  test('tenant: gym A cannot read, pay or void gym B payments → 404', () => {
    const bMs = req('POST', `${B}/members/${bMember.memberId}/memberships`, { planId: bPlan.planId, paymentAmount: 900, paymentMethod: 'CASH' }, ownerB).data.membership
    const bPay = bMs.payment
    eq(bPay.receiptNo, 'R-000001', 'gym B has its own receipt sequence')
    eq(req('GET', `${B}/payments`, {}).status, 404, 'list B')
    eq(req('GET', `${B}/dues`, {}).status, 404, 'dues B')
    eq(req('GET', `${A}/payments/${bPay.paymentId}`).status, 404, 'read B payment via A')
    eq(req('POST', `${A}/memberships/${bMs.membershipId}/payments`, { amount: 1, method: 'CASH' }).status, 404, 'pay B membership via A')
    eq(req('POST', `${A}/payments/${bPay.paymentId}/void`, { reason: 'hijack' }).status, 404, 'void B via A')
    eq(gymTab(gyms.b, 'Payments')[0][10], 'RECORDED', 'gym B payment untouched')
  })
  test("tenant: foreign payment rows inside gym A's spreadsheet are invisible (Gym_ID filter)", () => {
    const tab = env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gyms.a)).getSheetByName('Payments')._rows
    const foreign = [...tab[1]]
    foreign[0] = 'PAY-' + 'f'.repeat(32)
    foreign[1] = gyms.b
    foreign[4] = 'R-777777'
    tab.push(foreign)
    try {
      eq(req('GET', `${A}/payments`, { from: shift(today, -7), search: 'R-777777' }).data.total, 0, 'not listed')
      eq(req('GET', `${A}/payments/${foreign[0]}`).status, 404, 'not readable')
      eq(req('POST', `${A}/payments/${foreign[0]}/void`, { reason: 'x x x' }).status, 404, 'not voidable')
      const msTab = env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gyms.a)).getSheetByName('Memberships')._rows
      const fMs = [...msTab[1]]
      fMs[0] = 'MSP-' + 'e'.repeat(32)
      fMs[1] = gyms.b
      msTab.push(fMs)
      try {
        eq(req('POST', `${A}/memberships/${fMs[0]}/payments`, { amount: 1, method: 'CASH' }).status, 404, 'foreign membership not payable')
      } finally {
        msTab.pop()
      }
      const next = req('POST', `${A}/memberships/${raviMs.membership.membershipId}/payments`, { amount: 1, method: 'CASH' })
      eq(next.error.code, 'PAYMENT_EXCEEDS_BALANCE', 'foreign rows do not count towards balance (still settled)')
    } finally {
      tab.pop()
    }
  })
}

/* ------------------------------------------------------------------ */
/* 8. Phase 8 — Attendance                                             */
/* ------------------------------------------------------------------ */

{
  const env = createEnv()
  const gyms = seed(env)
  env.setGoogle(googleAccepting())
  env.run(`withScriptLock_(() => { ensureGymDatabaseLocked_('${gyms.a}'); ensureGymDatabaseLocked_('${gyms.b}'); })`)
  env.run(`(() => {
    createUser_({ Firebase_UID: 'uid-trainer-a', Gym_ID: '${gyms.a}', Email: 't@a.com', Full_Name: 'Trainer A', Role: 'TRAINER' });
    createUser_({ Firebase_UID: 'uid-staff-a', Gym_ID: '${gyms.a}', Email: 's@a.com', Full_Name: 'Staff A', Role: 'STAFF' });
    createUser_({ Firebase_UID: 'uid-owner-b', Gym_ID: '${gyms.b}', Email: 'owner@b.com', Full_Name: 'Owner B', Role: 'GYM_OWNER' });
  })()`)
  const tok = (sub) => makeToken({ sub })
  const owner = tok('uid-owner-a')
  const ownerB = tok('uid-owner-b')
  const staff = tok('uid-staff-a')
  const trainer = tok('uid-trainer-a')
  const req = (method, path, body, token = owner) => call(env, { method, path, idToken: token, body })
  const A = `/gyms/${gyms.a}`
  const B = `/gyms/${gyms.b}`
  const audit = (action) => env.sheets.get('Platform_Audit_Log')._rows.filter((r) => r[2] === action)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10)
  const gymTab = (gymId, tab) => env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gymId)).getSheetByName(tab)._rows.slice(1)

  const plan = req('POST', `${A}/plans`, { name: 'Monthly', durationDays: 30, price: 1500 }).data.plan
  const ravi = req('POST', `${A}/members`, { fullName: 'Ravi Kumar', phone: '9876543210' }).data.member
  const priya = req('POST', `${A}/members`, { fullName: 'Priya Shah', phone: '9820011122' }).data.member
  const lapsed = req('POST', `${A}/members`, { fullName: 'Lapsed Lee', phone: '9000000077' }).data.member
  const gone = req('POST', `${A}/members`, { fullName: 'Gone Gary', phone: '9000000088' }).data.member
  req('POST', `${A}/members/${ravi.memberId}/memberships`, { planId: plan.planId, paymentAmount: 1500, paymentMethod: 'CASH' })
  req('POST', `${A}/members/${priya.memberId}/memberships`, { planId: plan.planId, startDate: shift(today, -25), paymentAmount: 500, paymentMethod: 'UPI' })
  req('POST', `${A}/members/${lapsed.memberId}/memberships`, { planId: plan.planId, startDate: shift(today, -60) })
  req('PATCH', `${A}/members/${gone.memberId}`, { status: 'INACTIVE' })
  const bPlan = req('POST', `${B}/plans`, { name: 'Monthly', durationDays: 30, price: 900 }, ownerB).data.plan
  const bMember = req('POST', `${B}/members`, { fullName: 'B Person', phone: '9111111111' }, ownerB).data.member
  req('POST', `${B}/members/${bMember.memberId}/memberships`, { planId: bPlan.planId }, ownerB)
  let raviVisit, priyaVisit

  test('attendance: lookup shows membership, balance and today status', () => {
    const r = req('GET', `${A}/attendance/lookup`, { query: 'priya' }, staff)
    eq(r.status, 200, 'status')
    const p = r.data.results[0]
    eq(p.member.fullName, 'Priya Shah', 'member')
    eq(p.membership.state, 'EXPIRING', 'expiring (5 days left)')
    eq(p.membership.balanceDue, 1000, 'balance')
    eq(p.today, null, 'not checked in yet')
    const l = req('GET', `${A}/attendance/lookup`, { query: '9000000077' }).data.results[0]
    eq(l.membership, null, 'lapsed: no covering membership')
    eq(l.lastMembershipEnd, shift(today, -31), 'last end date shown')
    eq(req('GET', `${A}/attendance/lookup`, { query: 'a' }).status, 400, 'query too short')
  })
  test('attendance: staff checks in a covered member (201), server sets date/time', () => {
    const r = req('POST', `${A}/attendance/check-in`, { memberId: ravi.memberId }, staff)
    eq(r.status, 201, 'status')
    raviVisit = r.data.attendance
    eq(raviVisit.visitDate, today, 'date')
    eq(raviVisit.status, 'IN', 'in')
    eq(Math.abs(Date.parse(raviVisit.checkInAt) - Date.now()) < 60000, true, 'server time')
    eq(raviVisit.membershipId !== null, true, 'linked to membership')
    eq(r.data.warnings.length, 0, 'no warnings')
    eq(audit('CHECKED_IN').length, 1, 'audited')
  })
  test('attendance: second check-in the same day → 409 ALREADY_CHECKED_IN', () => {
    const r = req('POST', `${A}/attendance/check-in`, { memberId: ravi.memberId })
    eq(r.status, 409, 'status')
    eq(r.error.code, 'ALREADY_CHECKED_IN', 'code')
    eq(r.error.details.attendance.attendanceId, raviVisit.attendanceId, 'points to the visit')
    eq(gymTab(gyms.a, 'Attendance').length, 1, 'nothing written')
  })
  test('attendance: trainer can check in; warnings for balance due and expiring', () => {
    const r = req('POST', `${A}/attendance/check-in`, { memberId: priya.memberId }, trainer)
    eq(r.status, 201, 'status')
    priyaVisit = r.data.attendance
    eq(r.data.warnings.includes('BALANCE_DUE'), true, 'balance warning')
    eq(r.data.warnings.includes('EXPIRING_SOON'), true, 'expiring warning')
  })
  test('attendance: no running membership → 409 unless overridden with a reason', () => {
    const r = req('POST', `${A}/attendance/check-in`, { memberId: lapsed.memberId })
    eq(r.error.code, 'NO_ACTIVE_MEMBERSHIP', 'code')
    eq(r.error.details.canOverride, true, 'can override')
    eq(req('POST', `${A}/attendance/check-in`, { memberId: lapsed.memberId, override: true }).status, 400, 'reason required')
    eq(req('POST', `${A}/attendance/check-in`, { memberId: lapsed.memberId, override: true, overrideReason: 'x' }).status, 400, 'reason too short')
    const ok = req('POST', `${A}/attendance/check-in`, { memberId: lapsed.memberId, override: true, overrideReason: 'Renewing at the desk' })
    eq(ok.status, 201, 'override accepted')
    eq(ok.data.attendance.overrideReason, 'Renewing at the desk', 'reason stored')
    eq(ok.data.attendance.membershipId, null, 'no membership linked')
    eq(ok.data.warnings[0], 'NO_ACTIVE_MEMBERSHIP', 'warning')
    eq(audit('CHECKED_IN_OVERRIDE').length, 1, 'override audited separately')
  })
  test('attendance: override flag is ignored (not stored) when a membership covers today', () => {
    const m = req('POST', `${A}/members`, { fullName: 'Covered Carl', phone: '9000000066' }).data.member
    req('POST', `${A}/members/${m.memberId}/memberships`, { planId: plan.planId })
    const r = req('POST', `${A}/attendance/check-in`, { memberId: m.memberId, override: true, overrideReason: 'not needed' })
    eq(r.data.attendance.overrideReason, null, 'no override recorded')
  })
  test('attendance: inactive member, unknown member, bad id', () => {
    eq(req('POST', `${A}/attendance/check-in`, { memberId: gone.memberId, override: true, overrideReason: 'please' }).error.code, 'MEMBER_INACTIVE', 'inactive')
    eq(req('POST', `${A}/attendance/check-in`, { memberId: 'MEM-' + '0'.repeat(32) }).status, 404, 'unknown')
    eq(req('POST', `${A}/attendance/check-in`, { memberId: plan.planId }).status, 400, 'wrong prefix')
    eq(req('POST', `${A}/attendance/check-in`, { memberId: ravi.memberId, visitDate: shift(today, -1) }).status, 400, 'client date rejected')
  })
  test("attendance: today's list with counts", () => {
    const r = req('GET', `${A}/attendance`, {}, trainer)
    eq(r.status, 200, 'status')
    eq(r.data.date, today, 'defaults to today')
    eq(r.data.counts.total, 4, 'total')
    eq(r.data.counts.in, 4, 'in')
    eq(r.data.counts.overrides, 1, 'overrides')
    eq(r.data.attendance[0].member !== undefined, true, 'member included')
    eq(req('GET', `${A}/attendance`, { search: 'ravi' }).data.total, 1, 'search')
    eq(req('GET', `${A}/attendance`, { date: shift(today, -1) }).data.total, 0, 'other day empty')
  })
  test('attendance: check out; cannot check out twice', () => {
    const r = req('POST', `${A}/attendance/${raviVisit.attendanceId}/check-out`, undefined, staff)
    eq(r.status, 200, 'status')
    eq(r.data.attendance.status, 'OUT', 'out')
    eq(r.data.attendance.checkOutAt !== null, true, 'time set')
    eq(req('POST', `${A}/attendance/${raviVisit.attendanceId}/check-out`).error.code, 'NOT_CHECKED_IN', 'twice')
    const list = req('GET', `${A}/attendance`, {}).data
    eq(list.counts.in, 3, 'in gym now')
    eq(list.counts.out, 1, 'left')
    eq(req('GET', `${A}/attendance`, { status: 'OUT' }).data.total, 1, 'status filter')
  })
  test('attendance: still one visit per day after checking out', () => {
    eq(req('POST', `${A}/attendance/check-in`, { memberId: ravi.memberId }).error.code, 'ALREADY_CHECKED_IN', 'no second visit')
  })
  test('attendance: staff/trainer cannot void; owner voids with reason; member can check in again', () => {
    eq(req('POST', `${A}/attendance/${priyaVisit.attendanceId}/void`, { reason: 'Wrong member' }, staff).status, 403, 'staff')
    eq(req('POST', `${A}/attendance/${priyaVisit.attendanceId}/void`, { reason: 'Wrong member' }, trainer).status, 403, 'trainer')
    eq(req('POST', `${A}/attendance/${priyaVisit.attendanceId}/void`, {}).status, 400, 'reason required')
    const r = req('POST', `${A}/attendance/${priyaVisit.attendanceId}/void`, { reason: 'Wrong member' })
    eq(r.data.attendance.status, 'VOIDED', 'voided')
    eq(req('POST', `${A}/attendance/${priyaVisit.attendanceId}/void`, { reason: 'again' }).error.code, 'ATTENDANCE_ALREADY_VOIDED', 'twice')
    eq(req('GET', `${A}/attendance`, {}).data.counts.total, 3, 'excluded from counts')
    eq(req('GET', `${A}/attendance`, { includeVoided: true }).data.total, 4, 'listed on request')
    eq(req('POST', `${A}/attendance/check-in`, { memberId: priya.memberId }).status, 201, 'can check in again')
    eq(audit('ATTENDANCE_VOIDED').length, 1, 'audited')
  })
  test("attendance: member history (last 90 days) with stats", () => {
    const r = req('GET', `${A}/members/${ravi.memberId}/attendance`, undefined, trainer)
    eq(r.data.visits.length, 1, 'visits')
    eq(r.data.stats.last30Days, 1, 'last 30')
    eq(r.data.stats.lastVisit, today, 'last visit')
    eq(req('GET', `${A}/members/${priya.memberId}/attendance`).data.visits.length, 1, 'voided excluded')
  })
  test('attendance: MEMBER role has no access', () => {
    eq(req('GET', `${A}/attendance`, {}, tok('uid-member-a')).status, 403, 'list')
    eq(req('POST', `${A}/attendance/check-in`, { memberId: ravi.memberId }, tok('uid-member-a')).status, 403, 'check-in')
  })
  test('tenant: gym A cannot check in, list, check out or void gym B → 404', () => {
    const bVisit = req('POST', `${B}/attendance/check-in`, { memberId: bMember.memberId }, ownerB).data.attendance
    eq(req('GET', `${B}/attendance`, {}).status, 404, 'list B')
    eq(req('POST', `${B}/attendance/check-in`, { memberId: bMember.memberId }).status, 404, 'check-in via B path')
    eq(req('POST', `${A}/attendance/check-in`, { memberId: bMember.memberId }).status, 404, 'B member via A path')
    eq(req('POST', `${A}/attendance/${bVisit.attendanceId}/check-out`).status, 404, 'check out B visit via A')
    eq(req('POST', `${A}/attendance/${bVisit.attendanceId}/void`, { reason: 'hijack' }).status, 404, 'void B visit via A')
    eq(req('GET', `${A}/attendance/lookup`, { query: 'B Person' }).data.total, 0, 'lookup does not find B members')
    eq(gymTab(gyms.b, 'Attendance')[0][7], 'IN', 'gym B visit untouched')
  })
  test("tenant: foreign attendance rows inside gym A's spreadsheet are invisible (Gym_ID filter)", () => {
    const tab = env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gyms.a)).getSheetByName('Attendance')._rows
    const foreign = [...tab[1]]
    foreign[0] = 'ATT-' + 'f'.repeat(32)
    foreign[1] = gyms.b
    foreign[7] = 'IN'
    tab.push(foreign)
    try {
      eq(req('GET', `${A}/attendance`, { includeVoided: true }).data.total, 5, 'not listed (still 5)')
      eq(req('POST', `${A}/attendance/${foreign[0]}/check-out`).status, 404, 'not checkout-able')
      eq(req('POST', `${A}/attendance/${foreign[0]}/void`, { reason: 'x x x' }).status, 404, 'not voidable')
      const memTab = env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gyms.a)).getSheetByName('Members')._rows
      const fMem = [...memTab[1]]
      fMem[0] = 'MEM-' + 'd'.repeat(32)
      fMem[1] = gyms.b
      fMem[3] = '+910000000002'
      memTab.push(fMem)
      try {
        eq(req('POST', `${A}/attendance/check-in`, { memberId: fMem[0], override: true, overrideReason: 'sneaky' }).status, 404, 'foreign member cannot check in')
      } finally {
        memTab.pop()
      }
    } finally {
      tab.pop()
    }
  })
}

/* ------------------------------------------------------------------ */
/* 9. Phase 9 — Staff & trainers                                       */
/* ------------------------------------------------------------------ */

/**
 * Firebase mock: verifies tokens like googleAccepting, and plays the account
 * endpoints. Records calls so tests can check what was sent to Firebase.
 */
function firebaseMock() {
  const state = { users: new Map(), calls: [], nextUid: 1, failSignUp: null, failOob: false }
  const accept = googleAccepting()
  const handler = (payload, url) => {
    const method = url.split('/v1/')[1].split('?')[0]
    state.calls.push({ method, payload })
    if (method === 'accounts:signUp') {
      if (state.failSignUp) return { code: 400, body: { error: { message: state.failSignUp } } }
      if ([...state.users.values()].some((u) => u.email === payload.email)) {
        return { code: 400, body: { error: { message: 'EMAIL_EXISTS' } } }
      }
      const uid = state.forceUid ?? `fb-uid-${state.nextUid++}`
      state.users.set(uid, { email: payload.email, password: payload.password })
      return { code: 200, body: { localId: uid, idToken: `id-token-of-${uid}` } }
    }
    if (method === 'accounts:sendOobCode') {
      return state.failOob ? { code: 400, body: { error: { message: 'QUOTA' } } } : { code: 200, body: { email: payload.email } }
    }
    if (method === 'accounts:delete') {
      const uid = String(payload.idToken).replace('id-token-of-', '')
      state.users.delete(uid)
      return { code: 200, body: {} }
    }
    return accept(payload, url)
  }
  return { state, handler }
}

{
  const env = createEnv()
  const gyms = seed(env)
  const fb = firebaseMock()
  env.setGoogle(fb.handler)
  env.run(`withScriptLock_(() => { ensureGymDatabaseLocked_('${gyms.a}'); ensureGymDatabaseLocked_('${gyms.b}'); })`)
  env.run(`createUser_({ Firebase_UID: 'uid-owner-b', Gym_ID: '${gyms.b}', Email: 'owner@b.com', Full_Name: 'Owner B', Role: 'GYM_OWNER' })`)
  const tok = (sub) => makeToken({ sub })
  const owner = tok('uid-owner-a')
  const ownerB = tok('uid-owner-b')
  const req = (method, path, body, token = owner) => call(env, { method, path, idToken: token, body })
  const A = `/gyms/${gyms.a}`
  const B = `/gyms/${gyms.b}`
  const audit = (action) => env.sheets.get('Platform_Audit_Log')._rows.filter((r) => r[2] === action)
  const usersRows = () => env.sheets.get('Users')._rows.slice(1)
  let trainer, admin, frontDesk

  test('staff: owner invites a trainer — Firebase login created, setup email sent, Users row saved', () => {
    const r = req('POST', `${A}/staff`, { fullName: 'Asha Rao', email: 'Asha@Example.com', role: 'TRAINER' })
    eq(r.status, 201, 'status')
    trainer = r.data.staff
    eq(trainer.role, 'TRAINER', 'role')
    eq(trainer.email, 'asha@example.com', 'email lower-cased')
    eq(r.data.inviteEmailSent, true, 'email sent')
    const signUp = fb.state.calls.find((c) => c.method === 'accounts:signUp')
    eq(signUp.payload.email, 'asha@example.com', 'signUp email')
    if (!signUp.payload.password || signUp.payload.password.length < 32) throw new Error('weak random password')
    eq(fb.state.calls.some((c) => c.method === 'accounts:sendOobCode' && c.payload.requestType === 'PASSWORD_RESET'), true, 'setup email')
    const row = usersRows().find((u) => u[0] === trainer.userId)
    eq(row[1], 'fb-uid-1', 'linked to the new Firebase UID')
    eq(row[2], gyms.a, 'gym from the server')
    eq(JSON.stringify(r).includes(signUp.payload.password), false, 'password never returned')
    eq(JSON.stringify(usersRows()).includes(signUp.payload.password), false, 'password never stored')
    eq(audit('STAFF_INVITED').length, 1, 'audited')
  })
  test('staff: the invited trainer can sign in and gets the TRAINER role from the database', () => {
    const r = call(env, { method: 'GET', path: '/auth/session', idToken: tok('fb-uid-1') })
    eq(r.data.user.role, 'TRAINER', 'role')
    eq(r.data.gym.gymId, gyms.a, 'gym')
    eq(r.data.permissions.includes('staff:read'), false, 'trainer cannot manage staff')
  })
  test('staff: same email again → 409 EMAIL_IN_USE without calling Firebase', () => {
    const n = fb.state.calls.length
    const r = req('POST', `${A}/staff`, { fullName: 'Asha Again', email: 'asha@example.com', role: 'STAFF' })
    eq(r.error.code, 'EMAIL_IN_USE', 'code')
    eq(fb.state.calls.length, n, 'no Firebase call')
    eq(req('POST', `${A}/staff`, { fullName: 'Owner Again', email: 'owner@a.com', role: 'STAFF' }).error.code, 'EMAIL_IN_USE', 'owner email too')
  })
  test('staff: email that already has a Firebase login → 409 EMAIL_HAS_LOGIN, nothing saved', () => {
    fb.state.users.set('someone-else', { email: 'taken@example.com' })
    const before = usersRows().length
    const r = req('POST', `${A}/staff`, { fullName: 'Taken Tom', email: 'taken@example.com', role: 'STAFF' })
    eq(r.error.code, 'EMAIL_HAS_LOGIN', 'code')
    eq(usersRows().length, before, 'no row')
  })
  test('staff: if saving fails after the login was created, the login is deleted again', () => {
    fb.state.forceUid = 'uid-member-a' // already has a Users row → USER_EXISTS inside the lock
    const r = req('POST', `${A}/staff`, { fullName: 'Clash Carl', email: 'clash@example.com', role: 'STAFF' })
    delete fb.state.forceUid
    eq(r.error.code, 'USER_EXISTS', 'code')
    eq(fb.state.calls.some((c) => c.method === 'accounts:delete' && c.payload.idToken === 'id-token-of-uid-member-a'), true, 'login deleted')
  })
  test('staff: Firebase outage → 503, nothing saved', () => {
    fb.state.failSignUp = 'INTERNAL_ERROR'
    const before = usersRows().length
    eq(req('POST', `${A}/staff`, { fullName: 'Out Age', email: 'outage@example.com', role: 'STAFF' }).status, 503, 'status')
    fb.state.failSignUp = null
    eq(usersRows().length, before, 'no row')
  })
  test('staff: owner adds an admin and a front-desk staff member', () => {
    admin = req('POST', `${A}/staff`, { fullName: 'Admin Anu', email: 'anu@example.com', role: 'GYM_ADMIN' }).data.staff
    frontDesk = req('POST', `${A}/staff`, { fullName: 'Desk Dev', email: 'dev@example.com', role: 'STAFF' }).data.staff
    eq(admin.role, 'GYM_ADMIN', 'admin')
    eq(frontDesk.role, 'STAFF', 'staff')
  })
  const adminTok = () => tok(usersRows().find((u) => u[0] === admin.userId)[1])
  const deskTok = () => tok(usersRows().find((u) => u[0] === frontDesk.userId)[1])
  test('staff: admin can add trainers/staff but not admins; staff cannot add anyone', () => {
    eq(req('POST', `${A}/staff`, { fullName: 'Second Admin', email: 'admin2@example.com', role: 'GYM_ADMIN' }, adminTok()).status, 403, 'admin → admin')
    eq(req('POST', `${A}/staff`, { fullName: 'New Trainer', email: 'trainer2@example.com', role: 'TRAINER' }, adminTok()).status, 201, 'admin → trainer')
    eq(req('POST', `${A}/staff`, { fullName: 'Sneaky', email: 'sneaky@example.com', role: 'STAFF' }, deskTok()).status, 403, 'staff → anyone')
    eq(req('GET', `${A}/staff`, undefined, deskTok()).status, 403, 'staff cannot list team')
  })
  test('staff: owner/member roles cannot be given', () => {
    eq(req('POST', `${A}/staff`, { fullName: 'Fake Owner', email: 'fo@example.com', role: 'GYM_OWNER' }).status, 400, 'owner')
    eq(req('PATCH', `${A}/staff/${frontDesk.userId}`, { role: 'GYM_OWNER' }).status, 400, 'promote to owner')
  })
  test('staff: list team — owner first, no secrets', () => {
    const r = req('GET', `${A}/staff`)
    eq(r.status, 200, 'status')
    eq(r.data.staff[0].role, 'GYM_OWNER', 'owner first')
    eq(r.data.staff.length >= 5, true, 'everyone listed')
    if (/firebase|password|uid-/i.test(JSON.stringify(r.data))) throw new Error('secret field leaked')
  })
  test('staff: owner promotes the trainer to admin; admin cannot touch admins or the owner', () => {
    const ownerRow = usersRows().find((u) => u[1] === 'uid-owner-a')[0]
    eq(req('PATCH', `${A}/staff/${ownerRow}`, { fullName: 'Hacked' }, adminTok()).status, 403, 'admin edits owner')
    eq(req('PATCH', `${A}/staff/${ownerRow}`, { status: 'INACTIVE' }, adminTok()).status, 403, 'admin deactivates owner')
    eq(req('PATCH', `${A}/staff/${frontDesk.userId}`, { role: 'GYM_ADMIN' }, adminTok()).status, 403, 'admin promotes to admin')
    const p = req('PATCH', `${A}/staff/${trainer.userId}`, { role: 'GYM_ADMIN' })
    eq(p.data.staff.role, 'GYM_ADMIN', 'owner promotes')
    eq(req('PATCH', `${A}/staff/${trainer.userId}`, { status: 'INACTIVE' }, adminTok()).status, 403, 'admin deactivates admin')
    eq(req('PATCH', `${A}/staff/${trainer.userId}`, { role: 'TRAINER' }).data.staff.role, 'TRAINER', 'owner demotes back')
    eq(audit('STAFF_UPDATED').length, 2, 'audited')
  })
  test('staff: nobody can change their own role or status', () => {
    eq(req('PATCH', `${A}/staff/${admin.userId}`, { role: 'STAFF' }, adminTok()).status, 403, 'own role')
    eq(req('PATCH', `${A}/staff/${admin.userId}`, { status: 'INACTIVE' }, adminTok()).status, 403, 'own status')
  })
  test('staff: deactivated staff are blocked on their next request; reactivation restores access', () => {
    eq(call(env, { method: 'GET', path: '/auth/session', idToken: deskTok() }).status, 200, 'works before')
    eq(req('PATCH', `${A}/staff/${frontDesk.userId}`, { status: 'INACTIVE' }, adminTok()).data.staff.status, 'INACTIVE', 'admin deactivates staff')
    eq(call(env, { method: 'GET', path: '/auth/session', idToken: deskTok() }).error.code, 'USER_INACTIVE', 'blocked at once')
    eq(audit('STAFF_DEACTIVATED').length, 1, 'audited')
    eq(req('PATCH', `${A}/staff/${frontDesk.userId}`, { status: 'ACTIVE' }).data.staff.status, 'ACTIVE', 'reactivated')
    eq(call(env, { method: 'GET', path: '/auth/session', idToken: deskTok() }).status, 200, 'works again')
  })
  test('staff: resend setup email; refused for inactive staff', () => {
    const n = fb.state.calls.filter((c) => c.method === 'accounts:sendOobCode').length
    eq(req('POST', `${A}/staff/${frontDesk.userId}/resend-invite`).data.sent, true, 'sent')
    eq(fb.state.calls.filter((c) => c.method === 'accounts:sendOobCode').length, n + 1, 'Firebase called')
    req('PATCH', `${A}/staff/${frontDesk.userId}`, { status: 'INACTIVE' })
    eq(req('POST', `${A}/staff/${frontDesk.userId}/resend-invite`).error.code, 'USER_INACTIVE', 'inactive')
    req('PATCH', `${A}/staff/${frontDesk.userId}`, { status: 'ACTIVE' })
  })
  test('tenant: gym B owner cannot see or change gym A staff → 404', () => {
    eq(req('GET', `${A}/staff`, undefined, ownerB).status, 404, 'list A')
    eq(req('PATCH', `${B}/staff/${trainer.userId}`, { status: 'INACTIVE' }, ownerB).status, 404, 'A user via B path')
    eq(req('POST', `${B}/staff/${trainer.userId}/resend-invite`, undefined, ownerB).status, 404, 'resend via B path')
    eq(usersRows().find((u) => u[0] === trainer.userId)[6], 'ACTIVE', 'untouched')
  })

  // ---- Trainers on members ----
  let member
  test('trainers: list shows active trainers only', () => {
    const second = req('GET', `${A}/staff`).data.staff.find((s) => s.fullName === 'New Trainer')
    req('PATCH', `${A}/staff/${second.userId}`, { status: 'INACTIVE' })
    const r = req('GET', `${A}/trainers`, undefined, deskTok())
    eq(r.data.trainers.map((t) => t.fullName).join(','), 'Asha Rao', 'active trainers')
  })
  test('trainers: assign on create, shown with the trainer name; audited on change', () => {
    const r = req('POST', `${A}/members`, { fullName: 'Ravi Kumar', phone: '9876543210', trainerId: trainer.userId }, deskTok())
    eq(r.status, 201, 'status')
    member = r.data.member
    eq(member.trainerId, trainer.userId, 'trainer id')
    eq(member.trainerName, 'Asha Rao', 'trainer name')
  })
  test('trainers: only active trainers of this gym can be assigned', () => {
    const inactive = req('GET', `${A}/staff`).data.staff.find((s) => s.fullName === 'New Trainer')
    eq(req('PATCH', `${A}/members/${member.memberId}`, { trainerId: inactive.userId }).status, 400, 'inactive trainer')
    eq(req('PATCH', `${A}/members/${member.memberId}`, { trainerId: admin.userId }).status, 400, 'not a trainer')
    const bOwner = usersRows().find((u) => u[1] === 'uid-owner-b')[0]
    eq(req('PATCH', `${A}/members/${member.memberId}`, { trainerId: bOwner }).status, 400, 'other gym user')
    eq(req('PATCH', `${A}/members/${member.memberId}`, { trainerId: 'USR-' + '0'.repeat(32) }).status, 400, 'unknown')
    const bTrainer = req('POST', `${B}/staff`, { fullName: 'B Trainer', email: 'btrainer@example.com', role: 'TRAINER' }, ownerB).data.staff
    eq(req('PATCH', `${A}/members/${member.memberId}`, { trainerId: bTrainer.userId }).status, 400, 'trainer of another gym')
  })
  test('trainers: "my members" filter and unassigning', () => {
    req('POST', `${A}/members`, { fullName: 'Priya Shah', phone: '9820011122' })
    const asha = tok('fb-uid-1')
    const mine = req('GET', `${A}/members`, { trainerId: trainer.userId }, asha)
    eq(mine.data.total, 1, 'one member')
    eq(mine.data.members[0].trainerName, 'Asha Rao', 'name in list')
    const cleared = req('PATCH', `${A}/members/${member.memberId}`, { trainerId: '' })
    eq(cleared.data.member.trainerId, null, 'cleared')
    eq(audit('MEMBER_TRAINER_ASSIGNED').length, 1, 'change audited')
    eq(req('GET', `${A}/members`, { trainerId: trainer.userId }, asha).data.total, 0, 'none now')
  })
}

/* ---- Upgrading an existing tab with a new trailing column ---- */
{
  const env = createEnv()
  const gyms = seed(env)
  env.run(`withScriptLock_(() => ensureGymDatabaseLocked_('${gyms.a}'))`)
  const tab = () => env.spreadsheets.get(env_gymSpreadsheetId(env.sheets, gyms.a)).getSheetByName('Members')
  test('upgrade: a Members tab without Trainer_ID gets the column appended; data untouched', () => {
    const rows = tab()._rows
    rows[0].pop() // simulate the Phase 5–8 header (no Trainer_ID)
    rows.push(['MEM-' + 'a'.repeat(32), gyms.a, 'Old Member', '+919999999999', '', '', '', '', '', '', '2026-01-01', 'ACTIVE', '', 'USR-x', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'])
    const report = env.run(`withScriptLock_(() => ensureGymDatabaseLocked_('${gyms.a}').report)`)
    if (!report.some((r) => /Added column\(s\) Trainer_ID/.test(r))) throw new Error(JSON.stringify(report))
    eq(rows[0].at(-1), 'Trainer_ID', 'header appended')
    eq(rows[1][2], 'Old Member', 'data kept')
    const probs = env.run(`validateGymDatabases_()`)
    eq(probs.filter((x) => x.includes('Members')).length, 0, 'Members valid after upgrade: ' + JSON.stringify(probs))
  })
  test('upgrade: works even if the new column already received data before the upgrade (found in review)', () => {
    const rows = tab()._rows
    rows[0].pop() // header without Trainer_ID again
    rows[1][16] = 'USR-' + 'b'.repeat(32) // value written by newer code into the header-less column
    const report = env.run(`withScriptLock_(() => ensureGymDatabaseLocked_('${gyms.a}').report)`)
    if (!report.some((r) => /Added column\(s\) Trainer_ID/.test(r))) throw new Error(JSON.stringify(report))
    eq(rows[1][16], 'USR-' + 'b'.repeat(32), 'value kept')
  })
  test('upgrade: headers that are not a clean prefix still stop with an error', () => {
    const rows = tab()._rows
    rows[0].pop() // shorter AND not a prefix: nothing may be written
    rows[0][2] = 'Name'
    const width = rows[0].length
    const res = env.run(`(() => { try { withScriptLock_(() => ensureGymDatabaseLocked_('${gyms.a}')); return 'ok'; } catch (e) { return e.message; } })()`)
    eq(rows[0].length, width, 'no header written for a non-prefix tab')
    rows[0][2] = 'Full_Name'
    rows[0].push('Trainer_ID')
    if (!/unexpected headers/.test(res)) throw new Error(res)
  })
}

console.log(`Pipeline tests (mocked Google + in-memory sheets): ${passed - before}/${passed - before + failures.filter((f) => !f.startsWith('[Tests.gs]')).length}`)

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n  ` + failures.join('\n  '))
  process.exit(1)
}
console.log(`\nAll ${passed} backend tests passed.`)
