/**
 * Permission names issued by the backend (backend/apps-script/src/Config.gs).
 * The UI uses them only to hide actions the user cannot perform; the backend
 * enforces every permission on every request.
 */
export const PERMISSIONS = {
  membersRead: 'members:read',
  membersWrite: 'members:write',
  plansRead: 'plans:read',
  plansWrite: 'plans:write',
  membershipsRead: 'memberships:read',
  membershipsWrite: 'memberships:write',
  paymentsRead: 'payments:read',
  paymentsWrite: 'payments:write',
  paymentsVoid: 'payments:void',
  attendanceRead: 'attendance:read',
  attendanceWrite: 'attendance:write',
  attendanceVoid: 'attendance:void',
  staffRead: 'staff:read',
  staffWrite: 'staff:write',
  settingsWrite: 'settings:write',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform admin',
  GYM_OWNER: 'Owner',
  GYM_ADMIN: 'Admin',
  TRAINER: 'Trainer',
  STAFF: 'Staff',
  MEMBER: 'Member',
}

export function roleLabel(role: string | undefined): string {
  return (role && ROLE_LABELS[role]) ?? 'User'
}
