/**
 * MembershipService.gs — a member's subscription to a plan (Phase 6).
 * Stored in the gym's own spreadsheet (GYM_SCHEMA.Memberships).
 *
 * Rules:
 *   - Only ACTIVE members can get a membership, and only from an ACTIVE plan.
 *   - End_Date = Start_Date + plan duration − 1 (both days inclusive).
 *   - A member's non-cancelled memberships may not overlap. Renewals start the
 *     day after the current one ends. Checked inside the script lock.
 *   - Plan name and price are snapshots taken at sale time.
 *   - Memberships are never deleted. Cancelling keeps the row (status CANCELLED).
 *   - States UPCOMING / ACTIVE / EXPIRING / EXPIRED are computed from the dates
 *     in the script time zone, so they are always current.
 */

const MEMBERSHIP_LIST_FILTERS_ = ['ACTIVE', 'EXPIRING', 'EXPIRED', 'UPCOMING', 'CANCELLED'];
const MEMBERSHIP_BACKDATE_DAYS_ = 365;
const MEMBERSHIP_FUTURE_DAYS_ = 365;

function getMembershipCreateRules_() {
  return {
    planId: { type: 'ref', required: true },
    startDate: { type: 'date' },
    price: { type: 'number', min: 0, max: PLAN_MAX_PRICE_, decimals: 2 },
    notes: { type: 'string', maxLength: 500 },
    // Phase 7: optionally record the first payment in the same step.
    paymentAmount: { type: 'number', min: 0.01, max: PLAN_MAX_PRICE_, decimals: 2 },
    paymentMethod: { type: 'enum', values: PAYMENT_METHODS },
    paymentReference: { type: 'string', maxLength: 100 },
  };
}

function getMembershipCancelRules_() {
  return { reason: { type: 'string', maxLength: 300 } };
}

function getMembershipListRules_() {
  return {
    state: { type: 'enum', values: MEMBERSHIP_LIST_FILTERS_ },
    search: { type: 'string', maxLength: 100 },
    page: { type: 'number', integer: true, min: 1, max: 100000 },
    pageSize: { type: 'number', integer: true, min: 1, max: 100 },
  };
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

/** Pure: the computed state of a membership on `today`. */
function membershipState_(m, today) {
  if (m.Status === MEMBERSHIP_STATUS.CANCELLED) return 'CANCELLED';
  if (today < m.Start_Date) return 'UPCOMING';
  if (today > m.End_Date) return 'EXPIRED';
  return daysBetweenIso_(today, m.End_Date) < MEMBERSHIP_EXPIRING_DAYS ? 'EXPIRING' : 'ACTIVE';
}

/** Pure: do two inclusive date ranges overlap? */
function rangesOverlap_(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

/**
 * Pure: default start for a new membership — the day after the member's latest
 * running/upcoming membership ends, or today if there is none.
 */
function defaultMembershipStart_(memberships, today) {
  let latestEnd = null;
  memberships.forEach(function (m) {
    if (m.Status === MEMBERSHIP_STATUS.CANCELLED || m.End_Date < today) return;
    if (!latestEnd || m.End_Date > latestEnd) latestEnd = m.End_Date;
  });
  return latestEnd ? addDaysIso_(latestEnd, 1) : today;
}

/**
 * Pure: earliest start on/after `from` where a membership of `duration` days
 * overlaps none of `memberships` (non-cancelled ones only). Jumps past each
 * clash, so chains of back-to-back memberships are handled (found in live
 * testing: the first version suggested a date that clashed with a renewal).
 */
function nextFreeStart_(memberships, from, duration) {
  const active = memberships.filter(function (m) {
    return m.Status !== MEMBERSHIP_STATUS.CANCELLED;
  });
  let start = from;
  for (let guard = 0; guard <= active.length; guard++) {
    const end = addDaysIso_(start, duration - 1);
    const clash = active.filter(function (m) {
      return rangesOverlap_(start, end, m.Start_Date, m.End_Date);
    });
    if (!clash.length) return start;
    // Move past the latest-ending clashing membership.
    let latest = clash[0].End_Date;
    clash.forEach(function (m) {
      if (m.End_Date > latest) latest = m.End_Date;
    });
    start = addDaysIso_(latest, 1);
  }
  return start;
}

const MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Pure: "2026-11-24" → "24 Nov 2026" for user-facing messages. */
function displayDate_(iso) {
  const p = iso.split('-');
  return parseInt(p[2], 10) + ' ' + MONTHS_[parseInt(p[1], 10) - 1] + ' ' + p[0];
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

function readGymMemberships_(gym, db) {
  return findRecords_('Memberships', function (m) {
    return m.Gym_ID === gym.Gym_ID;
  }, db || gymDb_(gym));
}

/** One member's memberships, newest first, plus the current and next one. */
function listMemberMemberships_(gym, memberId) {
  getMember_(gym, memberId); // 404 unless the member belongs to this gym
  const today = todayIso_();
  const db = gymDb_(gym);
  const paid = paidByMembership_(readGymPayments_(gym, db));
  const rows = readGymMemberships_(gym, db).filter(function (m) {
    return m.Member_ID === memberId;
  });
  rows.sort(function (a, b) {
    return a.Start_Date < b.Start_Date ? 1 : a.Start_Date > b.Start_Date ? -1 : 0;
  });
  const items = rows.map(function (m) {
    return toPublicMembership_(m, today, null, paid);
  });
  const current = items.filter(function (m) {
    return m.state === 'ACTIVE' || m.state === 'EXPIRING';
  })[0] || null;
  const upcoming = items.filter(function (m) {
    return m.state === 'UPCOMING';
  });
  return {
    memberships: items,
    current: current,
    next: upcoming.length ? upcoming[upcoming.length - 1] : null, // earliest upcoming (list is newest first)
    suggestedStartDate: defaultMembershipStart_(rows, today),
  };
}

/**
 * Gym-wide list for the Memberships screen.
 *   ACTIVE / EXPIRING / UPCOMING / CANCELLED: memberships in that state.
 *   EXPIRED: "lapsed members" — each ACTIVE member's latest expired membership,
 *            only if they have nothing running or upcoming.
 */
function listMemberships_(gym, query) {
  const q = query || {};
  const page = q.page || 1;
  const pageSize = q.pageSize || 25;
  const today = todayIso_();
  const db = gymDb_(gym);

  const members = {};
  findRecords_('Members', function (m) {
    return m.Gym_ID === gym.Gym_ID;
  }, db).forEach(function (m) {
    members[m.Member_ID] = m;
  });

  const paid = paidByMembership_(readGymPayments_(gym, db));
  const all = readGymMemberships_(gym, db).map(function (m) {
    return { row: m, state: membershipState_(m, today) };
  });

  // Members covered today or in future → not "lapsed".
  const covered = {};
  all.forEach(function (x) {
    if (x.state === 'ACTIVE' || x.state === 'EXPIRING' || x.state === 'UPCOMING') covered[x.row.Member_ID] = true;
  });
  const latestExpired = {};
  all.forEach(function (x) {
    if (x.state !== 'EXPIRED') return;
    const member = members[x.row.Member_ID];
    if (!member || member.Status !== MEMBER_STATUS.ACTIVE || covered[x.row.Member_ID]) return;
    const prev = latestExpired[x.row.Member_ID];
    if (!prev || x.row.End_Date > prev.row.End_Date) latestExpired[x.row.Member_ID] = x;
  });
  const lapsed = Object.keys(latestExpired).map(function (k) {
    return latestExpired[k];
  });

  const counts = { ACTIVE: 0, EXPIRING: 0, EXPIRED: lapsed.length, UPCOMING: 0, CANCELLED: 0 };
  all.forEach(function (x) {
    if (x.state !== 'EXPIRED') counts[x.state]++;
  });

  let selected = q.state === 'EXPIRED' ? lapsed : all.filter(function (x) {
    return q.state ? x.state === q.state : x.state !== 'CANCELLED';
  });

  if (q.search) {
    const needle = q.search.toLowerCase();
    const digits = needle.replace(/[^0-9]/g, '');
    selected = selected.filter(function (x) {
      const m = members[x.row.Member_ID];
      return (
        x.row.Plan_Name.toLowerCase().indexOf(needle) !== -1 ||
        (m && m.Full_Name.toLowerCase().indexOf(needle) !== -1) ||
        (m && digits.length >= 3 && m.Phone.replace(/[^0-9]/g, '').indexOf(digits) !== -1)
      );
    });
  }

  // Most urgent first: soonest end for running ones, soonest start for upcoming,
  // most recent for expired/cancelled.
  selected.sort(function (a, b) {
    const key = function (x) {
      if (x.state === 'UPCOMING') return 'b' + x.row.Start_Date;
      if (x.state === 'ACTIVE' || x.state === 'EXPIRING') return 'a' + x.row.End_Date;
      return 'c' + (99999999 - parseInt(x.row.End_Date.replace(/-/g, ''), 10));
    };
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });

  const start = (page - 1) * pageSize;
  return {
    memberships: selected.slice(start, start + pageSize).map(function (x) {
      return toPublicMembership_(x.row, today, members[x.row.Member_ID] || null, paid);
    }),
    page: page,
    pageSize: pageSize,
    total: selected.length,
    counts: counts,
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

function createMembership_(ctx, gym, memberId, input) {
  assertValidId_(input.planId, 'PLN', 'plan ID');
  if (input.paymentAmount !== undefined && !input.paymentMethod) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', {
      fields: { paymentMethod: 'Choose how the member paid.' },
    });
  }
  const today = todayIso_();

  return withScriptLock_(function () {
    const db = gymDb_(gym);

    const member = findRecordById_('Members', memberId, db);
    if (!member || member.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Member not found.');
    if (member.Status !== MEMBER_STATUS.ACTIVE) {
      throw new ApiError(409, 'MEMBER_INACTIVE', 'Reactivate this member before adding a membership.');
    }

    const plan = findRecordById_('Membership_Plans', input.planId, db);
    if (!plan || plan.Gym_ID !== gym.Gym_ID) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', {
        fields: { planId: 'Plan not found.' },
      });
    }
    if (plan.Status !== PLAN_STATUS.ACTIVE) {
      throw new ApiError(409, 'PLAN_INACTIVE', 'This plan is no longer offered.', {
        fields: { planId: 'This plan is inactive.' },
      });
    }

    const existing = readGymMemberships_(gym, db).filter(function (m) {
      return m.Member_ID === memberId && m.Status !== MEMBERSHIP_STATUS.CANCELLED;
    });
    const startDate = input.startDate || defaultMembershipStart_(existing, today);
    if (startDate < addDaysIso_(today, -MEMBERSHIP_BACKDATE_DAYS_) || startDate > addDaysIso_(today, MEMBERSHIP_FUTURE_DAYS_)) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', {
        fields: { startDate: 'Must be within a year of today.' },
      });
    }
    const endDate = addDaysIso_(startDate, parseInt(plan.Duration_Days, 10) - 1);

    const duration = parseInt(plan.Duration_Days, 10);
    const overlap = existing.filter(function (m) {
      return rangesOverlap_(startDate, endDate, m.Start_Date, m.End_Date);
    })[0];
    if (overlap) {
      throw new ApiError(409, 'MEMBERSHIP_OVERLAP', 'This member already has a membership for these dates.', {
        fields: {
          startDate:
            'Overlaps ' + overlap.Plan_Name + ' (' + displayDate_(overlap.Start_Date) + ' – ' +
            displayDate_(overlap.End_Date) + ').',
        },
        suggestedStartDate: nextFreeStart_(existing, startDate, duration),
      });
    }

    // Validate the optional first payment BEFORE writing anything, so a sale and
    // its payment are saved together or not at all.
    const salePrice = input.price !== undefined ? input.price : parseFloat(plan.Price);
    if (input.paymentAmount !== undefined && toPaise_(input.paymentAmount) > toPaise_(salePrice)) {
      throw new ApiError(409, 'PAYMENT_EXCEEDS_BALANCE', 'The amount is more than the balance due.', {
        fields: { paymentAmount: 'At most ' + formatMoney_(salePrice) + ' is due.' },
        balanceDue: salePrice,
      });
    }

    const membership = createRecordLocked_('Memberships', {
      Gym_ID: gym.Gym_ID,
      Member_ID: memberId,
      Plan_ID: plan.Plan_ID,
      Plan_Name: plan.Plan_Name,
      Start_Date: startDate,
      End_Date: endDate,
      Price: input.price !== undefined ? input.price : plan.Price,
      Status: MEMBERSHIP_STATUS.ACTIVE,
      Notes: input.notes || '',
      Cancel_Reason: '',
      Created_By: ctx.userId,
    }, db);
    logAuditLocked_(ctx.userId, 'MEMBERSHIP_CREATED', 'Memberships', membership.Membership_ID);

    // Phase 7: first payment in the same locked step, so a sale and its payment
    // are saved together (the amount was validated above, before any write).
    if (input.paymentAmount !== undefined) {
      const recorded = recordPaymentLocked_(ctx, gym, db, membership.Membership_ID, {
        amount: input.paymentAmount,
        method: input.paymentMethod,
        reference: input.paymentReference,
        paymentDate: today, // money is received now, even for a membership that starts later
      });
      const out = recorded.membership;
      out.member = toPublicMembership_(membership, today, member).member;
      out.payment = recorded.payment;
      return out;
    }
    const paidNone = {};
    return toPublicMembership_(membership, today, member, paidNone);
  });
}

function cancelMembership_(ctx, gym, membershipId, input) {
  return withScriptLock_(function () {
    const db = gymDb_(gym);
    const existing = findRecordById_('Memberships', membershipId, db);
    if (!existing || existing.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Membership not found.');
    if (existing.Status === MEMBERSHIP_STATUS.CANCELLED) {
      throw new ApiError(409, 'MEMBERSHIP_ALREADY_CANCELLED', 'This membership is already cancelled.');
    }
    const updated = updateRecordLocked_('Memberships', membershipId, {
      Status: MEMBERSHIP_STATUS.CANCELLED,
      Cancel_Reason: input.reason || '',
    }, db);
    logAuditLocked_(ctx.userId, 'MEMBERSHIP_CANCELLED', 'Memberships', membershipId);
    return toPublicMembership_(updated, todayIso_(), null);
  });
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

/** paid (optional): { membershipId: paise } from paidByMembership_ — adds amountPaid / balanceDue. */
function toPublicMembership_(m, today, member, paid) {
  const state = membershipState_(m, today);
  const out = {
    membershipId: m.Membership_ID,
    memberId: m.Member_ID,
    planId: m.Plan_ID,
    planName: m.Plan_Name,
    startDate: m.Start_Date,
    endDate: m.End_Date,
    price: parseFloat(m.Price),
    status: m.Status,
    state: state,
    /** Days left including today (running), days until start (upcoming), else null. */
    daysLeft:
      state === 'ACTIVE' || state === 'EXPIRING'
        ? daysBetweenIso_(today, m.End_Date) + 1
        : state === 'UPCOMING'
          ? daysBetweenIso_(today, m.Start_Date)
          : null,
    notes: m.Notes || null,
    cancelReason: m.Cancel_Reason || null,
    createdAt: m.Created_At,
    updatedAt: m.Updated_At,
  };
  if (paid) {
    const pricePaise = toPaise_(m.Price);
    const paidPaise = paid[m.Membership_ID] || 0;
    out.amountPaid = paidPaise / 100;
    // A cancelled membership owes nothing more (refunds are handled outside the app).
    out.balanceDue = m.Status === MEMBERSHIP_STATUS.CANCELLED ? 0 : Math.max(0, pricePaise - paidPaise) / 100;
  }
  if (member) {
    out.member = { memberId: member.Member_ID, fullName: member.Full_Name, phone: member.Phone, status: member.Status };
  }
  return out;
}
