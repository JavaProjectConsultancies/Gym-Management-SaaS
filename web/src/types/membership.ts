import type { PageInfo } from './api'
import type { Payment } from './payment'

export type PlanStatus = 'ACTIVE' | 'INACTIVE'

export interface Plan {
  planId: string
  name: string
  durationDays: number
  price: number
  description: string | null
  status: PlanStatus
  createdAt: string
  updatedAt: string
}

/** Computed by the backend from the dates (gym time zone). */
export type MembershipState = 'UPCOMING' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'CANCELLED'

export interface Membership {
  membershipId: string
  memberId: string
  planId: string
  /** Snapshot at sale time. */
  planName: string
  startDate: string
  endDate: string
  /** Snapshot at sale time. */
  price: number
  status: 'ACTIVE' | 'CANCELLED'
  state: MembershipState
  /** Days left incl. today (running) or days until start (upcoming); null otherwise. */
  daysLeft: number | null
  notes: string | null
  cancelReason: string | null
  /** Phase 7: total of recorded payments, and what is still owed (0 if cancelled). */
  amountPaid?: number
  balanceDue?: number
  /** Present when the sale also recorded a first payment. */
  payment?: Payment
  createdAt: string
  updatedAt: string
  /** Present on gym-wide lists. */
  member?: { memberId: string; fullName: string; phone: string; status: string }
}

export interface MemberMemberships {
  memberships: Membership[]
  current: Membership | null
  next: Membership | null
  /** Where a new membership would start by default (day after the latest ends, or today). */
  suggestedStartDate: string
}

export type MembershipFilter = Exclude<MembershipState, never>

export interface MembershipListResponse extends PageInfo {
  memberships: Membership[]
  counts: Record<MembershipFilter, number>
}
