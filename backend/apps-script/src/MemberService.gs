/**
 * MemberService.gs — gym members (Phase 5). Stored in each gym's own
 * spreadsheet (GYM_SCHEMA.Members).
 *
 * Callers must already have passed authentication, the permission check and
 * requireGymAccess_ (Router.gs). Every read here ALSO filters on Gym_ID.
 *
 * Members are never hard-deleted: deactivate them (status INACTIVE) so payment,
 * membership and attendance history stays intact.
 */

/** API field → sheet column. Only these fields can be written by clients. */
const MEMBER_FIELDS_ = Object.freeze({
  fullName: 'Full_Name',
  phone: 'Phone',
  email: 'Email',
  gender: 'Gender',
  dateOfBirth: 'Date_Of_Birth',
  address: 'Address',
  emergencyContactName: 'Emergency_Contact_Name',
  emergencyContactPhone: 'Emergency_Contact_Phone',
  joinDate: 'Join_Date',
  notes: 'Notes',
  status: 'Status',
  trainerId: 'Trainer_ID',
});

const MEMBER_PAGE_SIZE_DEFAULT_ = 25;
const MEMBER_PAGE_SIZE_MAX_ = 100;

/**
 * Body rules for create (status not accepted: new members are ACTIVE) and
 * update (partial; status allowed). Built lazily — see Router.gs on file order.
 */
function getMemberRules_(forUpdate) {
  const rules = {
    fullName: { type: 'string', required: true, minLength: 2, maxLength: 120 },
    phone: { type: 'phone', required: true },
    email: { type: 'email', maxLength: 254 },
    gender: { type: 'enum', values: GENDERS },
    dateOfBirth: { type: 'date' },
    address: { type: 'string', maxLength: 300 },
    emergencyContactName: { type: 'string', maxLength: 120 },
    emergencyContactPhone: { type: 'phone' },
    joinDate: { type: 'date' },
    notes: { type: 'string', maxLength: 1000 },
    trainerId: { type: 'ref' }, // Phase 9: User_ID of an active trainer of this gym
  };
  if (forUpdate) {
    rules.joinDate = { type: 'date', required: true };
    rules.status = { type: 'enum', required: true, values: Object.values(MEMBER_STATUS) };
  }
  return rules;
}

function getMemberListRules_() {
  return {
    search: { type: 'string', maxLength: 100 },
    status: { type: 'enum', values: Object.values(MEMBER_STATUS) },
    page: { type: 'number', integer: true, min: 1, max: 100000 },
    pageSize: { type: 'number', integer: true, min: 1, max: MEMBER_PAGE_SIZE_MAX_ },
    trainerId: { type: 'ref' }, // Phase 9: only members of this trainer ("My members")
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** All members of one gym (Gym_ID filter is mandatory). */
function readGymMembers_(gym) {
  return findRecords_('Members', function (m) {
    return m.Gym_ID === gym.Gym_ID;
  }, gymDb_(gym));
}

/** Search, filter and paginate. Newest members first. */
function listMembers_(gym, query) {
  const q = query || {};
  const page = q.page || 1;
  const pageSize = q.pageSize || MEMBER_PAGE_SIZE_DEFAULT_;
  const needle = q.search ? q.search.toLowerCase() : '';
  const digits = needle.replace(/[^0-9]/g, '');

  const all = readGymMembers_(gym);
  const matches = all.filter(function (m) {
    if (q.status && m.Status !== q.status) return false;
    if (q.trainerId && m.Trainer_ID !== q.trainerId) return false;
    if (!needle) return true;
    return (
      m.Full_Name.toLowerCase().indexOf(needle) !== -1 ||
      m.Email.indexOf(needle) !== -1 ||
      m.Member_ID.toLowerCase() === needle ||
      (digits.length >= 3 && m.Phone.replace(/[^0-9]/g, '').indexOf(digits) !== -1)
    );
  });
  matches.sort(function (a, b) {
    return a.Created_At < b.Created_At ? 1 : a.Created_At > b.Created_At ? -1 : 0;
  });

  const start = (page - 1) * pageSize;
  const trainers = trainerNames_(gym); // read the Users tab once
  return {
    members: matches.slice(start, start + pageSize).map(function (m) {
      return toPublicMember_(m, trainers);
    }),
    page: page,
    pageSize: pageSize,
    total: matches.length,
    counts: {
      all: all.length,
      active: all.filter(function (m) { return m.Status === MEMBER_STATUS.ACTIVE; }).length,
      inactive: all.filter(function (m) { return m.Status === MEMBER_STATUS.INACTIVE; }).length,
    },
  };
}

/** One member of this gym, or 404 (also when it belongs to another gym). */
function getMember_(gym, memberId) {
  const member = findRecordById_('Members', memberId, gymDb_(gym));
  if (!member || member.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Member not found.');
  return member;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

function createMember_(ctx, gym, input) {
  const today = todayIso_();
  const joinDate = input.joinDate || today;
  assertMemberDates_(input.dateOfBirth, joinDate, today);

  return withScriptLock_(function () {
    const db = gymDb_(gym);
    assertPhoneAvailable_(db, gym, input.phone, null);
    if (input.trainerId) assertTrainer_(gym, input.trainerId);

    const row = toMemberColumns_(input);
    row.Gym_ID = gym.Gym_ID; // from the server-side gym, never from the client
    row.Join_Date = joinDate;
    row.Status = MEMBER_STATUS.ACTIVE;
    row.Created_By = ctx.userId;

    const member = createRecordLocked_('Members', row, db);
    logAuditLocked_(ctx.userId, 'MEMBER_CREATED', 'Members', member.Member_ID);
    return member;
  });
}

function updateMember_(ctx, gym, memberId, patch) {
  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Nothing to update.');
  }

  return withScriptLock_(function () {
    const db = gymDb_(gym);
    const existing = findRecordById_('Members', memberId, db); // fresh read inside the lock
    if (!existing || existing.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Member not found.');

    const columns = toMemberColumns_(patch);
    const dateOfBirth = has_(columns, 'Date_Of_Birth') ? columns.Date_Of_Birth : existing.Date_Of_Birth;
    const joinDate = has_(columns, 'Join_Date') ? columns.Join_Date : existing.Join_Date;
    assertMemberDates_(dateOfBirth, joinDate, todayIso_());
    if (has_(columns, 'Trainer_ID') && columns.Trainer_ID && columns.Trainer_ID !== existing.Trainer_ID) {
      assertTrainer_(gym, columns.Trainer_ID);
    }
    if (has_(columns, 'Phone') && columns.Phone !== existing.Phone) {
      assertPhoneAvailable_(db, gym, columns.Phone, memberId);
    }

    const updated = updateRecordLocked_('Members', memberId, columns, db);

    const statusChanged = updated.Status !== existing.Status;
    const otherChanges = Object.keys(columns).some(function (c) {
      return c !== 'Status' && updated[c] !== existing[c];
    });
    if (otherChanges) logAuditLocked_(ctx.userId, 'MEMBER_UPDATED', 'Members', memberId);
    if ((updated.Trainer_ID || '') !== (existing.Trainer_ID || '')) {
      logAuditLocked_(ctx.userId, 'MEMBER_TRAINER_ASSIGNED', 'Members', memberId);
    }
    if (statusChanged) {
      const action = updated.Status === MEMBER_STATUS.ACTIVE ? 'MEMBER_REACTIVATED' : 'MEMBER_DEACTIVATED';
      logAuditLocked_(ctx.userId, action, 'Members', memberId);
    }
    return updated;
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** One phone number per member within a gym (any status). Inside the lock. */
function assertPhoneAvailable_(db, gym, phone, exceptMemberId) {
  const clash = findRecords_('Members', function (m) {
    return m.Gym_ID === gym.Gym_ID && m.Member_ID !== exceptMemberId && phonesMatch_(m.Phone, phone);
  }, db);
  if (clash.length) {
    throw new ApiError(409, 'MEMBER_PHONE_EXISTS', 'Another member already uses this phone number.', {
      fields: { phone: 'Already used by member ' + clash[0].Full_Name + '.' },
      memberId: clash[0].Member_ID,
    });
  }
}

/**
 * Same subscriber number, written with or without a country code or trunk "0":
 * "+919000000001", "919000000001", "09000000001" and "9000000001" all match.
 * Rule: compare digits without leading zeros; equal, or the longer one is the
 * shorter (≥ 8 digits) prefixed by a 1–3 digit country code.
 */
function phonesMatch_(a, b) {
  const da = String(a || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
  const db = String(b || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
  if (!da || !db) return false;
  if (da === db) return true;
  const longer = da.length > db.length ? da : db;
  const shorter = da.length > db.length ? db : da;
  return shorter.length >= 8 && longer.length - shorter.length <= 3 && longer.slice(-shorter.length) === shorter;
}

/** Business rules on dates (formats are already validated). */
function assertMemberDates_(dateOfBirth, joinDate, today) {
  const errors = {};
  if (dateOfBirth && dateOfBirth > today) errors.dateOfBirth = 'Cannot be in the future.';
  if (joinDate && joinDate > addDaysIso_(today, 365)) errors.joinDate = 'Cannot be more than a year ahead.';
  if (joinDate && joinDate < '1990-01-01') errors.joinDate = 'Is too far in the past.';
  if (dateOfBirth && joinDate && dateOfBirth > joinDate) errors.dateOfBirth = 'Must be before the join date.';
  if (Object.keys(errors).length) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', { fields: errors });
  }
}

function toMemberColumns_(input) {
  const out = {};
  Object.keys(input).forEach(function (field) {
    if (has_(MEMBER_FIELDS_, field)) out[MEMBER_FIELDS_[field]] = input[field];
  });
  return out;
}

function has_(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Fields returned to clients. Gym_ID / internal columns are not exposed. */
/** Pure-ish: { userId: fullName } for this gym's trainers (any status), for display. */
function trainerNames_(gym) {
  const map = {};
  readGymUsers_(gym).forEach(function (u) {
    if (u.Role === USER_ROLES.TRAINER) map[u.User_ID] = u.Full_Name;
  });
  return map;
}

/** The trainer must be an ACTIVE TRAINER of this gym (central Users tab). */
function assertTrainer_(gym, userId) {
  const u = findRecordById_('Users', userId);
  if (!u || u.Gym_ID !== gym.Gym_ID || u.Role !== USER_ROLES.TRAINER || u.Status !== USER_STATUS.ACTIVE) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', {
      fields: { trainerId: 'Choose an active trainer of this gym.' },
    });
  }
}

/** trainers (optional): { userId: fullName } from trainerNames_, adds the trainer's name. */
function toPublicMember_(m, trainers) {
  return {
    memberId: m.Member_ID,
    fullName: m.Full_Name,
    phone: m.Phone,
    email: m.Email || null,
    gender: m.Gender || null,
    dateOfBirth: m.Date_Of_Birth || null,
    address: m.Address || null,
    emergencyContactName: m.Emergency_Contact_Name || null,
    emergencyContactPhone: m.Emergency_Contact_Phone || null,
    joinDate: m.Join_Date,
    status: m.Status,
    notes: m.Notes || null,
    createdAt: m.Created_At,
    updatedAt: m.Updated_At,
    trainerId: m.Trainer_ID || null,
    trainerName: m.Trainer_ID && trainers ? trainers[m.Trainer_ID] || null : null,
  };
}
