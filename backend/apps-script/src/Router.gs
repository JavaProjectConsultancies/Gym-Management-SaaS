/**
 * Router.gs — web-app entry points and REST-style routing.
 *
 * Apps Script web apps only support GET and POST, cannot read request headers
 * (no Authorization header), and always respond with HTTP 200. Therefore:
 *
 *   - All API calls are POST with a JSON envelope, sent as Content-Type
 *     text/plain to avoid a CORS preflight (Apps Script cannot answer OPTIONS):
 *       { "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE",
 *         "path":   "/gyms/GYM-.../settings",
 *         "idToken": "<Firebase ID token>",
 *         "body":   { ... } }
 *   - GET is accepted only for the public health check: ?path=/health
 *   - The logical HTTP status is returned in the response body ("status").
 *
 * Pipeline: parse → match route → validate → authenticate → authorize → handler.
 */

/* ------------------------------------------------------------------ */
/* Route table                                                         */
/* ------------------------------------------------------------------ */

/**
 * Built lazily (Apps Script loads files in order; handlers may live in later files).
 * Route fields:
 *   auth        — require a verified Firebase user (default true)
 *   permission  — required permission (PermissionService)
 *   gymParam    — path param holding a Gym_ID; cross-gym access is rejected
 *   bodyRules   — ValidationService rules for `body` (unknown fields rejected)
 *   bodyOptions — ValidationService options, e.g. { partial: true } for PATCH
 *
 * GET routes that need parameters (search, paging) take them in `body`, because
 * paths may not contain a query string.
 */
function getRoutes_() {
  return [
    {
      method: 'GET',
      path: '/health',
      auth: false,
      handler: function () {
        return { status: 'ok', service: 'gym-management-saas-api', version: APP_VERSION };
      },
    },
    {
      method: 'GET',
      path: '/auth/session',
      permission: PERMISSIONS.SESSION_READ,
      handler: function (req) {
        const ctx = req.ctx;
        return {
          user: toPublicUser_(ctx.user),
          gym: ctx.gym ? toPublicGym_(ctx.gym, ctx) : null,
          permissions: ctx.permissions.slice(),
        };
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId',
      permission: PERMISSIONS.GYM_READ,
      gymParam: 'gymId',
      handler: function (req) {
        const gym = getGymById_(req.params.gymId);
        if (!gym) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
        return { gym: toPublicGym_(gym, req.ctx) };
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId/settings',
      permission: PERMISSIONS.SETTINGS_READ,
      gymParam: 'gymId',
      handler: function (req) {
        return { settings: listGymSettings_(req.params.gymId) };
      },
    },
    {
      method: 'PUT',
      path: '/gyms/:gymId/settings/:settingKey',
      permission: PERMISSIONS.SETTINGS_WRITE,
      gymParam: 'gymId',
      bodyRules: { value: { type: 'string', required: true, maxLength: 2000 } },
      handler: function (req) {
        const key = req.params.settingKey;
        if (!SETTING_KEY_PATTERN.test(key)) {
          throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid setting key.');
        }
        if (!getGymById_(req.params.gymId)) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
        const result = upsertGymSetting_(req.params.gymId, key, req.body.value, req.ctx);
        return new StatusResult(result.created ? 201 : 200, { setting: result.setting });
      },
    },

    /* ---------------- Members (Phase 5) ---------------- */
    {
      method: 'GET',
      path: '/gyms/:gymId/members',
      permission: PERMISSIONS.MEMBERS_READ,
      gymParam: 'gymId',
      bodyRules: getMemberListRules_(),
      handler: function (req) {
        return listMembers_(getGymForRequest_(req.ctx, req.params.gymId), req.body);
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/members',
      permission: PERMISSIONS.MEMBERS_WRITE,
      gymParam: 'gymId',
      bodyRules: getMemberRules_(false),
      handler: function (req) {
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return new StatusResult(201, {
          member: toPublicMember_(createMember_(req.ctx, gym, req.body), trainerNames_(gym)),
        });
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId/members/:memberId',
      permission: PERMISSIONS.MEMBERS_READ,
      gymParam: 'gymId',
      handler: function (req) {
        assertValidId_(req.params.memberId, 'MEM', 'member ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return { member: toPublicMember_(getMember_(gym, req.params.memberId), trainerNames_(gym)) };
      },
    },
    {
      method: 'PATCH',
      path: '/gyms/:gymId/members/:memberId',
      permission: PERMISSIONS.MEMBERS_WRITE,
      gymParam: 'gymId',
      bodyRules: getMemberRules_(true),
      bodyOptions: { partial: true },
      handler: function (req) {
        assertValidId_(req.params.memberId, 'MEM', 'member ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return {
          member: toPublicMember_(updateMember_(req.ctx, gym, req.params.memberId, req.body), trainerNames_(gym)),
        };
      },
    },

    /* ---------------- Plans (Phase 6) ---------------- */
    {
      method: 'GET',
      path: '/gyms/:gymId/plans',
      permission: PERMISSIONS.PLANS_READ,
      gymParam: 'gymId',
      bodyRules: getPlanListRules_(),
      handler: function (req) {
        return listPlans_(getGymForRequest_(req.ctx, req.params.gymId), req.body);
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/plans',
      permission: PERMISSIONS.PLANS_WRITE,
      gymParam: 'gymId',
      bodyRules: getPlanRules_(false),
      handler: function (req) {
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return new StatusResult(201, { plan: toPublicPlan_(createPlan_(req.ctx, gym, req.body)) });
      },
    },
    {
      method: 'PATCH',
      path: '/gyms/:gymId/plans/:planId',
      permission: PERMISSIONS.PLANS_WRITE,
      gymParam: 'gymId',
      bodyRules: getPlanRules_(true),
      bodyOptions: { partial: true },
      handler: function (req) {
        assertValidId_(req.params.planId, 'PLN', 'plan ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return { plan: toPublicPlan_(updatePlan_(req.ctx, gym, req.params.planId, req.body)) };
      },
    },

    /* ---------------- Memberships (Phase 6) ---------------- */
    {
      method: 'GET',
      path: '/gyms/:gymId/memberships',
      permission: PERMISSIONS.MEMBERSHIPS_READ,
      gymParam: 'gymId',
      bodyRules: getMembershipListRules_(),
      handler: function (req) {
        return listMemberships_(getGymForRequest_(req.ctx, req.params.gymId), req.body);
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId/members/:memberId/memberships',
      permission: PERMISSIONS.MEMBERSHIPS_READ,
      gymParam: 'gymId',
      handler: function (req) {
        assertValidId_(req.params.memberId, 'MEM', 'member ID');
        return listMemberMemberships_(getGymForRequest_(req.ctx, req.params.gymId), req.params.memberId);
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/members/:memberId/memberships',
      permission: PERMISSIONS.MEMBERSHIPS_WRITE,
      gymParam: 'gymId',
      bodyRules: getMembershipCreateRules_(),
      handler: function (req) {
        assertValidId_(req.params.memberId, 'MEM', 'member ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return new StatusResult(201, { membership: createMembership_(req.ctx, gym, req.params.memberId, req.body) });
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/memberships/:membershipId/cancel',
      permission: PERMISSIONS.MEMBERSHIPS_WRITE,
      gymParam: 'gymId',
      bodyRules: getMembershipCancelRules_(),
      handler: function (req) {
        assertValidId_(req.params.membershipId, 'MSP', 'membership ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return { membership: cancelMembership_(req.ctx, gym, req.params.membershipId, req.body) };
      },
    },

    /* ---------------- Payments (Phase 7) ---------------- */
    {
      method: 'GET',
      path: '/gyms/:gymId/payments',
      permission: PERMISSIONS.PAYMENTS_READ,
      gymParam: 'gymId',
      bodyRules: getPaymentListRules_(),
      handler: function (req) {
        return listPayments_(getGymForRequest_(req.ctx, req.params.gymId), req.body);
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId/payments/:paymentId',
      permission: PERMISSIONS.PAYMENTS_READ,
      gymParam: 'gymId',
      handler: function (req) {
        assertValidId_(req.params.paymentId, 'PAY', 'payment ID');
        return getPaymentReceipt_(getGymForRequest_(req.ctx, req.params.gymId), req.params.paymentId);
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId/dues',
      permission: PERMISSIONS.PAYMENTS_READ,
      gymParam: 'gymId',
      bodyRules: getDuesListRules_(),
      handler: function (req) {
        return listDues_(getGymForRequest_(req.ctx, req.params.gymId), req.body);
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId/members/:memberId/payments',
      permission: PERMISSIONS.PAYMENTS_READ,
      gymParam: 'gymId',
      handler: function (req) {
        assertValidId_(req.params.memberId, 'MEM', 'member ID');
        return listMemberPayments_(getGymForRequest_(req.ctx, req.params.gymId), req.params.memberId);
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/memberships/:membershipId/payments',
      permission: PERMISSIONS.PAYMENTS_WRITE,
      gymParam: 'gymId',
      bodyRules: getPaymentRules_(),
      handler: function (req) {
        assertValidId_(req.params.membershipId, 'MSP', 'membership ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return new StatusResult(201, recordPayment_(req.ctx, gym, req.params.membershipId, req.body));
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/payments/:paymentId/void',
      permission: PERMISSIONS.PAYMENTS_VOID,
      gymParam: 'gymId',
      bodyRules: getPaymentVoidRules_(),
      handler: function (req) {
        assertValidId_(req.params.paymentId, 'PAY', 'payment ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return voidPayment_(req.ctx, gym, req.params.paymentId, req.body);
      },
    },

    /* ---------------- Staff & trainers (Phase 9) ---------------- */
    {
      method: 'GET',
      path: '/gyms/:gymId/staff',
      permission: PERMISSIONS.STAFF_READ,
      gymParam: 'gymId',
      handler: function (req) {
        return listStaff_(getGymForRequest_(req.ctx, req.params.gymId));
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/staff',
      permission: PERMISSIONS.STAFF_WRITE,
      gymParam: 'gymId',
      bodyRules: getStaffInviteRules_(),
      handler: function (req) {
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return new StatusResult(201, inviteStaff_(req.ctx, gym, req.body));
      },
    },
    {
      method: 'PATCH',
      path: '/gyms/:gymId/staff/:userId',
      permission: PERMISSIONS.STAFF_WRITE,
      gymParam: 'gymId',
      bodyRules: getStaffUpdateRules_(),
      bodyOptions: { partial: true },
      handler: function (req) {
        assertValidId_(req.params.userId, 'USR', 'user ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return updateStaff_(req.ctx, gym, req.params.userId, req.body);
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/staff/:userId/resend-invite',
      permission: PERMISSIONS.STAFF_WRITE,
      gymParam: 'gymId',
      handler: function (req) {
        assertValidId_(req.params.userId, 'USR', 'user ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return resendStaffInvite_(req.ctx, gym, req.params.userId);
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId/trainers',
      permission: PERMISSIONS.MEMBERS_READ,
      gymParam: 'gymId',
      handler: function (req) {
        return listTrainers_(getGymForRequest_(req.ctx, req.params.gymId));
      },
    },

    /* ---------------- Attendance (Phase 8) ---------------- */
    {
      method: 'GET',
      path: '/gyms/:gymId/attendance',
      permission: PERMISSIONS.ATTENDANCE_READ,
      gymParam: 'gymId',
      bodyRules: getAttendanceListRules_(),
      handler: function (req) {
        return listAttendance_(getGymForRequest_(req.ctx, req.params.gymId), req.body);
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId/attendance/lookup',
      permission: PERMISSIONS.ATTENDANCE_WRITE,
      gymParam: 'gymId',
      bodyRules: getAttendanceLookupRules_(),
      handler: function (req) {
        return lookupForCheckIn_(getGymForRequest_(req.ctx, req.params.gymId), req.body);
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/attendance/check-in',
      permission: PERMISSIONS.ATTENDANCE_WRITE,
      gymParam: 'gymId',
      bodyRules: getCheckInRules_(),
      handler: function (req) {
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return new StatusResult(201, checkIn_(req.ctx, gym, req.body));
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/attendance/:attendanceId/check-out',
      permission: PERMISSIONS.ATTENDANCE_WRITE,
      gymParam: 'gymId',
      handler: function (req) {
        assertValidId_(req.params.attendanceId, 'ATT', 'visit ID');
        return checkOut_(req.ctx, getGymForRequest_(req.ctx, req.params.gymId), req.params.attendanceId);
      },
    },
    {
      method: 'POST',
      path: '/gyms/:gymId/attendance/:attendanceId/void',
      permission: PERMISSIONS.ATTENDANCE_VOID,
      gymParam: 'gymId',
      bodyRules: getAttendanceVoidRules_(),
      handler: function (req) {
        assertValidId_(req.params.attendanceId, 'ATT', 'visit ID');
        const gym = getGymForRequest_(req.ctx, req.params.gymId);
        return voidAttendance_(req.ctx, gym, req.params.attendanceId, req.body);
      },
    },
    {
      method: 'GET',
      path: '/gyms/:gymId/members/:memberId/attendance',
      permission: PERMISSIONS.ATTENDANCE_READ,
      gymParam: 'gymId',
      handler: function (req) {
        assertValidId_(req.params.memberId, 'MEM', 'member ID');
        return listMemberAttendance_(getGymForRequest_(req.ctx, req.params.gymId), req.params.memberId);
      },
    },
  ];
}

const ALLOWED_METHODS_ = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const ENVELOPE_FIELDS_ = ['method', 'path', 'idToken', 'body', 'requestId'];
const PATH_PATTERN_ = /^\/[A-Za-z0-9_.\-\/]*$/; // no '%', so no URL-decoding is needed
const REQUEST_ID_PATTERN_ = /^[A-Za-z0-9-]{1,64}$/;

/** Handler return value carrying a non-200 success status (e.g. 201 Created). */
class StatusResult {
  constructor(status, data) {
    this.status = status;
    this.data = data;
  }
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doGet(e) {
  const requestId = newRequestId_();
  const path = e && e.parameter && e.parameter.path ? String(e.parameter.path) : '/health';
  if (path !== '/health') {
    return toTextOutput_(
      errorResponse_(requestId, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST for API requests.')),
    );
  }
  return toTextOutput_(handleRequest_({ method: 'GET', path: '/health' }, requestId));
}

function doPost(e) {
  let requestId = newRequestId_();
  try {
    const raw = e && e.postData ? e.postData.contents : '';
    if (!raw) throw new ApiError(400, 'BAD_REQUEST', 'Request body is required.');
    if (raw.length > CONFIG_DEFAULTS.MAX_REQUEST_BYTES) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }

    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch (parseError) {
      throw new ApiError(400, 'BAD_REQUEST', 'Request body must be valid JSON.');
    }
    if (envelope && typeof envelope.requestId === 'string' && REQUEST_ID_PATTERN_.test(envelope.requestId)) {
      requestId = envelope.requestId;
    }
    return toTextOutput_(handleRequest_(envelope, requestId));
  } catch (error) {
    return toTextOutput_(errorResponse_(requestId, error));
  }
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

function handleRequest_(envelope, requestId) {
  const startedAt = Date.now();
  let route = null;
  let ctx = null;
  try {
    const request = validateEnvelope_(envelope);
    const match = matchRoute_(getRoutes_(), request.method, request.path);
    route = match.route;

    // Authentication middleware
    if (route.auth !== false) {
      if (!request.idToken) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required.');
      ctx = authenticate_(request.idToken);
    }

    // Authorization middleware
    if (route.permission) requirePermission_(ctx, route.permission);
    if (route.gymParam) {
      assertValidId_(match.params[route.gymParam], 'GYM', 'gym ID');
      requireGymAccess_(ctx, match.params[route.gymParam]);
    }

    // Request validation
    const body = route.bodyRules ? validateObject_(request.body || {}, route.bodyRules, route.bodyOptions) : {};
    if (!route.bodyRules && request.body && Object.keys(request.body).length > 0) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'This endpoint does not accept a body.');
    }

    const result = route.handler({ ctx: ctx, params: match.params, body: body, requestId: requestId });
    return result instanceof StatusResult
      ? successResponse_(requestId, result.data, result.status)
      : successResponse_(requestId, result, 200);
  } catch (error) {
    return errorResponse_(requestId, error);
  } finally {
    console.log(
      JSON.stringify({
        requestId: requestId,
        route: route ? route.method + ' ' + route.path : null,
        userId: ctx ? ctx.userId : null,
        ms: Date.now() - startedAt,
      }),
    );
  }
}

function validateEnvelope_(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Request must be a JSON object.');
  }
  const unknown = Object.keys(envelope).filter(function (k) {
    return ENVELOPE_FIELDS_.indexOf(k) === -1;
  });
  if (unknown.length) throw new ApiError(400, 'BAD_REQUEST', 'Unknown request fields: ' + unknown.join(', '));

  const method = envelope.method;
  if (ALLOWED_METHODS_.indexOf(method) === -1) throw new ApiError(400, 'BAD_REQUEST', 'Invalid method.');
  const path = envelope.path;
  if (typeof path !== 'string' || path.length > 256 || !PATH_PATTERN_.test(path) || path.indexOf('..') !== -1) {
    throw new ApiError(400, 'BAD_REQUEST', 'Invalid path.');
  }
  if (envelope.idToken !== undefined && (typeof envelope.idToken !== 'string' || envelope.idToken.length > CONFIG_DEFAULTS.MAX_ID_TOKEN_LENGTH)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Invalid idToken.');
  }
  const body = envelope.body;
  if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    throw new ApiError(400, 'BAD_REQUEST', 'body must be a JSON object.');
  }
  return { method: method, path: path.replace(/\/+$/, '') || '/', idToken: envelope.idToken, body: body || null };
}

/** Match method + path against the route table; ":name" segments become params. */
function matchRoute_(routes, method, path) {
  const segments = path.split('/').filter(Boolean);
  let pathMatched = false;

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== segments.length) continue;

    const params = {};
    let ok = true;
    for (let s = 0; s < pattern.length; s++) {
      if (pattern[s].charAt(0) === ':') params[pattern[s].slice(1)] = segments[s];
      else if (pattern[s] !== segments[s]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (route.method === method) return { route: route, params: params };
  }

  if (pathMatched) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for this path.');
  throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
}
