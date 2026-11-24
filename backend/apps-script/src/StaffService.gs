/**
 * StaffService.gs — a gym's team: admins, trainers and front-desk staff (Phase 9).
 * Staff are rows in the CENTRAL Users tab (Gym_ID = the gym), linked to a
 * Firebase login created by FirebaseAccountService.
 *
 * Rules:
 *   - Only roles in STAFF_ROLES (GYM_ADMIN, TRAINER, STAFF) can be given here.
 *     The GYM_OWNER row is never created, changed or deactivated from the app.
 *   - A GYM_ADMIN manages TRAINER and STAFF only; only the owner (or a platform
 *     admin) may add, change or deactivate admins, or promote someone to admin.
 *   - Nobody may change their own role or status (prevents locking yourself out).
 *   - One login per email across the whole platform.
 *   - Deactivating sets Status=INACTIVE: the very next request is refused
 *     (AuthService checks status on every request). Nothing is deleted.
 */

function getStaffInviteRules_() {
  return {
    fullName: { type: 'string', required: true, minLength: 2, maxLength: 120 },
    email: { type: 'email', required: true, maxLength: 254 },
    role: { type: 'enum', required: true, values: STAFF_ROLES },
  };
}

function getStaffUpdateRules_() {
  return {
    fullName: { type: 'string', required: true, minLength: 2, maxLength: 120 },
    role: { type: 'enum', required: true, values: STAFF_ROLES },
    status: { type: 'enum', required: true, values: Object.values(USER_STATUS) },
  };
}

/** Pure: may `ctx` manage a user who has (or will get) `role`? */
function canManageRole_(ctx, role) {
  if (STAFF_ROLES.indexOf(role) === -1) return false; // owners / members / platform admins: never
  if (ctx.role === USER_ROLES.PLATFORM_ADMIN || ctx.role === USER_ROLES.GYM_OWNER) return true;
  if (ctx.role === USER_ROLES.GYM_ADMIN) return role === USER_ROLES.TRAINER || role === USER_ROLES.STAFF;
  return false;
}

function readGymUsers_(gym) {
  return findRecords_('Users', function (u) {
    return u.Gym_ID === gym.Gym_ID;
  });
}

/** Team list: owner first, then admins, trainers, staff; active before inactive. */
function listStaff_(gym) {
  const order = [USER_ROLES.GYM_OWNER, USER_ROLES.GYM_ADMIN, USER_ROLES.TRAINER, USER_ROLES.STAFF, USER_ROLES.MEMBER];
  const users = readGymUsers_(gym);
  users.sort(function (a, b) {
    if (a.Status !== b.Status) return a.Status === USER_STATUS.ACTIVE ? -1 : 1;
    if (a.Role !== b.Role) return order.indexOf(a.Role) - order.indexOf(b.Role);
    return a.Full_Name.toLowerCase() < b.Full_Name.toLowerCase() ? -1 : 1;
  });
  return { staff: users.map(toPublicStaff_) };
}

/** Active trainers of the gym (minimal fields) — for assigning members. */
function listTrainers_(gym) {
  const trainers = readGymUsers_(gym).filter(function (u) {
    return u.Role === USER_ROLES.TRAINER && u.Status === USER_STATUS.ACTIVE;
  });
  trainers.sort(function (a, b) {
    return a.Full_Name.toLowerCase() < b.Full_Name.toLowerCase() ? -1 : 1;
  });
  return {
    trainers: trainers.map(function (u) {
      return { userId: u.User_ID, fullName: u.Full_Name };
    }),
  };
}

function inviteStaff_(ctx, gym, input) {
  if (!canManageRole_(ctx, input.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the gym owner can add admins.');
  }
  // Cheap pre-check before calling Firebase (re-checked inside the lock).
  assertEmailFree_(input.email);

  const account = createFirebaseAccount_(input.email);
  let user;
  try {
    user = withScriptLock_(function () {
      assertEmailFree_(input.email);
      if (findUsersByFirebaseUid_(account.uid).length) {
        throw new ApiError(409, 'USER_EXISTS', 'This login is already registered.');
      }
      const created = createRecordLocked_('Users', {
        Firebase_UID: account.uid,
        Gym_ID: gym.Gym_ID,
        Email: input.email,
        Full_Name: input.fullName,
        Role: input.role,
        Status: USER_STATUS.ACTIVE,
      });
      logAuditLocked_(ctx.userId, 'STAFF_INVITED', 'Users', created.User_ID);
      return created;
    });
  } catch (e) {
    // Do not leave a login without a Users row behind.
    deleteFirebaseAccount_(account.idToken);
    throw e;
  }

  const emailSent = sendPasswordSetupEmail_(input.email);
  return { staff: toPublicStaff_(user), inviteEmailSent: emailSent };
}

function updateStaff_(ctx, gym, userId, patch) {
  if (Object.keys(patch).length === 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Nothing to update.');

  return withScriptLock_(function () {
    const existing = findRecordById_('Users', userId);
    if (!existing || existing.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Team member not found.');
    if (existing.User_ID === ctx.userId && (has_(patch, 'role') || has_(patch, 'status'))) {
      throw new ApiError(403, 'FORBIDDEN', 'You cannot change your own role or status.');
    }
    // Must be allowed to manage the person as they are now AND in their new role.
    if (!canManageRole_(ctx, existing.Role) || (has_(patch, 'role') && !canManageRole_(ctx, patch.role))) {
      throw new ApiError(403, 'FORBIDDEN', 'You cannot change this team member.');
    }

    const columns = {};
    if (has_(patch, 'fullName')) columns.Full_Name = patch.fullName;
    if (has_(patch, 'role')) columns.Role = patch.role;
    if (has_(patch, 'status')) columns.Status = patch.status;
    const updated = updateRecordLocked_('Users', userId, columns);

    if (updated.Full_Name !== existing.Full_Name || updated.Role !== existing.Role) {
      logAuditLocked_(ctx.userId, 'STAFF_UPDATED', 'Users', userId);
    }
    if (updated.Status !== existing.Status) {
      const action = updated.Status === USER_STATUS.ACTIVE ? 'STAFF_REACTIVATED' : 'STAFF_DEACTIVATED';
      logAuditLocked_(ctx.userId, action, 'Users', userId);
    }
    return { staff: toPublicStaff_(updated) };
  });
}

function resendStaffInvite_(ctx, gym, userId) {
  const user = findRecordById_('Users', userId);
  if (!user || user.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Team member not found.');
  if (!canManageRole_(ctx, user.Role)) throw new ApiError(403, 'FORBIDDEN', 'You cannot change this team member.');
  if (user.Status !== USER_STATUS.ACTIVE) {
    throw new ApiError(409, 'USER_INACTIVE', 'Reactivate this team member first.');
  }
  const sent = sendPasswordSetupEmail_(user.Email);
  if (!sent) throw new ApiError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Could not send the email. Please try again.');
  logAudit_(ctx.userId, 'STAFF_INVITE_RESENT', 'Users', userId);
  return { sent: true };
}

/** One login per email across the platform (any gym, any status). */
function assertEmailFree_(email) {
  const clash = findRecords_('Users', function (u) {
    return u.Email === email;
  });
  if (clash.length) {
    throw new ApiError(409, 'EMAIL_IN_USE', 'This email is already registered.', {
      fields: { email: 'Already used by another account.' },
    });
  }
}

function toPublicStaff_(u) {
  return {
    userId: u.User_ID,
    fullName: u.Full_Name,
    email: u.Email,
    role: u.Role,
    status: u.Status,
    createdAt: u.Created_At,
    updatedAt: u.Updated_At,
  };
}
