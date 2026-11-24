/**
 * Setup.gs — administrative functions run MANUALLY from the Apps Script editor
 * (select the function → Run). They are not reachable through the web app:
 * the web app only exposes doGet/doPost, and no HTML is served, so
 * google.script.run cannot call them either.
 */

/** 1. Check Script Properties. Read-only. */
function checkConfiguration() {
  const config = getConfig_(); // throws listing missing properties
  const ss = SpreadsheetApp.openById(config.spreadsheetId);
  console.log('Configuration OK');
  console.log('  Spreadsheet: ' + ss.getName());
  console.log('  Firebase project: ' + config.firebaseProjectId);
  console.log('  Environment: ' + config.environment);
  console.log('  Token cache seconds: ' + config.tokenCacheSeconds + ', clock skew: ' + config.clockSkewSeconds);
}

/** 2. Create missing tabs and headers. Idempotent; never deletes or rewrites data. */
function initializeDatabase() {
  const report = withScriptLock_(function () {
    return initializeSheets_();
  });
  console.log(report.length ? report.join('\n') : 'All tabs already initialized.');
  validateDatabase();
}

/**
 * 2b. Give every gym its own spreadsheet and create/upgrade its tabs.
 * Creates a spreadsheet (in the script owner's Drive) for gyms that have none,
 * and adds tabs introduced by newer versions. Idempotent; never deletes or
 * rewrites data. Run after initializeDatabase(), and again after every backend
 * update that adds per-gym tabs.
 */
function initializeGymDatabases() {
  const gyms = readRecords_('Gyms');
  if (!gyms.length) {
    console.log('No gyms yet. Provision one first (provisionFromBootstrapProperty).');
    return [];
  }
  const results = gyms.map(function (g) {
    const result = withScriptLock_(function () {
      return ensureGymDatabaseLocked_(g.Gym_ID);
    });
    console.log(
      g.Gym_ID + ' (' + g.Gym_Name + '): ' + (result.created ? 'spreadsheet CREATED. ' : 'spreadsheet exists. ') +
        (result.report.length ? result.report.join('; ') : 'tabs up to date.'),
    );
    return { gymId: g.Gym_ID, created: result.created };
  });
  validateDatabase();
  return results;
}

/** 3. Report structural problems (headers, missing/duplicate IDs). Read-only. */
function validateDatabase() {
  const problems = validateSpreadsheetStructure_().concat(validateGymDatabases_());
  if (problems.length) {
    console.warn('Database problems found:\n' + problems.join('\n'));
  } else {
    console.log('Database structure is valid.');
  }
  return problems;
}

/**
 * 4. Provision a gym + owner, and/or a platform admin, from the one-time
 * Script Property BOOTSTRAP_PROVISION. The property is deleted afterwards.
 *
 * The Firebase users must already exist (Firebase console → Authentication →
 * Users → Add user); copy their UIDs from there. Example property value:
 *
 * {
 *   "gym":   { "name": "Demo Fitness" },
 *   "owner": { "firebaseUid": "<uid>", "email": "owner@example.com", "fullName": "Owner Name" },
 *   "platformAdmin": { "firebaseUid": "<uid>", "email": "admin@example.com", "fullName": "Admin Name" }
 * }
 * Every block is optional, but "owner" requires "gym".
 */
function provisionFromBootstrapProperty() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(PROPERTY_KEYS.BOOTSTRAP_PROVISION);
  if (!raw) throw new Error('Script Property ' + PROPERTY_KEYS.BOOTSTRAP_PROVISION + ' is not set.');

  const spec = JSON.parse(raw);
  if (spec.owner && !spec.gym) throw new Error('"owner" requires "gym".');

  if (spec.platformAdmin) {
    const admin = createUser_(
      {
        Firebase_UID: spec.platformAdmin.firebaseUid,
        Email: spec.platformAdmin.email,
        Full_Name: spec.platformAdmin.fullName,
        Role: USER_ROLES.PLATFORM_ADMIN,
      },
      'SYSTEM',
    );
    console.log('Created platform admin ' + admin.User_ID);
  }

  if (spec.gym) {
    if (!spec.owner) throw new Error('A gym needs an "owner".');
    // Fail before creating the gym, so a duplicate owner cannot leave an orphaned gym row.
    if (findUsersByFirebaseUid_(String(spec.owner.firebaseUid || '').trim()).length > 0) {
      throw new Error('A user with the owner Firebase UID already exists. Nothing was created for the gym.');
    }
    const gym = createGym_({ Gym_Name: spec.gym.name, Owner_UID: spec.owner.firebaseUid }, 'SYSTEM');
    console.log('Created gym ' + gym.Gym_ID + ' (' + gym.Gym_Name + ')');
    const owner = createUser_(
      {
        Firebase_UID: spec.owner.firebaseUid,
        Gym_ID: gym.Gym_ID,
        Email: spec.owner.email,
        Full_Name: spec.owner.fullName,
        Role: USER_ROLES.GYM_OWNER,
      },
      'SYSTEM',
    );
    console.log('Created gym owner ' + owner.User_ID);
    const gymDb = withScriptLock_(function () {
      return ensureGymDatabaseLocked_(gym.Gym_ID);
    });
    console.log('Created gym spreadsheet ' + (gymDb.created ? '(new)' : '(existing)') + ' for ' + gym.Gym_ID);
  }

  props.deleteProperty(PROPERTY_KEYS.BOOTSTRAP_PROVISION);
  console.log('Provisioning complete; ' + PROPERTY_KEYS.BOOTSTRAP_PROVISION + ' removed.');
}
