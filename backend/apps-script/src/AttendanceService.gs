/**
 * AttendanceService.gs — member check-in / check-out (Phase 8).
 * Stored in the gym's own spreadsheet (GYM_SCHEMA.Attendance).
 *
 * Rules (checked inside the script lock):
 *   - The member must belong to this gym and be ACTIVE.
 *   - One visit per member per gym-local day (VOIDED visits don't count).
 *   - The member needs a membership running today. Without one, staff may still
 *     check them in with `override: true` and a reason, which is stored.
 *   - Money owed never blocks entry; it is returned as a warning.
 *   - Times come from the server clock; the client cannot choose them.
 *   - Visits are never deleted. A mistake is VOIDED with a reason (owner/admin).
 */

const ATTENDANCE_HISTORY_DAYS_ = 90;
const LOOKUP_LIMIT_ = 10;

function getCheckInRules_() {
  return {
    memberId: { type: 'ref', required: true },
    override: { type: 'boolean' },
    overrideReason: { type: 'string', maxLength: 300 },
  };
}

function getAttendanceVoidRules_() {
  return { reason: { type: 'string', required: true, minLength: 3, maxLength: 300 } };
}

function getAttendanceListRules_() {
  return {
    date: { type: 'date' },
    status: { type: 'enum', values: [ATTENDANCE_STATUS.IN, ATTENDANCE_STATUS.OUT] },
    search: { type: 'string', maxLength: 100 },
    includeVoided: { type: 'boolean' },
    page: { type: 'number', integer: true, min: 1, max: 100000 },
    pageSize: { type: 'number', integer: true, min: 1, max: 200 },
  };
}

function getAttendanceLookupRules_() {
  return { query: { type: 'string', required: true, minLength: 2, maxLength: 100 } };
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Pure: the membership covering `today` (running, not cancelled), if any. */
function coveringMembership_(memberships, today) {
  const running = memberships.filter(function (m) {
    const s = membershipState_(m, today);
    return s === 'ACTIVE' || s === 'EXPIRING';
  });
  running.sort(function (a, b) {
    return a.End_Date < b.End_Date ? 1 : -1;
  });
  return running[0] || null;
}

/** Pure: does this member already have a (non-voided) visit on `date`? */
function visitOn_(attendance, memberId, date) {
  return attendance.filter(function (a) {
    return a.Member_ID === memberId && a.Visit_Date === date && a.Status !== ATTENDANCE_STATUS.VOIDED;
  })[0] || null;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

function readGymAttendance_(gym, db) {
  return findRecords_('Attendance', function (a) {
    return a.Gym_ID === gym.Gym_ID;
  }, db || gymDb_(gym));
}

/**
 * Front-desk search: matching members (name, phone digits, member ID) with what
 * staff need to decide — membership covering today, balance due, today's visit.
 */
function lookupForCheckIn_(gym, query) {
  const today = todayIso_();
  const db = gymDb_(gym);
  const needle = query.query.toLowerCase().trim();
  const digits = needle.replace(/[^0-9]/g, '');
  const members = findRecords_('Members', function (m) {
    return (
      m.Gym_ID === gym.Gym_ID &&
      (m.Full_Name.toLowerCase().indexOf(needle) !== -1 ||
        m.Member_ID.toLowerCase() === needle ||
        (digits.length >= 3 && m.Phone.replace(/[^0-9]/g, '').indexOf(digits) !== -1))
    );
  }, db);
  // Active members first, then by name.
  members.sort(function (a, b) {
    if (a.Status !== b.Status) return a.Status === MEMBER_STATUS.ACTIVE ? -1 : 1;
    return a.Full_Name.toLowerCase() < b.Full_Name.toLowerCase() ? -1 : 1;
  });
  const shown = members.slice(0, LOOKUP_LIMIT_);
  const memberships = readGymMemberships_(gym, db);
  const paid = paidByMembership_(readGymPayments_(gym, db));
  const attendance = readGymAttendance_(gym, db);

  return {
    results: shown.map(function (m) {
      const own = memberships.filter(function (x) {
        return x.Member_ID === m.Member_ID && x.Status !== MEMBERSHIP_STATUS.CANCELLED;
      });
      const covering = coveringMembership_(own, today);
      const visit = visitOn_(attendance, m.Member_ID, today);
      let lastEnd = null;
      own.forEach(function (x) {
        if (x.End_Date < today && (!lastEnd || x.End_Date > lastEnd)) lastEnd = x.End_Date;
      });
      return {
        member: toPublicMember_(m),
        membership: covering ? toPublicMembership_(covering, today, null, paid) : null,
        lastMembershipEnd: lastEnd,
        today: visit ? toPublicAttendance_(visit, null) : null,
      };
    }),
    total: members.length,
    date: today,
  };
}

/** One day's visits (default today), check-in order, newest first. */
function listAttendance_(gym, query) {
  const q = query || {};
  const today = todayIso_();
  const date = q.date || today;
  const page = q.page || 1;
  const pageSize = q.pageSize || 50;
  const db = gymDb_(gym);
  const members = readGymMembersById_(gym, db);

  const day = readGymAttendance_(gym, db).filter(function (a) {
    return a.Visit_Date === date;
  });
  const valid = day.filter(function (a) {
    return a.Status !== ATTENDANCE_STATUS.VOIDED;
  });
  const counts = {
    total: valid.length,
    in: valid.filter(function (a) { return a.Status === ATTENDANCE_STATUS.IN; }).length,
    out: valid.filter(function (a) { return a.Status === ATTENDANCE_STATUS.OUT; }).length,
    overrides: valid.filter(function (a) { return Boolean(a.Override_Reason); }).length,
  };

  let rows = q.includeVoided ? day : valid;
  if (q.status) {
    rows = rows.filter(function (a) {
      return a.Status === q.status;
    });
  }
  if (q.search) {
    const needle = q.search.toLowerCase();
    const digits = needle.replace(/[^0-9]/g, '');
    rows = rows.filter(function (a) {
      const m = members[a.Member_ID];
      return (
        m &&
        (m.Full_Name.toLowerCase().indexOf(needle) !== -1 ||
          (digits.length >= 3 && m.Phone.replace(/[^0-9]/g, '').indexOf(digits) !== -1))
      );
    });
  }
  rows.sort(function (a, b) {
    return a.Check_In_At < b.Check_In_At ? 1 : -1;
  });
  const start = (page - 1) * pageSize;
  return {
    attendance: rows.slice(start, start + pageSize).map(function (a) {
      return toPublicAttendance_(a, members[a.Member_ID]);
    }),
    date: date,
    page: page,
    pageSize: pageSize,
    total: rows.length,
    counts: counts,
  };
}

/** A member's recent visits (last 90 days) with simple stats. */
function listMemberAttendance_(gym, memberId) {
  getMember_(gym, memberId); // 404 unless in this gym
  const today = todayIso_();
  const since = addDaysIso_(today, -ATTENDANCE_HISTORY_DAYS_ + 1);
  const visits = readGymAttendance_(gym).filter(function (a) {
    return a.Member_ID === memberId && a.Visit_Date >= since && a.Status !== ATTENDANCE_STATUS.VOIDED;
  });
  visits.sort(function (a, b) {
    return a.Check_In_At < b.Check_In_At ? 1 : -1;
  });
  const last30 = addDaysIso_(today, -29);
  return {
    visits: visits.map(function (a) {
      return toPublicAttendance_(a, null);
    }),
    stats: {
      last30Days: visits.filter(function (a) { return a.Visit_Date >= last30; }).length,
      last90Days: visits.length,
      lastVisit: visits.length ? visits[0].Visit_Date : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

function checkIn_(ctx, gym, input) {
  assertValidId_(input.memberId, 'MEM', 'member ID');
  if (input.override && !(input.overrideReason && input.overrideReason.trim().length >= 3)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', {
      fields: { overrideReason: 'Say why they may enter without a membership (at least 3 characters).' },
    });
  }

  return withScriptLock_(function () {
    const db = gymDb_(gym);
    const today = todayIso_();
    const member = findRecordById_('Members', input.memberId, db);
    if (!member || member.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Member not found.');
    if (member.Status !== MEMBER_STATUS.ACTIVE) {
      throw new ApiError(409, 'MEMBER_INACTIVE', 'This member is inactive. Reactivate them first.');
    }

    const attendance = readGymAttendance_(gym, db);
    const existing = visitOn_(attendance, member.Member_ID, today);
    if (existing) {
      throw new ApiError(409, 'ALREADY_CHECKED_IN', member.Full_Name + ' has already checked in today.', {
        attendance: toPublicAttendance_(existing, null),
      });
    }

    const own = readGymMemberships_(gym, db).filter(function (m) {
      return m.Member_ID === member.Member_ID && m.Status !== MEMBERSHIP_STATUS.CANCELLED;
    });
    const covering = coveringMembership_(own, today);
    if (!covering && !input.override) {
      throw new ApiError(409, 'NO_ACTIVE_MEMBERSHIP', member.Full_Name + ' has no membership running today.', {
        canOverride: true,
      });
    }

    const visit = createRecordLocked_('Attendance', {
      Gym_ID: gym.Gym_ID,
      Member_ID: member.Member_ID,
      Membership_ID: covering ? covering.Membership_ID : '',
      Visit_Date: today,
      Check_In_At: nowIso_(),
      Check_Out_At: '',
      Status: ATTENDANCE_STATUS.IN,
      // An override is only recorded when it was actually needed.
      Override_Reason: covering ? '' : input.overrideReason.trim(),
      Void_Reason: '',
      Created_By: ctx.userId,
    }, db);
    logAuditLocked_(ctx.userId, covering ? 'CHECKED_IN' : 'CHECKED_IN_OVERRIDE', 'Attendance', visit.Attendance_ID);

    const warnings = [];
    let membershipOut = null;
    if (covering) {
      const paid = paidByMembership_(readGymPayments_(gym, db));
      membershipOut = toPublicMembership_(covering, today, null, paid);
      if (membershipOut.balanceDue > 0) warnings.push('BALANCE_DUE');
      if (membershipOut.state === 'EXPIRING') warnings.push('EXPIRING_SOON');
    } else {
      warnings.push('NO_ACTIVE_MEMBERSHIP');
    }
    return {
      attendance: toPublicAttendance_(visit, member),
      membership: membershipOut,
      warnings: warnings,
    };
  });
}

function checkOut_(ctx, gym, attendanceId) {
  return withScriptLock_(function () {
    const db = gymDb_(gym);
    const visit = findRecordById_('Attendance', attendanceId, db);
    if (!visit || visit.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Visit not found.');
    if (visit.Status !== ATTENDANCE_STATUS.IN) {
      throw new ApiError(409, 'NOT_CHECKED_IN', 'This visit is already checked out or voided.');
    }
    const updated = updateRecordLocked_('Attendance', attendanceId, {
      Status: ATTENDANCE_STATUS.OUT,
      Check_Out_At: nowIso_(),
    }, db);
    logAuditLocked_(ctx.userId, 'CHECKED_OUT', 'Attendance', attendanceId);
    return { attendance: toPublicAttendance_(updated, findRecordById_('Members', updated.Member_ID, db)) };
  });
}

function voidAttendance_(ctx, gym, attendanceId, input) {
  return withScriptLock_(function () {
    const db = gymDb_(gym);
    const visit = findRecordById_('Attendance', attendanceId, db);
    if (!visit || visit.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Visit not found.');
    if (visit.Status === ATTENDANCE_STATUS.VOIDED) {
      throw new ApiError(409, 'ATTENDANCE_ALREADY_VOIDED', 'This visit is already voided.');
    }
    const updated = updateRecordLocked_('Attendance', attendanceId, {
      Status: ATTENDANCE_STATUS.VOIDED,
      Void_Reason: input.reason,
    }, db);
    logAuditLocked_(ctx.userId, 'ATTENDANCE_VOIDED', 'Attendance', attendanceId);
    return { attendance: toPublicAttendance_(updated, findRecordById_('Members', updated.Member_ID, db)) };
  });
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function toPublicAttendance_(a, member) {
  const out = {
    attendanceId: a.Attendance_ID,
    memberId: a.Member_ID,
    membershipId: a.Membership_ID || null,
    visitDate: a.Visit_Date,
    checkInAt: a.Check_In_At,
    checkOutAt: a.Check_Out_At || null,
    status: a.Status,
    overrideReason: a.Override_Reason || null,
    voidReason: a.Void_Reason || null,
  };
  if (member) out.member = { memberId: member.Member_ID, fullName: member.Full_Name, phone: member.Phone };
  return out;
}
