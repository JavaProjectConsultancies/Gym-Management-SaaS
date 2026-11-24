/**
 * GymService.gs — gyms (tenants) and their settings.
 * Callers must already have passed authorization (PermissionService).
 */

function getGymById_(gymId) {
  return findRecordById_('Gyms', gymId);
}

/** Create a gym. Used by provisioning (Setup.gs) — not exposed by the API yet. */
function createGym_(data, actorUserId) {
  return withScriptLock_(function () {
    const gym = createRecordLocked_('Gyms', {
      Gym_Name: data.Gym_Name,
      Owner_UID: data.Owner_UID,
      Spreadsheet_ID: data.Spreadsheet_ID || '',
      Status: data.Status || GYM_STATUS.ACTIVE,
    });
    logAuditLocked_(actorUserId || 'SYSTEM', 'GYM_CREATED', 'Gyms', gym.Gym_ID);
    return gym;
  });
}

function listGymSettings_(gymId) {
  return findRecords_('Gym_Settings', function (s) {
    return s.Gym_ID === gymId;
  }).map(toPublicSetting_);
}

/**
 * Create or update one setting atomically. The lookup and the write happen
 * inside the same lock, so concurrent requests for the same key cannot
 * create duplicates or lose updates.
 */
function upsertGymSetting_(gymId, settingKey, settingValue, ctx) {
  return withScriptLock_(function () {
    const existing = findRecords_('Gym_Settings', function (s) {
      return s.Gym_ID === gymId && s.Setting_Key === settingKey;
    });
    if (existing.length > 1) {
      console.error('Duplicate setting ' + settingKey + ' for ' + gymId);
      throw new ApiError(500, 'DATA_INTEGRITY_ERROR', 'A data integrity problem was detected.');
    }

    let record;
    let action;
    if (existing.length === 1) {
      record = updateRecordLocked_('Gym_Settings', existing[0].Setting_ID, { Setting_Value: settingValue });
      action = 'SETTING_UPDATED';
    } else {
      record = createRecordLocked_('Gym_Settings', {
        Gym_ID: gymId,
        Setting_Key: settingKey,
        Setting_Value: settingValue,
      });
      action = 'SETTING_CREATED';
    }
    logAuditLocked_(ctx.userId, action, 'Gym_Settings', record.Setting_ID);
    return { setting: toPublicSetting_(record), created: action === 'SETTING_CREATED' };
  });
}

/** Spreadsheet_ID is internal and only shown to platform admins. */
function toPublicGym_(gym, ctx) {
  const out = {
    gymId: gym.Gym_ID,
    name: gym.Gym_Name,
    status: gym.Status,
    createdAt: gym.Created_At,
    dataStoreReady: Boolean(gym.Spreadsheet_ID),
  };
  if (ctx && ctx.role === USER_ROLES.PLATFORM_ADMIN) {
    out.ownerUid = gym.Owner_UID;
    out.spreadsheetId = gym.Spreadsheet_ID || null;
  }
  return out;
}

function toPublicSetting_(s) {
  return { settingId: s.Setting_ID, key: s.Setting_Key, value: s.Setting_Value, updatedAt: s.Updated_At };
}
