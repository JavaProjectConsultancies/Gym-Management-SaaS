/**
 * AuditService.gs — append-only Platform_Audit_Log.
 * Never log tokens, passwords or personal data in Action/Entity fields.
 */

/** Use inside an existing withScriptLock_ block so the entry commits with the change. */
function logAuditLocked_(userId, action, entity, entityId) {
  return createRecordLocked_('Platform_Audit_Log', {
    User_ID: userId,
    Action: action,
    Entity: entity,
    Entity_ID: entityId || '',
  });
}

/** Standalone audit entry (acquires the lock itself). */
function logAudit_(userId, action, entity, entityId) {
  return withScriptLock_(function () {
    return logAuditLocked_(userId, action, entity, entityId);
  });
}
