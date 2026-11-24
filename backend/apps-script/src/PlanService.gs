/**
 * PlanService.gs — membership plans a gym sells (Phase 6). Stored in the gym's
 * own spreadsheet (GYM_SCHEMA.Membership_Plans). Every read filters on Gym_ID.
 *
 * Plans are never deleted: deactivate them so existing memberships keep a valid
 * Plan_ID. Changing a plan's price or duration only affects memberships sold
 * afterwards (memberships store a snapshot).
 */

const PLAN_FIELDS_ = Object.freeze({
  name: 'Plan_Name',
  durationDays: 'Duration_Days',
  price: 'Price',
  description: 'Description',
  status: 'Status',
});

const PLAN_MAX_PRICE_ = 10000000;
const PLAN_MAX_DAYS_ = 3650;

function getPlanRules_(forUpdate) {
  const rules = {
    name: { type: 'string', required: true, minLength: 2, maxLength: 80 },
    durationDays: { type: 'number', required: true, integer: true, min: 1, max: PLAN_MAX_DAYS_ },
    price: { type: 'number', required: true, min: 0, max: PLAN_MAX_PRICE_, decimals: 2 },
    description: { type: 'string', maxLength: 500 },
  };
  if (forUpdate) rules.status = { type: 'enum', required: true, values: Object.values(PLAN_STATUS) };
  return rules;
}

function getPlanListRules_() {
  return { status: { type: 'enum', values: Object.values(PLAN_STATUS) } };
}

function readGymPlans_(gym) {
  return findRecords_('Membership_Plans', function (p) {
    return p.Gym_ID === gym.Gym_ID;
  }, gymDb_(gym));
}

/** Active plans first, then by name. */
function listPlans_(gym, query) {
  const status = query && query.status;
  const plans = readGymPlans_(gym).filter(function (p) {
    return !status || p.Status === status;
  });
  plans.sort(function (a, b) {
    if (a.Status !== b.Status) return a.Status === PLAN_STATUS.ACTIVE ? -1 : 1;
    return a.Plan_Name.toLowerCase() < b.Plan_Name.toLowerCase() ? -1 : 1;
  });
  return { plans: plans.map(toPublicPlan_) };
}

/** A plan of this gym, or 404. Pass `db` when already inside the lock. */
function getPlanRecord_(gym, planId, db) {
  const plan = findRecordById_('Membership_Plans', planId, db || gymDb_(gym));
  if (!plan || plan.Gym_ID !== gym.Gym_ID) throw new ApiError(404, 'NOT_FOUND', 'Plan not found.');
  return plan;
}

function createPlan_(ctx, gym, input) {
  return withScriptLock_(function () {
    const db = gymDb_(gym);
    assertPlanNameAvailable_(db, gym, input.name, null);
    const plan = createRecordLocked_('Membership_Plans', {
      Gym_ID: gym.Gym_ID,
      Plan_Name: input.name,
      Duration_Days: input.durationDays,
      Price: input.price,
      Description: input.description || '',
      Status: PLAN_STATUS.ACTIVE,
      Created_By: ctx.userId,
    }, db);
    logAuditLocked_(ctx.userId, 'PLAN_CREATED', 'Membership_Plans', plan.Plan_ID);
    return plan;
  });
}

function updatePlan_(ctx, gym, planId, patch) {
  if (Object.keys(patch).length === 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Nothing to update.');

  return withScriptLock_(function () {
    const db = gymDb_(gym);
    const existing = getPlanRecord_(gym, planId, db);
    const columns = {};
    Object.keys(patch).forEach(function (field) {
      if (has_(PLAN_FIELDS_, field)) columns[PLAN_FIELDS_[field]] = patch[field];
    });
    if (has_(columns, 'Plan_Name') && columns.Plan_Name.toLowerCase() !== existing.Plan_Name.toLowerCase()) {
      assertPlanNameAvailable_(db, gym, columns.Plan_Name, planId);
    }

    const updated = updateRecordLocked_('Membership_Plans', planId, columns, db);
    const statusChanged = updated.Status !== existing.Status;
    const otherChanges = Object.keys(columns).some(function (c) {
      return c !== 'Status' && updated[c] !== existing[c];
    });
    if (otherChanges) logAuditLocked_(ctx.userId, 'PLAN_UPDATED', 'Membership_Plans', planId);
    if (statusChanged) {
      const action = updated.Status === PLAN_STATUS.ACTIVE ? 'PLAN_REACTIVATED' : 'PLAN_DEACTIVATED';
      logAuditLocked_(ctx.userId, action, 'Membership_Plans', planId);
    }
    return updated;
  });
}

/** Plan names are unique per gym, ignoring case (any status). Inside the lock. */
function assertPlanNameAvailable_(db, gym, name, exceptPlanId) {
  const wanted = String(name).trim().toLowerCase();
  const clash = findRecords_('Membership_Plans', function (p) {
    return p.Gym_ID === gym.Gym_ID && p.Plan_ID !== exceptPlanId && p.Plan_Name.toLowerCase() === wanted;
  }, db);
  if (clash.length) {
    throw new ApiError(409, 'PLAN_NAME_EXISTS', 'A plan with this name already exists.', {
      fields: { name: 'Already used by another plan.' },
    });
  }
}

function toPublicPlan_(p) {
  return {
    planId: p.Plan_ID,
    name: p.Plan_Name,
    durationDays: parseInt(p.Duration_Days, 10),
    price: parseFloat(p.Price),
    description: p.Description || null,
    status: p.Status,
    createdAt: p.Created_At,
    updatedAt: p.Updated_At,
  };
}
