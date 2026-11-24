import type { ApiCaller } from '@/hooks/useApi'
import { invalidateCache } from '@/services/cache'
import type { StaffMember, StaffRole, TrainerOption } from '@/types/staff'

/** Team endpoints (docs/API_DOCUMENTATION.md, Phase 9). */

export const staffCacheKeys = {
  team: (gymId: string) => `staff:team:${gymId}`,
  trainers: (gymId: string) => `staff:trainers:${gymId}`,
}

function invalidateTeam(gymId: string) {
  // Trainer names appear on members too.
  invalidateCache(`staff:`, `members:list:${gymId}:`, `member:${gymId}/`)
}

export async function listStaff(
  api: ApiCaller,
  gymId: string,
  signal?: AbortSignal,
): Promise<StaffMember[]> {
  const res = await api<{ staff: StaffMember[] }>('GET', `/gyms/${gymId}/staff`, undefined, signal)
  return res.staff
}

export async function listTrainers(
  api: ApiCaller,
  gymId: string,
  signal?: AbortSignal,
): Promise<TrainerOption[]> {
  const res = await api<{ trainers: TrainerOption[] }>(
    'GET',
    `/gyms/${gymId}/trainers`,
    undefined,
    signal,
  )
  return res.trainers
}

export async function inviteStaff(
  api: ApiCaller,
  gymId: string,
  input: { fullName: string; email: string; role: StaffRole },
): Promise<{ staff: StaffMember; inviteEmailSent: boolean }> {
  const res = await api<{ staff: StaffMember; inviteEmailSent: boolean }>(
    'POST',
    `/gyms/${gymId}/staff`,
    { fullName: input.fullName.trim(), email: input.email.trim(), role: input.role },
  )
  invalidateTeam(gymId)
  return res
}

export async function updateStaff(
  api: ApiCaller,
  gymId: string,
  userId: string,
  patch: { fullName?: string; role?: StaffRole; status?: 'ACTIVE' | 'INACTIVE' },
): Promise<StaffMember> {
  const res = await api<{ staff: StaffMember }>('PATCH', `/gyms/${gymId}/staff/${userId}`, patch)
  invalidateTeam(gymId)
  return res.staff
}

export async function resendInvite(api: ApiCaller, gymId: string, userId: string): Promise<void> {
  await api<{ sent: boolean }>('POST', `/gyms/${gymId}/staff/${userId}/resend-invite`)
}

/** Which roles the signed-in user may give (mirrors the backend rule). */
export function assignableRoles(myRole: string | undefined): StaffRole[] {
  if (myRole === 'GYM_OWNER' || myRole === 'PLATFORM_ADMIN')
    return ['GYM_ADMIN', 'TRAINER', 'STAFF']
  if (myRole === 'GYM_ADMIN') return ['TRAINER', 'STAFF']
  return []
}
