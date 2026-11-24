import type { PageInfo } from './api'
import type { Member } from './member'
import type { Membership } from './membership'

export type AttendanceStatus = 'IN' | 'OUT' | 'VOIDED'

export interface Visit {
  attendanceId: string
  memberId: string
  /** Membership that covered the visit; null when staff let them in without one. */
  membershipId: string | null
  /** Gym-local date, YYYY-MM-DD. */
  visitDate: string
  /** Server timestamps (UTC ISO). */
  checkInAt: string
  checkOutAt: string | null
  status: AttendanceStatus
  overrideReason: string | null
  voidReason: string | null
  member?: { memberId: string; fullName: string; phone: string }
}

export type CheckInWarning = 'BALANCE_DUE' | 'EXPIRING_SOON' | 'NO_ACTIVE_MEMBERSHIP'

export interface CheckInResponse {
  attendance: Visit
  membership: Membership | null
  warnings: CheckInWarning[]
}

export interface LookupResult {
  member: Member
  membership: Membership | null
  lastMembershipEnd: string | null
  today: Visit | null
}

export interface LookupResponse {
  results: LookupResult[]
  total: number
  date: string
}

export interface AttendanceListResponse extends PageInfo {
  attendance: Visit[]
  date: string
  counts: { total: number; in: number; out: number; overrides: number }
}

export interface MemberAttendance {
  visits: Visit[]
  stats: { last30Days: number; last90Days: number; lastVisit: string | null }
}
