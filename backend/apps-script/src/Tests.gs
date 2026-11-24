/**
 * Tests.gs — backend tests.
 *
 *   runUnitTests()       Pure logic only. No network, no spreadsheet reads or writes.
 *                        Also runs locally: `node scripts/test-backend.mjs`.
 *   runLiveTokenTests()  Calls Google's verification endpoint with a FORGED token and
 *                        checks it is rejected. Needs Script Properties; no data writes.
 *   runLiveSessionTest() Verifies a REAL ID token from Script Property TEST_ID_TOKEN and
 *                        resolves the user context (reads Users/Gyms only), then deletes
 *                        the property.
 *
 * Concurrent writes cannot be exercised from a single Apps Script execution; use
 * scripts/concurrency-test.mjs against a TEST deployment (docs/BACKEND_SETUP.md).
 */

/* ------------------------------------------------------------------ */
/* Tiny test harness                                                   */
/* ------------------------------------------------------------------ */

function assert_(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

function assertApiError_(fn, status, code) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof ApiError)) throw new Error('Expected ApiError ' + code + ' but got: ' + e);
    if (e.status !== status || e.code !== code) {
      throw new Error('Expected ' + status + ' ' + code + ' but got ' + e.status + ' ' + e.code);
    }
    return e;
  }
  throw new Error('Expected ApiError ' + status + ' ' + code + ' but nothing was thrown');
}

function runTestSuite_(tests) {
  const names = Object.keys(tests);
  const failures = [];
  names.forEach(function (name) {
    try {
      tests[name]();
    } catch (e) {
      failures.push(name + ': ' + e.message);
    }
  });
  const summary = (names.length - failures.length) + '/' + names.length + ' tests passed';
  if (failures.length) {
    console.error(summary + '\nFAILED:\n  ' + failures.join('\n  '));
  } else {
    console.log(summary);
  }
  return { total: names.length, failed: failures.length, failures: failures };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const T_PROJECT_ = 'test-project';
const T_NOW_ = 1800000000;
const T_GYM_A_ = 'GYM-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const T_GYM_B_ = 'GYM-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function tHeader_() {
  return { alg: 'RS256', kid: 'key-1', typ: 'JWT' };
}

function tPayload_(overrides) {
  const base = {
    iss: 'https://securetoken.google.com/' + T_PROJECT_,
    aud: T_PROJECT_,
    sub: 'uid-123',
    iat: T_NOW_ - 60,
    exp: T_NOW_ + 3000,
    auth_time: T_NOW_ - 120,
    email: 'owner@example.com',
  };
  Object.keys(overrides || {}).forEach(function (k) {
    if (overrides[k] === undefined) delete base[k];
    else base[k] = overrides[k];
  });
  return base;
}

function tUser_(overrides) {
  const u = {
    User_ID: 'USR-11111111111111111111111111111111',
    Firebase_UID: 'uid-123',
    Gym_ID: T_GYM_A_,
    Email: 'owner@example.com',
    Full_Name: 'Owner',
    Role: 'GYM_OWNER',
    Status: 'ACTIVE',
    Created_At: '2026-01-01T00:00:00.000Z',
    Updated_At: '2026-01-01T00:00:00.000Z',
  };
  Object.keys(overrides || {}).forEach(function (k) {
    u[k] = overrides[k];
  });
  return u;
}

function tGym_(overrides) {
  const g = { Gym_ID: T_GYM_A_, Gym_Name: 'Gym A', Owner_UID: 'uid-123', Spreadsheet_ID: '', Status: 'ACTIVE' };
  Object.keys(overrides || {}).forEach(function (k) {
    g[k] = overrides[k];
  });
  return g;
}

const T_IDENTITY_ = { uid: 'uid-123', email: 'owner@example.com' };

function tClaims_(payload, header) {
  return validateTokenClaims_(header || tHeader_(), payload, T_PROJECT_, T_NOW_, 60);
}

/* ------------------------------------------------------------------ */
/* Unit tests                                                          */
/* ------------------------------------------------------------------ */

function getUnitTests_() {
  return {
    // --- Token claims -------------------------------------------------
    'token: valid claims accepted': function () {
      assert_(tClaims_(tPayload_()) === true, 'valid claims');
    },
    'token: expired → TOKEN_EXPIRED': function () {
      assertApiError_(function () { tClaims_(tPayload_({ exp: T_NOW_ - 61 })); }, 401, 'TOKEN_EXPIRED');
    },
    'token: expiry within clock skew accepted': function () {
      assert_(tClaims_(tPayload_({ exp: T_NOW_ - 30 })) === true, 'skew');
    },
    'token: missing exp rejected': function () {
      assertApiError_(function () { tClaims_(tPayload_({ exp: undefined })); }, 401, 'TOKEN_EXPIRED');
    },
    'token: iat in the future rejected': function () {
      assertApiError_(function () { tClaims_(tPayload_({ iat: T_NOW_ + 3600 })); }, 401, 'INVALID_TOKEN');
    },
    'token: auth_time in the future rejected': function () {
      assertApiError_(function () { tClaims_(tPayload_({ auth_time: T_NOW_ + 3600 })); }, 401, 'INVALID_TOKEN');
    },
    'token: wrong audience (other Firebase project) rejected': function () {
      assertApiError_(function () { tClaims_(tPayload_({ aud: 'other-project' })); }, 401, 'INVALID_TOKEN');
    },
    'token: wrong issuer rejected': function () {
      assertApiError_(function () {
        tClaims_(tPayload_({ iss: 'https://securetoken.google.com/other-project' }));
      }, 401, 'INVALID_TOKEN');
    },
    'token: empty subject rejected': function () {
      assertApiError_(function () { tClaims_(tPayload_({ sub: '' })); }, 401, 'INVALID_TOKEN');
    },
    'token: subject > 128 chars rejected': function () {
      assertApiError_(function () { tClaims_(tPayload_({ sub: new Array(130).join('x') })); }, 401, 'INVALID_TOKEN');
    },
    'token: alg "none" rejected': function () {
      assertApiError_(function () { tClaims_(tPayload_(), { alg: 'none', kid: 'k' }); }, 401, 'INVALID_TOKEN');
    },
    'token: alg HS256 rejected': function () {
      assertApiError_(function () { tClaims_(tPayload_(), { alg: 'HS256', kid: 'k' }); }, 401, 'INVALID_TOKEN');
    },
    'token: missing kid rejected': function () {
      assertApiError_(function () { tClaims_(tPayload_(), { alg: 'RS256' }); }, 401, 'INVALID_TOKEN');
    },
    'token: non-JWT string rejected': function () {
      assertApiError_(function () { decodeJwtUnverified_('not-a-jwt'); }, 401, 'INVALID_TOKEN');
    },
    'token: undecodable segments rejected': function () {
      assertApiError_(function () { decodeJwtUnverified_('a$b.c%d.e'); }, 401, 'INVALID_TOKEN');
    },
    'token: too-short token rejected before any network call': function () {
      assertApiError_(function () { verifyFirebaseIdToken_('abc'); }, 401, 'INVALID_TOKEN');
    },
    'token: non-string token rejected': function () {
      assertApiError_(function () { verifyFirebaseIdToken_({ uid: 'admin' }); }, 401, 'INVALID_TOKEN');
    },
    'token: base64url decode round-trip': function () {
      const encoded = Utilities.base64EncodeWebSafe('{"a":"é✓"}', Utilities.Charset.UTF_8).replace(/=+$/, '');
      assert_(base64UrlDecode_(encoded) === '{"a":"é✓"}', 'decoded ' + base64UrlDecode_(encoded));
    },

    // --- Account checks (Google lookup result) --------------------------
    'account: UID mismatch rejected': function () {
      assertApiError_(function () { checkAccountAgainstToken_({ localId: 'other' }, tPayload_()); }, 401, 'INVALID_TOKEN');
    },
    'account: disabled Firebase user rejected': function () {
      assertApiError_(function () {
        checkAccountAgainstToken_({ localId: 'uid-123', disabled: true }, tPayload_());
      }, 401, 'ACCOUNT_DISABLED');
    },
    'account: token issued before validSince (revoked) rejected': function () {
      assertApiError_(function () {
        checkAccountAgainstToken_({ localId: 'uid-123', validSince: String(T_NOW_) }, tPayload_());
      }, 401, 'TOKEN_REVOKED');
    },
    'account: valid account accepted': function () {
      const id = checkAccountAgainstToken_({ localId: 'uid-123', email: 'Owner@Example.com', validSince: String(T_NOW_ - 999) }, tPayload_());
      assert_(id.uid === 'uid-123' && id.email === 'owner@example.com', 'identity');
    },

    // --- Tenant / user context -------------------------------------------
    'context: unknown Firebase UID → USER_NOT_REGISTERED': function () {
      assertApiError_(function () { buildUserContext_(T_IDENTITY_, [], null); }, 403, 'USER_NOT_REGISTERED');
    },
    'context: inactive user → USER_INACTIVE': function () {
      assertApiError_(function () {
        buildUserContext_(T_IDENTITY_, [tUser_({ Status: 'INACTIVE' })], tGym_());
      }, 403, 'USER_INACTIVE');
    },
    'context: inactive gym → GYM_INACTIVE': function () {
      assertApiError_(function () {
        buildUserContext_(T_IDENTITY_, [tUser_()], tGym_({ Status: 'INACTIVE' }));
      }, 403, 'GYM_INACTIVE');
    },
    'context: suspended gym → GYM_INACTIVE': function () {
      assertApiError_(function () {
        buildUserContext_(T_IDENTITY_, [tUser_()], tGym_({ Status: 'SUSPENDED' }));
      }, 403, 'GYM_INACTIVE');
    },
    'context: missing gym → GYM_NOT_FOUND': function () {
      assertApiError_(function () { buildUserContext_(T_IDENTITY_, [tUser_()], null); }, 403, 'GYM_NOT_FOUND');
    },
    'context: duplicate Users rows → ACCOUNT_CONFLICT': function () {
      assertApiError_(function () {
        buildUserContext_(T_IDENTITY_, [tUser_(), tUser_()], tGym_());
      }, 403, 'ACCOUNT_CONFLICT');
    },
    'context: unknown role → ACCOUNT_CONFLICT': function () {
      assertApiError_(function () {
        buildUserContext_(T_IDENTITY_, [tUser_({ Role: 'SUPERUSER' })], tGym_());
      }, 403, 'ACCOUNT_CONFLICT');
    },
    'context: platform admin with a Gym_ID → ACCOUNT_CONFLICT': function () {
      assertApiError_(function () {
        buildUserContext_(T_IDENTITY_, [tUser_({ Role: 'PLATFORM_ADMIN' })], tGym_());
      }, 403, 'ACCOUNT_CONFLICT');
    },
    'context: valid user gets role/gym from DB': function () {
      const ctx = buildUserContext_(T_IDENTITY_, [tUser_({ Role: 'TRAINER' })], tGym_());
      assert_(ctx.role === 'TRAINER' && ctx.gymId === T_GYM_A_, 'role/gym');
      assert_(ctx.permissions.indexOf('settings:write') === -1, 'trainer cannot write settings');
    },
    'context: valid platform admin': function () {
      const ctx = buildUserContext_(T_IDENTITY_, [tUser_({ Role: 'PLATFORM_ADMIN', Gym_ID: '' })], null);
      assert_(ctx.role === 'PLATFORM_ADMIN' && ctx.gymId === null, 'admin');
    },

    // --- Permissions / cross-gym -----------------------------------------
    'permission: MEMBER lacks settings:write (unauthorized role)': function () {
      const ctx = buildUserContext_(T_IDENTITY_, [tUser_({ Role: 'MEMBER' })], tGym_());
      assert_(!hasPermission_(ctx, PERMISSIONS.SETTINGS_WRITE), 'member write');
      assert_(!hasPermission_(ctx, PERMISSIONS.SETTINGS_READ), 'member read settings');
      assert_(hasPermission_(ctx, PERMISSIONS.SESSION_READ), 'member session');
    },
    'permission: GYM_OWNER has settings:write': function () {
      const ctx = buildUserContext_(T_IDENTITY_, [tUser_()], tGym_());
      assert_(hasPermission_(ctx, PERMISSIONS.SETTINGS_WRITE), 'owner write');
      assert_(!hasPermission_(ctx, PERMISSIONS.PLATFORM_MANAGE), 'owner not platform');
    },
    'permission: null context has no permissions': function () {
      assert_(!hasPermission_(null, PERMISSIONS.SESSION_READ), 'null ctx');
    },
    'permission: every role in ROLE_PERMISSIONS uses known permissions': function () {
      const known = Object.values(PERMISSIONS);
      Object.keys(ROLE_PERMISSIONS).forEach(function (role) {
        ROLE_PERMISSIONS[role].forEach(function (p) {
          assert_(known.indexOf(p) !== -1, role + ' has unknown permission ' + p);
        });
      });
      Object.values(USER_ROLES).forEach(function (role) {
        assert_(ROLE_PERMISSIONS[role], 'role without permissions: ' + role);
      });
    },
    'tenant: own gym allowed': function () {
      const ctx = buildUserContext_(T_IDENTITY_, [tUser_()], tGym_());
      assert_(canAccessGym_(ctx, T_GYM_A_), 'own gym');
    },
    'tenant: cross-gym access denied': function () {
      const ctx = buildUserContext_(T_IDENTITY_, [tUser_()], tGym_());
      assert_(!canAccessGym_(ctx, T_GYM_B_), 'other gym');
      assert_(!canAccessGym_(ctx, ''), 'empty gym');
      assert_(!canAccessGym_(ctx, null), 'null gym');
    },
    'tenant: platform admin may access any gym': function () {
      const ctx = buildUserContext_(T_IDENTITY_, [tUser_({ Role: 'PLATFORM_ADMIN', Gym_ID: '' })], null);
      assert_(canAccessGym_(ctx, T_GYM_B_), 'admin');
    },

    // --- Request handling --------------------------------------------------
    'router: health check is public': function () {
      const res = handleRequest_({ method: 'GET', path: '/health' }, 'req-1');
      assert_(res.ok === true && res.status === 200 && res.data.status === 'ok', JSON.stringify(res));
    },
    'router: protected route without token → 401': function () {
      const res = handleRequest_({ method: 'GET', path: '/auth/session' }, 'req-2');
      assert_(res.ok === false && res.status === 401 && res.error.code === 'UNAUTHENTICATED', JSON.stringify(res));
    },
    'router: unknown path → 404': function () {
      const res = handleRequest_({ method: 'GET', path: '/nope' }, 'req-3');
      assert_(res.status === 404, JSON.stringify(res));
    },
    'router: wrong method → 405': function () {
      const res = handleRequest_({ method: 'DELETE', path: '/health' }, 'req-4');
      assert_(res.status === 405, JSON.stringify(res));
    },
    'router: client-supplied role/gymId fields rejected': function () {
      const res = handleRequest_({ method: 'GET', path: '/health', role: 'PLATFORM_ADMIN', gymId: T_GYM_B_ }, 'req-5');
      assert_(res.status === 400 && res.error.code === 'BAD_REQUEST', JSON.stringify(res));
    },
    'router: path traversal rejected': function () {
      const res = handleRequest_({ method: 'GET', path: '/gyms/../health' }, 'req-6');
      assert_(res.status === 400, JSON.stringify(res));
    },
    'router: route params extracted': function () {
      const m = matchRoute_(getRoutes_(), 'PUT', '/gyms/' + T_GYM_A_ + '/settings/business.name');
      assert_(m.params.gymId === T_GYM_A_ && m.params.settingKey === 'business.name', JSON.stringify(m.params));
    },
    'router: internal errors are not leaked': function () {
      const res = errorResponse_('req-7', new Error('secret spreadsheet id xyz'));
      assert_(res.status === 500 && JSON.stringify(res).indexOf('xyz') === -1, JSON.stringify(res));
    },

    // --- Validation & storage helpers --------------------------------------
    'validation: unknown body fields rejected (e.g. Gym_ID smuggling)': function () {
      const e = assertApiError_(function () {
        validateObject_({ value: 'x', Gym_ID: T_GYM_B_ }, { value: { type: 'string', required: true } });
      }, 400, 'VALIDATION_FAILED');
      assert_(e.details.fields.Gym_ID, 'Gym_ID flagged');
    },
    'validation: required, length and enum rules': function () {
      assertApiError_(function () { validateObject_({}, { a: { type: 'string', required: true } }); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ a: 'abcdef' }, { a: { type: 'string', maxLength: 3 } }); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ a: 'X' }, { a: { type: 'enum', values: ['Y'] } }); }, 400, 'VALIDATION_FAILED');
      assert_(validateObject_({ a: ' A@B.com ' }, { a: { type: 'email' } }).a === 'a@b.com', 'email normalised');
    },
    'validation: path IDs must match prefix and format': function () {
      assertValidId_(T_GYM_A_, 'GYM', 'gym ID');
      assertApiError_(function () { assertValidId_('USR-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'GYM', 'gym ID'); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { assertValidId_('GYM-1', 'GYM', 'gym ID'); }, 400, 'VALIDATION_FAILED');
    },
    'validation: setting key pattern': function () {
      assert_(SETTING_KEY_PATTERN.test('business.timezone'), 'valid key');
      assert_(!SETTING_KEY_PATTERN.test('Business'), 'uppercase');
      assert_(!SETTING_KEY_PATTERN.test('=cmd'), 'formula');
    },
    'ids: format and uniqueness (1000 IDs)': function () {
      const seen = {};
      for (let i = 0; i < 1000; i++) {
        const id = generateId_('GYM');
        assert_(/^GYM-[0-9a-f]{32}$/.test(id), 'format ' + id);
        assert_(!seen[id], 'duplicate ' + id);
        seen[id] = true;
      }
    },
    'storage: formula injection neutralised': function () {
      assert_(escapeCell_('=HYPERLINK("x")') === "'=HYPERLINK(\"x\")", '=');
      assert_(escapeCell_('+1') === "'+1" && escapeCell_('-1') === "'-1" && escapeCell_('@a') === "'@a", '+-@');
      assert_(escapeCell_('plain') === "'plain" && escapeCell_(null) === '' && escapeCell_('') === '', 'plain');
    },
    'storage: every value is forced to text so Sheets cannot reformat it': function () {
      ['1500.00', '2026-11-24', '09876543210', '30', 'TRUE', '1/2'].forEach(function (v) {
        assert_(escapeCell_(v) === "'" + v, v);
      });
    },
    'validation: money/int read back the way Sheets may display them': function () {
      const r = { m: { type: 'money', required: true }, i: { type: 'int', required: true } };
      assert_(validateObject_({ m: '1500', i: '30' }, r).m === '1500.00', '"1500" → 1500.00');
      assert_(validateObject_({ m: '1,500.5', i: '1,000' }, r).m === '1500.50', 'thousands separators');
      assert_(validateObject_({ m: '1500', i: '30.00' }, r).i === '30', '"30.00" → 30');
      assertApiError_(function () { validateObject_({ m: '1500.555', i: 1 }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ m: '₹1500', i: 1 }, r); }, 400, 'VALIDATION_FAILED');
    },

    /* ---------------- Phase 4/5 ---------------- */
    'validation: phone numbers normalised and checked': function () {
      const r = { p: { type: 'phone' } };
      assert_(validateObject_({ p: '+91 98765-43210' }, r).p === '+919876543210', 'separators removed');
      assert_(validateObject_({ p: '(022) 2345.6789' }, r).p === '02223456789', 'leading zero kept');
      assertApiError_(function () { validateObject_({ p: '12345' }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ p: '98765x43210' }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ p: '=1+1' }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ p: 9876543210 }, r); }, 400, 'VALIDATION_FAILED');
    },
    'validation: dates must be real calendar dates': function () {
      assert_(isValidIsoDate_('2024-02-29'), 'leap day');
      assert_(!isValidIsoDate_('2023-02-29'), 'not a leap year');
      assert_(!isValidIsoDate_('2026-13-01') && !isValidIsoDate_('2026-04-31'), 'bad month/day');
      assert_(!isValidIsoDate_('24/11/2026') && !isValidIsoDate_('2026-1-5'), 'format');
      assert_(!isValidIsoDate_('1850-01-01'), 'too old');
      assert_(addDaysIso_('2026-12-31', 1) === '2027-01-01', 'addDays year rollover');
      assert_(addDaysIso_('2024-02-28', 1) === '2024-02-29', 'addDays leap');
    },
    'validation: integer range rules': function () {
      const r = { n: { type: 'number', integer: true, min: 1, max: 100 } };
      assert_(validateObject_({ n: 5 }, r).n === 5, 'ok');
      assertApiError_(function () { validateObject_({ n: 0 }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ n: 101 }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ n: 2.5 }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ n: '5' }, r); }, 400, 'VALIDATION_FAILED');
    },
    'validation: partial mode (PATCH) skips absent fields and clears optional ones': function () {
      const r = { a: { type: 'string', required: true }, b: { type: 'string' } };
      const out = validateObject_({ b: '' }, r, { partial: true });
      assert_(!('a' in out), 'absent required field skipped');
      assert_(out.b === '', 'optional field cleared');
      assertApiError_(function () { validateObject_({ a: '' }, r, { partial: true }); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ c: 'x' }, r, { partial: true }); }, 400, 'VALIDATION_FAILED');
    },
    'members: create rules reject server-owned fields': function () {
      ['memberId', 'gymId', 'Gym_ID', 'status', 'createdBy', 'createdAt'].forEach(function (f) {
        const body = { fullName: 'A B', phone: '9876543210' };
        body[f] = 'x';
        assertApiError_(function () { validateObject_(body, getMemberRules_(false)); }, 400, 'VALIDATION_FAILED');
      });
    },
    'members: update rules reject immutable fields': function () {
      ['memberId', 'gymId', 'createdBy', 'createdAt'].forEach(function (f) {
        const body = {};
        body[f] = 'x';
        assertApiError_(function () { validateObject_(body, getMemberRules_(true), { partial: true }); }, 400, 'VALIDATION_FAILED');
      });
    },
    'members: phone duplicates ignore country code and trunk zero': function () {
      assert_(phonesMatch_('+919000000001', '9000000001'), '+91 vs national');
      assert_(phonesMatch_('09000000001', '+919000000001'), 'trunk 0 vs +91');
      assert_(phonesMatch_('+14155550100', '4155550100'), '+1');
      assert_(!phonesMatch_('+919000000001', '+919000000002'), 'different numbers');
      assert_(!phonesMatch_('1234567', '91234567'), 'short numbers need an exact match');
      assert_(!phonesMatch_('9000000001', '12349000000001'), 'prefix longer than a country code');
    },
    /* ---------------- Phase 6 ---------------- */
    'validation: money and int column types': function () {
      const r = { m: { type: 'money', required: true }, i: { type: 'int', required: true } };
      const out = validateObject_({ m: 1500, i: 30 }, r);
      assert_(out.m === '1500.00' && out.i === '30', 'numbers formatted for storage');
      assert_(validateObject_({ m: '99.50', i: '007' }, r).i === '7', 'strings from the sheet accepted');
      assertApiError_(function () { validateObject_({ m: '-5.00', i: 30 }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ m: 'abc', i: 30 }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ m: 10, i: 2.5 }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ m: '=1+1', i: 1 }, r); }, 400, 'VALIDATION_FAILED');
    },
    'validation: price decimals': function () {
      const r = { p: { type: 'number', min: 0, decimals: 2 } };
      assert_(validateObject_({ p: 1499.99 }, r).p === 1499.99, '2 decimals ok');
      assert_(validateObject_({ p: 0.1 + 0.2 }, r).p > 0, 'float noise tolerated');
      assertApiError_(function () { validateObject_({ p: 10.005 }, r); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ p: -1 }, r); }, 400, 'VALIDATION_FAILED');
    },
    'memberships: computed state from dates': function () {
      const m = function (start, end, status) {
        return { Start_Date: start, End_Date: end, Status: status || 'ACTIVE' };
      };
      const today = '2026-06-15';
      assert_(membershipState_(m('2026-06-16', '2026-07-15'), today) === 'UPCOMING', 'upcoming');
      assert_(membershipState_(m('2026-06-01', '2026-06-30'), today) === 'ACTIVE', 'active (16 days left)');
      assert_(membershipState_(m('2026-06-01', '2026-06-21'), today) === 'EXPIRING', 'expiring (7 days left)');
      assert_(membershipState_(m('2026-06-01', '2026-06-22'), today) === 'ACTIVE', 'active (8 days left)');
      assert_(membershipState_(m('2026-06-01', '2026-06-15'), today) === 'EXPIRING', 'last day');
      assert_(membershipState_(m('2026-05-01', '2026-06-14'), today) === 'EXPIRED', 'expired yesterday');
      assert_(membershipState_(m('2026-06-01', '2026-06-30', 'CANCELLED'), today) === 'CANCELLED', 'cancelled');
    },
    'memberships: overlap and default start': function () {
      assert_(rangesOverlap_('2026-01-01', '2026-01-31', '2026-01-31', '2026-02-28'), 'shared day overlaps');
      assert_(!rangesOverlap_('2026-01-01', '2026-01-31', '2026-02-01', '2026-02-28'), 'back to back ok');
      const rows = [
        { Start_Date: '2026-05-01', End_Date: '2026-06-30', Status: 'ACTIVE' },
        { Start_Date: '2026-07-01', End_Date: '2026-07-31', Status: 'CANCELLED' },
        { Start_Date: '2026-01-01', End_Date: '2026-01-31', Status: 'ACTIVE' },
      ];
      assert_(defaultMembershipStart_(rows, '2026-06-15') === '2026-07-01', 'day after current ends; cancelled ignored');
      assert_(defaultMembershipStart_(rows, '2026-08-01') === '2026-08-01', 'lapsed → today');
      assert_(defaultMembershipStart_([], '2026-08-01') === '2026-08-01', 'none → today');
      assert_(daysBetweenIso_('2026-12-31', '2027-01-01') === 1, 'daysBetween');
    },
    'memberships: suggested start skips a chain of memberships (found in live testing)': function () {
      const rows = [
        { Start_Date: '2026-11-24', End_Date: '2026-12-23', Status: 'ACTIVE' },
        { Start_Date: '2026-12-24', End_Date: '2027-01-22', Status: 'ACTIVE' },
        { Start_Date: '2027-03-01', End_Date: '2027-03-31', Status: 'ACTIVE' },
        { Start_Date: '2027-01-23', End_Date: '2027-02-21', Status: 'CANCELLED' },
      ];
      assert_(nextFreeStart_(rows, '2026-12-01', 30) === '2027-01-23', 'after the chain; cancelled ignored');
      assert_(nextFreeStart_(rows, '2027-01-25', 60) === '2027-04-01', '60 days would hit March → after it');
      assert_(nextFreeStart_(rows, '2027-02-01', 20) === '2027-02-01', 'gap big enough');
      assert_(displayDate_('2026-11-04') === '4 Nov 2026', 'display date');
    },
    /* ---------------- Phase 9 ---------------- */
    'staff: who may manage which role': function () {
      const owner = { role: 'GYM_OWNER' };
      const admin = { role: 'GYM_ADMIN' };
      const staff = { role: 'STAFF' };
      const platform = { role: 'PLATFORM_ADMIN' };
      ['GYM_ADMIN', 'TRAINER', 'STAFF'].forEach(function (r) {
        assert_(canManageRole_(owner, r) && canManageRole_(platform, r), 'owner/platform manage ' + r);
      });
      assert_(canManageRole_(admin, 'TRAINER') && canManageRole_(admin, 'STAFF'), 'admin manages trainer/staff');
      assert_(!canManageRole_(admin, 'GYM_ADMIN'), 'admin cannot manage admins');
      ['GYM_OWNER', 'MEMBER', 'PLATFORM_ADMIN'].forEach(function (r) {
        assert_(!canManageRole_(owner, r) && !canManageRole_(platform, r), 'nobody manages ' + r + ' here');
      });
      assert_(!canManageRole_(staff, 'TRAINER'), 'staff manage nobody');
    },
    'staff: invite rules reject owner/member roles and server-owned fields': function () {
      const ok = { fullName: 'Asha Rao', email: 'asha@example.com', role: 'TRAINER' };
      validateObject_(ok, getStaffInviteRules_());
      ['GYM_OWNER', 'MEMBER', 'PLATFORM_ADMIN'].forEach(function (role) {
        assertApiError_(function () { validateObject_(Object.assign({}, ok, { role: role }), getStaffInviteRules_()); }, 400, 'VALIDATION_FAILED');
      });
      ['gymId', 'Gym_ID', 'firebaseUid', 'status', 'password'].forEach(function (f) {
        const body = Object.assign({}, ok);
        body[f] = 'x';
        assertApiError_(function () { validateObject_(body, getStaffInviteRules_()); }, 400, 'VALIDATION_FAILED');
      });
    },
    'permission: staff management by role': function () {
      const can = function (role, p) { return getPermissionsForRole_(role).indexOf(p) !== -1; };
      assert_(can('GYM_OWNER', 'staff:write') && can('GYM_ADMIN', 'staff:write'), 'owner/admin');
      ['STAFF', 'TRAINER', 'MEMBER'].forEach(function (r) {
        assert_(!can(r, 'staff:read') && !can(r, 'staff:write'), r + ' none');
      });
    },

    /* ---------------- Phase 8 ---------------- */
    'attendance: covering membership is the one running today': function () {
      const ms = [
        { Membership_ID: 'old', Start_Date: '2026-01-01', End_Date: '2026-05-31', Status: 'ACTIVE' },
        { Membership_ID: 'now', Start_Date: '2026-06-01', End_Date: '2026-06-30', Status: 'ACTIVE' },
        { Membership_ID: 'next', Start_Date: '2026-07-01', End_Date: '2026-07-31', Status: 'ACTIVE' },
        { Membership_ID: 'gone', Start_Date: '2026-06-01', End_Date: '2026-08-30', Status: 'CANCELLED' },
      ];
      assert_(coveringMembership_(ms, '2026-06-15').Membership_ID === 'now', 'running one');
      assert_(coveringMembership_(ms, '2026-06-30').Membership_ID === 'now', 'last day counts');
      assert_(coveringMembership_(ms, '2026-08-15') === null, 'cancelled never covers');
      assert_(coveringMembership_([ms[2]], '2026-06-15') === null, 'upcoming does not cover');
    },
    'attendance: one visit per member per day; voided visits do not count': function () {
      const rows = [
        { Member_ID: 'A', Visit_Date: '2026-06-15', Status: 'VOIDED' },
        { Member_ID: 'A', Visit_Date: '2026-06-14', Status: 'OUT' },
        { Member_ID: 'B', Visit_Date: '2026-06-15', Status: 'IN' },
      ];
      assert_(visitOn_(rows, 'A', '2026-06-15') === null, 'voided ignored');
      assert_(visitOn_(rows, 'B', '2026-06-15').Status === 'IN', 'found');
    },
    'permission: attendance by role': function () {
      const can = function (role, p) { return getPermissionsForRole_(role).indexOf(p) !== -1; };
      ['GYM_OWNER', 'GYM_ADMIN'].forEach(function (r) {
        assert_(can(r, 'attendance:write') && can(r, 'attendance:void'), r);
      });
      ['STAFF', 'TRAINER'].forEach(function (r) {
        assert_(can(r, 'attendance:write') && !can(r, 'attendance:void'), r + ' checks in, cannot void');
      });
      assert_(!can('MEMBER', 'attendance:read'), 'MEMBER none');
    },
    'attendance: client cannot choose time, date or status': function () {
      ['checkInAt', 'visitDate', 'status', 'gymId', 'membershipId'].forEach(function (f) {
        const body = { memberId: 'MEM-' + new Array(33).join('a') };
        body[f] = 'x';
        assertApiError_(function () { validateObject_(body, getCheckInRules_()); }, 400, 'VALIDATION_FAILED');
      });
    },

    /* ---------------- Phase 7 ---------------- */
    'payments: money maths in paise (no floating-point drift)': function () {
      assert_(toPaise_('0.10') + toPaise_('0.20') === 30, '0.1 + 0.2');
      assert_(toPaise_(1499.99) === 149999 && toPaise_('1500.00') === 150000, 'conversion');
      assert_(toPaise_('1.15') === 115 && toPaise_('0.29') === 29 && toPaise_(4.35) === 435, 'values that are inexact in binary');
      const paid = paidByMembership_([
        { Membership_ID: 'A', Amount: '1000.10', Status: 'RECORDED' },
        { Membership_ID: 'A', Amount: '499.90', Status: 'RECORDED' },
        { Membership_ID: 'A', Amount: '9999.00', Status: 'VOIDED' },
        { Membership_ID: 'B', Amount: '1.00', Status: 'RECORDED' },
      ]);
      assert_(paid.A === 150000 && paid.B === 100, 'voided payments excluded');
    },
    'payments: receipt numbers are sequential and survive gaps': function () {
      assert_(nextReceiptNo_([]) === 'R-000001', 'first');
      assert_(nextReceiptNo_([{ Receipt_No: 'R-000009' }, { Receipt_No: 'R-000002' }]) === 'R-000010', 'after max');
      assert_(nextReceiptNo_([{ Receipt_No: 'junk' }, { Receipt_No: 'R-000005' }]) === 'R-000006', 'ignores junk');
      assert_(nextReceiptNo_([{ Receipt_No: 'R-999999' }]) === 'R-1000000', 'grows past 6 digits');
    },
    'permission: payments by role': function () {
      const can = function (role, p) { return getPermissionsForRole_(role).indexOf(p) !== -1; };
      ['GYM_OWNER', 'GYM_ADMIN'].forEach(function (r) {
        assert_(can(r, 'payments:read') && can(r, 'payments:write') && can(r, 'payments:void'), r);
      });
      assert_(can('STAFF', 'payments:write') && !can('STAFF', 'payments:void'), 'STAFF collects, cannot void');
      assert_(!can('TRAINER', 'payments:read') && !can('MEMBER', 'payments:read'), 'TRAINER/MEMBER none');
    },
    'payments: create rules reject server-owned fields': function () {
      ['receiptNo', 'status', 'memberId', 'gymId', 'membershipId'].forEach(function (f) {
        const body = { amount: 100, method: 'CASH' };
        body[f] = 'x';
        assertApiError_(function () { validateObject_(body, getPaymentRules_()); }, 400, 'VALIDATION_FAILED');
      });
      assertApiError_(function () { validateObject_({ amount: 0, method: 'CASH' }, getPaymentRules_()); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { validateObject_({ amount: 10, method: 'CHEQUE' }, getPaymentRules_()); }, 400, 'VALIDATION_FAILED');
    },
    'permission: plans and memberships by role': function () {
      const can = function (role, p) { return getPermissionsForRole_(role).indexOf(p) !== -1; };
      ['GYM_OWNER', 'GYM_ADMIN'].forEach(function (r) {
        assert_(can(r, 'plans:write') && can(r, 'memberships:write'), r);
      });
      assert_(can('STAFF', 'memberships:write') && !can('STAFF', 'plans:write'), 'STAFF sells, cannot price');
      assert_(can('TRAINER', 'memberships:read') && !can('TRAINER', 'memberships:write'), 'TRAINER read only');
      assert_(!can('MEMBER', 'plans:read') && !can('MEMBER', 'memberships:read'), 'MEMBER none');
    },
    'memberships: create rules reject server-owned fields': function () {
      ['endDate', 'status', 'memberId', 'gymId', 'planName'].forEach(function (f) {
        const body = { planId: 'PLN-' + new Array(33).join('a') };
        body[f] = 'x';
        assertApiError_(function () { validateObject_(body, getMembershipCreateRules_()); }, 400, 'VALIDATION_FAILED');
      });
    },
    'members: date business rules': function () {
      assertMemberDates_('1990-05-01', '2026-01-01', '2026-06-01');
      const futureDob = assertApiError_(function () { assertMemberDates_('2026-07-01', '2026-08-01', '2026-06-01'); }, 400, 'VALIDATION_FAILED');
      assert_(futureDob.details.fields.dateOfBirth === 'Cannot be in the future.', 'future DOB message');
      assertApiError_(function () { assertMemberDates_('', '2027-07-01', '2026-06-01'); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { assertMemberDates_('', '1980-01-01', '2026-06-01'); }, 400, 'VALIDATION_FAILED');
      assertApiError_(function () { assertMemberDates_('2026-02-01', '2026-01-01', '2026-06-01'); }, 400, 'VALIDATION_FAILED');
    },
    'permission: member access by role': function () {
      const can = function (role, p) { return getPermissionsForRole_(role).indexOf(p) !== -1; };
      ['GYM_OWNER', 'GYM_ADMIN', 'STAFF', 'PLATFORM_ADMIN'].forEach(function (role) {
        assert_(can(role, 'members:read') && can(role, 'members:write'), role + ' read+write');
      });
      assert_(can('TRAINER', 'members:read') && !can('TRAINER', 'members:write'), 'TRAINER read only');
      assert_(!can('MEMBER', 'members:read') && !can('MEMBER', 'members:write'), 'MEMBER none');
    },
    'gym db: spreadsheet ID must exist and be well-formed': function () {
      assertApiError_(function () { gymDb_(tGym_({ Spreadsheet_ID: '' })); }, 503, 'GYM_DATABASE_NOT_READY');
      assertApiError_(function () { gymDb_(tGym_({ Spreadsheet_ID: '../../etc' })); }, 500, 'DATA_INTEGRITY_ERROR');
      assert_(gymDb_(tGym_({ Spreadsheet_ID: '1AbC_def-GHIjklMNOpqrSTUvwxyz' })).schema === GYM_SCHEMA, 'gym schema');
    },
    'gym db: central and gym schemas do not share table names': function () {
      Object.keys(GYM_SCHEMA).forEach(function (t) {
        assert_(!Object.prototype.hasOwnProperty.call(SCHEMA, t), 'shared table ' + t);
      });
    },
  };
}

/** Run from the Apps Script editor. Safe: no network, no spreadsheet access. */
function runUnitTests() {
  return runTestSuite_(getUnitTests_());
}

/* ------------------------------------------------------------------ */
/* Live tests (Apps Script editor; require Script Properties)          */
/* ------------------------------------------------------------------ */

/**
 * Proves Google rejects a token whose claims are well-formed but whose signature
 * is forged. No spreadsheet access, no writes.
 */
function runLiveTokenTests() {
  const config = getConfig_();
  const now = Math.floor(Date.now() / 1000);
  const enc = function (obj) {
    return Utilities.base64EncodeWebSafe(JSON.stringify(obj), Utilities.Charset.UTF_8).replace(/=+$/, '');
  };
  const payload = {
    iss: 'https://securetoken.google.com/' + config.firebaseProjectId,
    aud: config.firebaseProjectId,
    sub: 'forged-uid',
    iat: now - 10,
    exp: now + 3000,
    auth_time: now - 10,
  };
  const forged = enc({ alg: 'RS256', kid: 'forged', typ: 'JWT' }) + '.' + enc(payload) + '.' + enc({ sig: 'forged' });
  const expired = enc({ alg: 'RS256', kid: 'k' }) + '.' + enc(Object.assign({}, payload, { exp: now - 3600 })) + '.sig';

  return runTestSuite_({
    'live: forged signature rejected by Google': function () {
      assertApiError_(function () { lookupAccountWithGoogle_(forged, config.firebaseWebApiKey); }, 401, 'INVALID_TOKEN');
    },
    'live: forged token rejected end-to-end': function () {
      assertApiError_(function () { verifyFirebaseIdToken_(forged); }, 401, 'INVALID_TOKEN');
    },
    'live: expired token rejected': function () {
      assertApiError_(function () { verifyFirebaseIdToken_(expired); }, 401, 'TOKEN_EXPIRED');
    },
    'live: garbage token rejected': function () {
      assertApiError_(function () { verifyFirebaseIdToken_('x.y.z' + new Array(30).join('a')); }, 401, 'INVALID_TOKEN');
    },
  });
}

/**
 * Verifies a real token end-to-end (Google verification + Users/Gyms lookup).
 * Put a fresh ID token in Script Property TEST_ID_TOKEN first (see docs/AUTHENTICATION.md).
 * Reads only; the property is deleted afterwards.
 */
function runLiveSessionTest() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TEST_ID_TOKEN');
  if (!token) throw new Error('Set Script Property TEST_ID_TOKEN to a fresh Firebase ID token first.');
  try {
    const res = handleRequest_({ method: 'GET', path: '/auth/session', idToken: token }, 'live-session-test');
    console.log(JSON.stringify(res, null, 2));
    return res;
  } finally {
    props.deleteProperty('TEST_ID_TOKEN');
  }
}
