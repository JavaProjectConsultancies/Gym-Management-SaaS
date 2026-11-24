/**
 * PaymentService.gs — money received against memberships (Phase 7).
 * Stored in the gym's own spreadsheet (GYM_SCHEMA.Payments).
 *
 * Rules (all checked inside the script lock):
 *   - A payment belongs to one membership of this gym that is not cancelled.
 *   - Amount > 0 and ≤ the membership's balance due (price snapshot − recorded payments).
 *   - Payment date: today or up to a year back; never in the future.
 *   - Receipt numbers are sequential per gym: R-000001, R-000002, …
 *   - Payments are never edited or deleted. A mistake is VOIDED with a reason
 *     (owner/admin only), which gives the amount back to the balance due.
 */

const PAYMENT_BACKDATE_DAYS_ = 365;
const RECEIPT_PATTERN_ = /^R-([0-9]{6,})$/;

function getPaymentRules_() {
  return {
    amount: { type: 'number', required: true, min: 0.01, max: PLAN_MAX_PRICE_, decimals: 2 },
    method: { type: 'enum', required: true, values: PAYMENT_METHODS },
    paymentDate: { type: 'date' },
    reference: { type: 'string', maxLength: 100 },
    notes: { type: 'string', maxLength: 300 },
  };
}

function getPaymentVoidRules_() {
  return { reason: { type: 'string', required: true, minLength: 3, maxLength: 300 } };
}

function getPaymentListRules_() {
  return {
    from: { type: 'date' },
    to: { type: 'date' },
    method: { type: 'enum', values: PAYMENT_METHODS },
    search: { type: 'string', maxLength: 100 },
    includeVoided: { type: 'boolean' },
    page: { type: 'number', integer: true, min: 1, max: 100000 },
    pageSize: { type: 'number', integer: true, min: 1, max: 100 },
  };
}

function getDuesListRules_() {
  return {
    search: { type: 'string', maxLength: 100 },
    page: { type: 'number', integer: true, min: 1, max: 100000 },
    pageSize: { type: 'number', integer: true, min: 1, max: 100 },
  };
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Money arithmetic in paise (integers) to avoid floating-point drift. */
function toPaise_(amount) {
  return Math.round(parseFloat(amount) * 100);
}

/** Pure: { membershipId: paidPaise } from RECORDED payments. */
function paidByMembership_(payments) {
  const out = {};
  payments.forEach(function (p) {
    if (p.Status !== PAYMENT_STATUS.RECORDED) return;
    out[p.Membership_ID] = (out[p.Membership_ID] || 0) + toPaise_(p.Amount);
  });
  return out;
}

/** Pure: next receipt number after the highest existing one ("R-000001" first). */
function nextReceiptNo_(payments) {
  let max = 0;
  payments.forEach(function (p) {
    const m = RECEIPT_PATTERN_.exec(p.Receipt_No || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  const n = String(max + 1);
  return 'R-' + (n.length < 6 ? new Array(7 - n.length).join('0') + n : n);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

function readGymPayments_(gym, db) {
  return findRecords_('Payments', function (p) {
    return p.Gym_ID === gym.Gym_ID;
  }, db || gymDb_(gym));
}

function readGymMembersById_(gym, db) {
  const map = {};
  findRecords_('Members', function (m) {
    return m.Gym_ID === gym.Gym_ID;
  }, db).forEach(function (m) {
    map[m.Member_ID] = m;
  });
  return map;
}

/**
 * Payments by date range (default: this month), newest first, with totals of
 * RECORDED payments in the range (voided ones are listed only on request).
 */
function listPayments_(gym, query) {
  const q = query || {};
  const today = todayIso_();
  const from = q.from || today.slice(0, 8) + '01';
  const to = q.to || today;
  if (from > to) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', {
      fields: { from: 'Must be on or before the end date.' },
    });
  }
  const page = q.page || 1;
  const pageSize = q.pageSize || 25;
  const db = gymDb_(gym);
  const members = readGymMembersById_(gym, db);
  const memberships = {};
  readGymMemberships_(gym, db).forEach(function (m) {
    memberships[m.Membership_ID] = m;
  });

  let rows = readGymPayments_(gym, db).filter(function (p) {
    return p.Payment_Date >= from && p.Payment_Date <= to && (!q.method || p.Method === q.method);
  });
  if (q.search) {
    const needle = q.search.toLowerCase();
    const digits = needle.replace(/[^0-9]/g, '');
    rows = rows.filter(function (p) {
      const m = members[p.Member_ID];
      return (
        p.Receipt_No.toLowerCase() === needle ||
        (p.Reference && p.Reference.toLowerCase().indexOf(needle) !== -1) ||
        (m && m.Full_Name.toLowerCase().indexOf(needle) !== -1) ||
        (m && digits.length >= 3 && m.Phone.replace(/[^0-9]/g, '').indexOf(digits) !== -1)
      );
    });
  }

  const recorded = rows.filter(function (p) {
    return p.Status === PAYMENT_STATUS.RECORDED;
  });
  const byMethod = {};
  PAYMENT_METHODS.forEach(function (m) {
    byMethod[m] = 0;
  });
  let totalPaise = 0;
  recorded.forEach(function (p) {
    const paise = toPaise_(p.Amount);
    totalPaise += paise;
    byMethod[p.Method] += paise;
  });
  Object.keys(byMethod).forEach(function (k) {
    byMethod[k] = byMethod[k] / 100;
  });

  const listed = q.includeVoided ? rows : recorded;
  listed.sort(function (a, b) {
    if (a.Payment_Date !== b.Payment_Date) return a.Payment_Date < b.Payment_Date ? 1 : -1;
    return a.Receipt_No < b.Receipt_No ? 1 : -1;
  });
  const start = (page - 1) * pageSize;
  return {
    payments: listed.slice(start, start + pageSize).map(function (p) {
      return toPublicPayment_(p, members[p.Member_ID], memberships[p.Membership_ID]);
    }),
    from: from,
    to: to,
    page: page,
    pageSize: pageSize,
    total: listed.length,
    totals: { count: recorded.length, amount: totalPaise / 100, byMethod: byMethod },
  };
}

/** One member's payments, newest first (404 unless the member is in this gym). */
function listMemberPayments_(gym, memberId) {
  const member = getMember_(gym, memberId);
  const db = gymDb_(gym);
  const memberships = {};
  readGymMemberships_(gym, db).forEach(function (m) {
    memberships[m.Membership_ID] = m;
  });
  const rows = readGymPayments_(gym, db).filter(function (p) {
    return p.Member_ID === memberId;
  });
  rows.sort(function (a, b) {
    return a.Receipt_No < b.Receipt_No ? 1 : -1;
  });
  return {
    payments: rows.map(function (p) {
      return toPublicPayment_(p, member, memberships[p.Membership_ID]);
    }),
  };
}

/** A single payment with member, membership and gym name, for the receipt. */
function getPaymentReceipt_(gym, paymentId) {
  const db = gymDb_(gym);
  const p = findRecordById_('Payments', paymentId, db);
  if (!p || p.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Payment not found.');
  const member = findRecordById_('Members', p.Member_ID, db);
  const membership = findRecordById_('Memberships', p.Membership_ID, db);
  const paid = paidByMembership_(readGymPayments_(gym, db))[p.Membership_ID] || 0;
  const out = toPublicPayment_(p, member, membership);
  out.gymName = gym.Gym_Name;
  if (membership) out.membership.balanceDue = Math.max(0, toPaise_(membership.Price) - paid) / 100;
  return { payment: out };
}

/**
 * Memberships with money still owed (not cancelled, balance > 0), oldest
 * first, with each member and the total outstanding.
 */
function listDues_(gym, query) {
  const q = query || {};
  const page = q.page || 1;
  const pageSize = q.pageSize || 25;
  const today = todayIso_();
  const db = gymDb_(gym);
  const members = readGymMembersById_(gym, db);
  const paid = paidByMembership_(readGymPayments_(gym, db));

  let dues = readGymMemberships_(gym, db)
    .filter(function (m) {
      return m.Status !== MEMBERSHIP_STATUS.CANCELLED && toPaise_(m.Price) > (paid[m.Membership_ID] || 0);
    })
    .map(function (m) {
      return toPublicMembership_(m, today, members[m.Member_ID] || null, paid);
    });
  if (q.search) {
    const needle = q.search.toLowerCase();
    const digits = needle.replace(/[^0-9]/g, '');
    dues = dues.filter(function (d) {
      return (
        (d.member && d.member.fullName.toLowerCase().indexOf(needle) !== -1) ||
        (d.member && digits.length >= 3 && d.member.phone.replace(/[^0-9]/g, '').indexOf(digits) !== -1) ||
        d.planName.toLowerCase().indexOf(needle) !== -1
      );
    });
  }
  dues.sort(function (a, b) {
    return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
  });
  let totalPaise = 0;
  dues.forEach(function (d) {
    totalPaise += Math.round(d.balanceDue * 100);
  });
  const start = (page - 1) * pageSize;
  return {
    dues: dues.slice(start, start + pageSize),
    page: page,
    pageSize: pageSize,
    total: dues.length,
    totalDue: totalPaise / 100,
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Record a payment. Inside the lock when called from createMembership_
 * (`db` given); otherwise acquires the lock itself.
 */
function recordPayment_(ctx, gym, membershipId, input) {
  return withScriptLock_(function () {
    const db = gymDb_(gym);
    const result = recordPaymentLocked_(ctx, gym, db, membershipId, input);
    return result;
  });
}

function recordPaymentLocked_(ctx, gym, db, membershipId, input) {
  const today = todayIso_();
  const membership = findRecordById_('Memberships', membershipId, db);
  if (!membership || membership.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Membership not found.');
  if (membership.Status === MEMBERSHIP_STATUS.CANCELLED) {
    throw new ApiError(409, 'MEMBERSHIP_CANCELLED', 'This membership is cancelled; payments cannot be added.');
  }

  const paymentDate = input.paymentDate || today;
  if (paymentDate > today || paymentDate < addDaysIso_(today, -PAYMENT_BACKDATE_DAYS_)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', {
      fields: { paymentDate: 'Must be today or within the last year.' },
    });
  }

  const payments = readGymPayments_(gym, db);
  const paidPaise = paidByMembership_(payments)[membershipId] || 0;
  const balancePaise = toPaise_(membership.Price) - paidPaise;
  const amountPaise = toPaise_(input.amount);
  if (amountPaise > balancePaise) {
    throw new ApiError(409, 'PAYMENT_EXCEEDS_BALANCE', 'The amount is more than the balance due.', {
      fields: { amount: balancePaise > 0 ? 'At most ' + formatMoney_(balancePaise / 100) + ' is due.' : 'Nothing is due.' },
      balanceDue: Math.max(0, balancePaise) / 100,
    });
  }

  const payment = createRecordLocked_('Payments', {
    Gym_ID: gym.Gym_ID,
    Member_ID: membership.Member_ID,
    Membership_ID: membershipId,
    Receipt_No: nextReceiptNo_(payments),
    Amount: input.amount,
    Method: input.method,
    Payment_Date: paymentDate,
    Reference: input.reference || '',
    Notes: input.notes || '',
    Status: PAYMENT_STATUS.RECORDED,
    Void_Reason: '',
    Created_By: ctx.userId,
  }, db);
  logAuditLocked_(ctx.userId, 'PAYMENT_RECORDED', 'Payments', payment.Payment_ID);

  const member = findRecordById_('Members', membership.Member_ID, db);
  const paidAfter = {};
  paidAfter[membershipId] = paidPaise + amountPaise;
  return {
    payment: toPublicPayment_(payment, member, membership),
    membership: toPublicMembership_(membership, today, null, paidAfter),
  };
}

function voidPayment_(ctx, gym, paymentId, input) {
  return withScriptLock_(function () {
    const db = gymDb_(gym);
    const existing = findRecordById_('Payments', paymentId, db);
    if (!existing || existing.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Payment not found.');
    if (existing.Status === PAYMENT_STATUS.VOIDED) {
      throw new ApiError(409, 'PAYMENT_ALREADY_VOIDED', 'This payment is already voided.');
    }
    const updated = updateRecordLocked_('Payments', paymentId, {
      Status: PAYMENT_STATUS.VOIDED,
      Void_Reason: input.reason,
    }, db);
    logAuditLocked_(ctx.userId, 'PAYMENT_VOIDED', 'Payments', paymentId);
    const member = findRecordById_('Members', updated.Member_ID, db);
    const membership = findRecordById_('Memberships', updated.Membership_ID, db);
    return { payment: toPublicPayment_(updated, member, membership) };
  });
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function toPublicPayment_(p, member, membership) {
  const out = {
    paymentId: p.Payment_ID,
    receiptNo: p.Receipt_No,
    memberId: p.Member_ID,
    membershipId: p.Membership_ID,
    amount: parseFloat(p.Amount),
    method: p.Method,
    paymentDate: p.Payment_Date,
    reference: p.Reference || null,
    notes: p.Notes || null,
    status: p.Status,
    voidReason: p.Void_Reason || null,
    createdAt: p.Created_At,
    updatedAt: p.Updated_At,
  };
  if (member) out.member = { memberId: member.Member_ID, fullName: member.Full_Name, phone: member.Phone };
  if (membership) {
    out.membership = {
      membershipId: membership.Membership_ID,
      planName: membership.Plan_Name,
      startDate: membership.Start_Date,
      endDate: membership.End_Date,
      price: parseFloat(membership.Price),
    };
  }
  return out;
}
