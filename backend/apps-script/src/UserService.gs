/**
 * UserService.gs — platform user records (central Users tab).
 */

function findUsersByFirebaseUid_(firebaseUid) {
  return findRecords_('Users', function (u) {
    return u.Firebase_UID === firebaseUid;
  });
}

/**
 * Create a user. Enforces one Users row per Firebase UID and a consistent
 * Role/Gym_ID combination. Used by provisioning (Setup.gs) — not exposed by the API yet.
 */
function createUser_(data, actorUserId) {
  return withScriptLock_(function () {
    const uid = String(data.Firebase_UID || '').trim();
    if (findUsersByFirebaseUid_(uid).length > 0) {
      throw new ApiError(409, 'USER_EXISTS', 'A user with this Firebase UID already exists.');
    }
    assertRoleGymConsistency_(data.Role, data.Gym_ID);
    if (data.Gym_ID && !findRecordById_('Gyms', data.Gym_ID)) {
      throw new ApiError(400, 'GYM_NOT_FOUND', 'Gym not found.');
    }

    const user = createRecordLocked_('Users', {
      Firebase_UID: uid,
      Gym_ID: data.Gym_ID || '',
      Email: data.Email,
      Full_Name: data.Full_Name,
      Role: data.Role,
      Status: data.Status || USER_STATUS.ACTIVE,
    });
    logAuditLocked_(actorUserId || 'SYSTEM', 'USER_CREATED', 'Users', user.User_ID);
    return user;
  });
}

/** PLATFORM_ADMIN has no gym; every other role belongs to exactly one gym. */
function assertRoleGymConsistency_(role, gymId) {
  if (role === USER_ROLES.PLATFORM_ADMIN && gymId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'PLATFORM_ADMIN users must not have a Gym_ID.');
  }
  if (role !== USER_ROLES.PLATFORM_ADMIN && !gymId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Gym_ID is required for role ' + role + '.');
  }
}

/** Fields safe to return to the signed-in user. */
function toPublicUser_(user) {
  return {
    userId: user.User_ID,
    email: user.Email,
    fullName: user.Full_Name,
    role: user.Role,
    status: user.Status,
    gymId: user.Gym_ID || null,
  };
}
