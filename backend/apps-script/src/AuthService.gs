/**
 * AuthService.gs — authentication middleware.
 *
 * Flow: verified Firebase UID → Users row → Role + Gym_ID FROM THE DATABASE
 * → user status → gym status → request context.
 *
 * Firebase proves WHO the caller is. WHAT they may do comes only from here.
 * Gym_ID / Role sent by the client are never read.
 */

/** Authenticate a request and build the server-side context. */
function authenticate_(idToken) {
  const identity = verifyFirebaseIdToken_(idToken);
  const users = findUsersByFirebaseUid_(identity.uid);
  const user = users.length === 1 ? users[0] : null;
  const gym = user && user.Gym_ID ? getGymById_(user.Gym_ID) : null;
  return buildUserContext_(identity, users, gym);
}

/**
 * Pure (no I/O) so every rule is unit-testable — see Tests.gs.
 * @param identity verified token identity { uid, email }
 * @param users    Users rows matching identity.uid
 * @param gym      the user's Gyms row, or null
 */
function buildUserContext_(identity, users, gym) {
  if (!users || users.length === 0) {
    console.warn('Unregistered Firebase UID attempted access: ' + identity.uid);
    throw new ApiError(403, 'USER_NOT_REGISTERED', 'Your account is not registered with any gym.');
  }
  if (users.length > 1) {
    console.error('Multiple Users rows for Firebase UID ' + identity.uid);
    throw new ApiError(403, 'ACCOUNT_CONFLICT', 'Your account needs attention. Contact support.');
  }

  const user = users[0];
  if (user.Status !== USER_STATUS.ACTIVE) {
    throw new ApiError(403, 'USER_INACTIVE', 'Your account is inactive. Contact your gym administrator.');
  }
  if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, user.Role)) {
    console.error('User ' + user.User_ID + ' has invalid role "' + user.Role + '"');
    throw new ApiError(403, 'ACCOUNT_CONFLICT', 'Your account needs attention. Contact support.');
  }

  const isPlatformAdmin = user.Role === USER_ROLES.PLATFORM_ADMIN;
  if (isPlatformAdmin && user.Gym_ID) {
    console.error('PLATFORM_ADMIN ' + user.User_ID + ' must not have a Gym_ID');
    throw new ApiError(403, 'ACCOUNT_CONFLICT', 'Your account needs attention. Contact support.');
  }

  if (!isPlatformAdmin) {
    if (!user.Gym_ID || !gym || gym.Gym_ID !== user.Gym_ID) {
      console.error('User ' + user.User_ID + ' references missing gym ' + user.Gym_ID);
      throw new ApiError(403, 'GYM_NOT_FOUND', 'Your gym could not be found. Contact support.');
    }
    if (gym.Status !== GYM_STATUS.ACTIVE) {
      throw new ApiError(403, 'GYM_INACTIVE', 'Your gym account is not active. Contact your gym owner.');
    }
  }

  return Object.freeze({
    userId: user.User_ID,
    firebaseUid: identity.uid,
    email: user.Email,
    fullName: user.Full_Name,
    role: user.Role,
    gymId: user.Gym_ID || null,
    gym: gym,
    permissions: Object.freeze(getPermissionsForRole_(user.Role)),
    user: user,
  });
}
