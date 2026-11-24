/**
 * GymDatabaseService.gs — each gym's own spreadsheet (Phase 4).
 *
 * Why one spreadsheet per gym:
 *   - Physical separation: a gym's operational data (members, memberships,
 *     payments, attendance…) never shares a file with another gym's data.
 *   - Scale: a Google spreadsheet is limited to 10 million cells; one file for
 *     every gym would hit that limit early.
 *
 * Rules:
 *   - The spreadsheet ID comes ONLY from the gym's row in the central Gyms tab.
 *     It is never accepted from a client and never returned to gym users.
 *   - Spreadsheets are created ONLY by the admin functions in Setup.gs
 *     (initializeGymDatabases / provisioning), never during a web request.
 *   - A request for a gym without a spreadsheet fails with 503 GYM_DATABASE_NOT_READY.
 */

/** Google Drive file IDs: letters, digits, "-" and "_". */
const SPREADSHEET_ID_PATTERN_ = /^[A-Za-z0-9_-]{20,128}$/;
const gymSpreadsheetCache_ = {};

/**
 * Handle for one gym's spreadsheet (see SpreadsheetService.gs "db handle").
 * @param gym a Gyms row read from the central database
 */
function gymDb_(gym) {
  if (!gym || !gym.Gym_ID) throw new Error('gymDb_ requires a Gyms row');
  const spreadsheetId = gym.Spreadsheet_ID;
  if (!spreadsheetId) {
    console.error('Gym ' + gym.Gym_ID + ' has no Spreadsheet_ID. Run initializeGymDatabases().');
    throw new ApiError(503, 'GYM_DATABASE_NOT_READY', "This gym's data store is not set up yet. Contact support.");
  }
  if (!SPREADSHEET_ID_PATTERN_.test(spreadsheetId)) {
    console.error('Gym ' + gym.Gym_ID + ' has a malformed Spreadsheet_ID.');
    throw new ApiError(500, 'DATA_INTEGRITY_ERROR', 'A data integrity problem was detected.');
  }
  return {
    schema: GYM_SCHEMA,
    label: 'gym ' + gym.Gym_ID,
    gymId: gym.Gym_ID,
    getSpreadsheet: function () {
      if (!gymSpreadsheetCache_[spreadsheetId]) {
        try {
          gymSpreadsheetCache_[spreadsheetId] = SpreadsheetApp.openById(spreadsheetId);
        } catch (e) {
          console.error('Cannot open spreadsheet of gym ' + gym.Gym_ID + ': ' + e);
          throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is temporarily unavailable.');
        }
      }
      return gymSpreadsheetCache_[spreadsheetId];
    },
  };
}

/**
 * The gym a request may act on. Tenant access is checked again here so a route
 * that forgets its gymParam still cannot reach another gym. Uses the context's own gym when it matches,
 * otherwise (platform admin) reads it from the Gyms tab.
 */
function getGymForRequest_(ctx, gymId) {
  // Defence in depth: re-check tenant access even though the route's gymParam already did.
  requireGymAccess_(ctx, gymId);
  if (ctx && ctx.gym && ctx.gym.Gym_ID === gymId) return ctx.gym;
  const gym = getGymById_(gymId);
  if (!gym) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return gym;
}

/**
 * Make sure a gym has its own spreadsheet with all current tabs.
 * Creates the spreadsheet if missing and records its ID on the Gyms row.
 * Idempotent. MUST be called inside withScriptLock_ (admin functions only).
 * @return {{ gym: Object, created: boolean, report: string[] }}
 */
function ensureGymDatabaseLocked_(gymId) {
  let gym = findRecordById_('Gyms', gymId); // fresh read inside the lock
  if (!gym) throw new Error('Gym not found: ' + gymId);

  let created = false;
  if (!gym.Spreadsheet_ID) {
    const ss = SpreadsheetApp.create('Gym data — ' + gym.Gym_Name + ' (' + gym.Gym_ID + ')');
    gym = updateRecordLocked_('Gyms', gym.Gym_ID, { Spreadsheet_ID: ss.getId() });
    logAuditLocked_('SYSTEM', 'GYM_DATABASE_CREATED', 'Gyms', gym.Gym_ID);
    created = true;
  }

  assertSpreadsheetNotShared_(gym);
  const db = gymDb_(gym);
  const report = initializeSheets_(db);
  if (created) removeDefaultSheet_(db.getSpreadsheet());
  return { gym: gym, created: created, report: report };
}

/** Refuse to initialise a spreadsheet that another gym row also points to. */
function assertSpreadsheetNotShared_(gym) {
  const others = findRecords_('Gyms', function (g) {
    return g.Gym_ID !== gym.Gym_ID && g.Spreadsheet_ID === gym.Spreadsheet_ID;
  });
  if (others.length) {
    throw new Error('Gyms ' + gym.Gym_ID + ' and ' + others[0].Gym_ID + ' share one spreadsheet. Fix the Gyms tab manually.');
  }
}

/** A new spreadsheet starts with an empty "Sheet1"; remove it once real tabs exist. */
function removeDefaultSheet_(ss) {
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }
}

/** Read-only structural check of every gym's spreadsheet. */
function validateGymDatabases_() {
  const problems = [];
  const gyms = readRecords_('Gyms');
  const seen = {};
  gyms.forEach(function (gym) {
    if (!gym.Spreadsheet_ID) {
      problems.push('Gym ' + gym.Gym_ID + ': no Spreadsheet_ID (run initializeGymDatabases)');
      return;
    }
    if (seen[gym.Spreadsheet_ID]) {
      problems.push('Gyms ' + seen[gym.Spreadsheet_ID] + ' and ' + gym.Gym_ID + ' share one spreadsheet');
      return;
    }
    seen[gym.Spreadsheet_ID] = gym.Gym_ID;
    try {
      validateSpreadsheetStructure_(gymDb_(gym)).forEach(function (p) {
        problems.push(p);
      });
    } catch (e) {
      problems.push('Gym ' + gym.Gym_ID + ': cannot open spreadsheet (' + (e.code || e.message) + ')');
    }
  });
  return problems;
}
