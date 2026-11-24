import type { ApiCaller } from '@/hooks/useApi'
import { invalidateCache } from '@/services/cache'
import type {
  AttendanceListResponse,
  CheckInResponse,
  LookupResponse,
  MemberAttendance,
  Visit,
} from '@/types/attendance'

/** Attendance endpoints (docs/API_DOCUMENTATION.md, Phase 8). */

export const attendanceCacheKeys = {
  day: (gymId: string, rest: string) => `attendance:day:${gymId}:${rest}`,
  member: (gymId: string, memberId: string) => `attendance:member:${gymId}/${memberId}`,
}

function invalidateAttendance(gymId: string, memberId: string) {
  invalidateCache(`attendance:day:${gymId}:`, attendanceCacheKeys.member(gymId, memberId))
}

export function lookupMembers(
  api: ApiCaller,
  gymId: string,
  query: string,
  signal?: AbortSignal,
): Promise<LookupResponse> {
  return api<LookupResponse>(
    'GET',
    `/gyms/${gymId}/attendance/lookup`,
    { query: query.trim() },
    signal,
  )
}

export function listAttendance(
  api: ApiCaller,
  gymId: string,
  query: { date?: string; status?: 'IN' | 'OUT'; search?: string; includeVoided?: boolean },
  signal?: AbortSignal,
): Promise<AttendanceListResponse> {
  const body: Record<string, unknown> = { pageSize: 200 }
  if (query.date) body.date = query.date
  if (query.status) body.status = query.status
  if (query.search?.trim()) body.search = query.search.trim()
  if (query.includeVoided) body.includeVoided = true
  return api<AttendanceListResponse>('GET', `/gyms/${gymId}/attendance`, body, signal)
}

export function getMemberAttendance(
  api: ApiCaller,
  gymId: string,
  memberId: string,
  signal?: AbortSignal,
): Promise<MemberAttendance> {
  return api<MemberAttendance>(
    'GET',
    `/gyms/${gymId}/members/${memberId}/attendance`,
    undefined,
    signal,
  )
}

export async function checkIn(
  api: ApiCaller,
  gymId: string,
  memberId: string,
  overrideReason?: string,
): Promise<CheckInResponse> {
  const body: Record<string, unknown> = { memberId }
  if (overrideReason !== undefined) {
    body.override = true
    body.overrideReason = overrideReason.trim()
  }
  const res = await api<CheckInResponse>('POST', `/gyms/${gymId}/attendance/check-in`, body)
  invalidateAttendance(gymId, memberId)
  return res
}

export async function checkOut(api: ApiCaller, gymId: string, visit: Visit): Promise<Visit> {
  const res = await api<{ attendance: Visit }>(
    'POST',
    `/gyms/${gymId}/attendance/${visit.attendanceId}/check-out`,
  )
  invalidateAttendance(gymId, visit.memberId)
  return res.attendance
}

export async function voidVisit(
  api: ApiCaller,
  gymId: string,
  visit: Visit,
  reason: string,
): Promise<Visit> {
  const res = await api<{ attendance: Visit }>(
    'POST',
    `/gyms/${gymId}/attendance/${visit.attendanceId}/void`,
    { reason: reason.trim() },
  )
  invalidateAttendance(gymId, visit.memberId)
  return res.attendance
}
