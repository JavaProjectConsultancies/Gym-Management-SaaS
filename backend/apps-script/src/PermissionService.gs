/**
 * PermissionService.gs — authorization. Decisions use ONLY the server-side
 * context built by AuthService from the database; nothing from the request.
 */

function getPermissionsForRole_(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role) ? ROLE_PERMISSIONS[role].slice() : [];
}

function hasPermission_(ctx, permission) {
  return Boolean(ctx) && ctx.permissions.indexOf(permission) !== -1;
}

function requirePermission_(ctx, permission) {
  if (!hasPermission_(ctx, permission)) {
    recordAccessDenied_(ctx, 'PERMISSION_DENIED', permission);
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
  }
}

/** Pure check: may this context act on data belonging to gymId? */
function canAccessGym_(ctx, gymId) {
  if (!ctx || !gymId) return false;
  if (ctx.role === USER_ROLES.PLATFORM_ADMIN) return true;
  return Boolean(ctx.gymId) && ctx.gymId === gymId;
}

/**
 * Reject cross-gym access. Returns 404 rather than 403 so the existence of
 * other tenants' IDs is not revealed.
 */
function requireGymAccess_(ctx, gymId) {
  if (!canAccessGym_(ctx, gymId)) {
    recordAccessDenied_(ctx, 'CROSS_GYM_ACCESS_DENIED', gymId);
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  }
}

/** Best effort: a failed audit write must not change the response. */
function recordAccessDenied_(ctx, action, entityId) {
  try {
    logAudit_(ctx && ctx.userId ? ctx.userId : 'UNKNOWN', action, 'Access', String(entityId || ''));
  } catch (e) {
    console.error('Could not write access-denied audit entry: ' + e);
  }
}
