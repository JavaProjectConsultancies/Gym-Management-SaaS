import type { ApiCaller } from '@/hooks/useApi'
import { invalidateCache, writeCache } from '@/services/cache'
import type {
  MemberMemberships,
  Membership,
  MembershipFilter,
  MembershipListResponse,
  Plan,
  PlanStatus,
} from '@/types/membership'
import type { PaymentMethod } from '@/types/payment'

/**
 * Plans and memberships endpoints (docs/API_DOCUMENTATION.md, Phase 6).
 * Cache keys live here so every screen invalidates consistently after a change.
 */
export const cacheKeys = {
  plans: (gymId: string) => `plans:${gymId}`,
  membershipList: (gymId: string, rest: string) => `memberships:list:${gymId}:${rest}`,
  memberMemberships: (gymId: string, memberId: string) => `memberships:member:${gymId}/${memberId}`,
}

export const PLAN_ID_PATTERN = /^PLN-[0-9a-f]{32}$/
export const MEMBERSHIP_ID_PATTERN = /^MSP-[0-9a-f]{32}$/

/* ---------------- Plans ---------------- */

export async function listPlans(
  api: ApiCaller,
  gymId: string,
  signal?: AbortSignal,
): Promise<Plan[]> {
  const res = await api<{ plans: Plan[] }>('GET', `/gyms/${gymId}/plans`, {}, signal)
  return res.plans
}

export interface PlanInput {
  name: string
  durationDays: number
  price: number
  description: string
}

export async function createPlan(api: ApiCaller, gymId: string, input: PlanInput): Promise<Plan> {
  const body: Record<string, unknown> = {
    name: input.name.trim(),
    durationDays: input.durationDays,
    price: input.price,
  }
  if (input.description.trim()) body.description = input.description.trim()
  const res = await api<{ plan: Plan }>('POST', `/gyms/${gymId}/plans`, body)
  invalidateCache(cacheKeys.plans(gymId))
  return res.plan
}

export async function updatePlan(
  api: ApiCaller,
  gymId: string,
  planId: string,
  patch: Partial<PlanInput> & { status?: PlanStatus },
): Promise<Plan> {
  const res = await api<{ plan: Plan }>('PATCH', `/gyms/${gymId}/plans/${planId}`, patch)
  invalidateCache(cacheKeys.plans(gymId))
  return res.plan
}

/* ---------------- Memberships ---------------- */

export function listMemberships(
  api: ApiCaller,
  gymId: string,
  query: { state?: MembershipFilter; search?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<MembershipListResponse> {
  const body: Record<string, unknown> = {}
  if (query.state) body.state = query.state
  if (query.search?.trim()) body.search = query.search.trim()
  if (query.page) body.page = query.page
  if (query.pageSize) body.pageSize = query.pageSize
  return api<MembershipListResponse>('GET', `/gyms/${gymId}/memberships`, body, signal)
}

export function getMemberMemberships(
  api: ApiCaller,
  gymId: string,
  memberId: string,
  signal?: AbortSignal,
): Promise<MemberMemberships> {
  return api<MemberMemberships>(
    'GET',
    `/gyms/${gymId}/members/${memberId}/memberships`,
    undefined,
    signal,
  )
}

export interface SellInput {
  planId: string
  startDate?: string
  price?: number
  notes?: string
  /** Phase 7: record the first payment in the same step. */
  paymentAmount?: number
  paymentMethod?: PaymentMethod
  paymentReference?: string
}

export async function sellMembership(
  api: ApiCaller,
  gymId: string,
  memberId: string,
  input: SellInput,
): Promise<Membership> {
  const body: Record<string, unknown> = { planId: input.planId }
  if (input.startDate) body.startDate = input.startDate
  if (input.price !== undefined) body.price = input.price
  if (input.notes?.trim()) body.notes = input.notes.trim()
  if (input.paymentAmount !== undefined) {
    body.paymentAmount = input.paymentAmount
    body.paymentMethod = input.paymentMethod
    if (input.paymentReference?.trim()) body.paymentReference = input.paymentReference.trim()
  }
  const res = await api<{ membership: Membership }>(
    'POST',
    `/gyms/${gymId}/members/${memberId}/memberships`,
    body,
  )
  invalidateCache(
    cacheKeys.memberMemberships(gymId, memberId),
    `memberships:list:${gymId}:`,
    `payments:list:${gymId}:`,
    `payments:dues:${gymId}:`,
    `payments:member:${gymId}/${memberId}`,
  )
  return res.membership
}

export async function cancelMembership(
  api: ApiCaller,
  gymId: string,
  membership: Membership,
  reason: string,
): Promise<Membership> {
  const body: Record<string, unknown> = {}
  if (reason.trim()) body.reason = reason.trim()
  const res = await api<{ membership: Membership }>(
    'POST',
    `/gyms/${gymId}/memberships/${membership.membershipId}/cancel`,
    body,
  )
  invalidateCache(
    cacheKeys.memberMemberships(gymId, membership.memberId),
    `memberships:list:${gymId}:`,
    `payments:dues:${gymId}:`,
  )
  return res.membership
}

/** Pre-fill the cache after a write so the next screen opens instantly. */
export function primeMemberMemberships(gymId: string, memberId: string, data: MemberMemberships) {
  writeCache(cacheKeys.memberMemberships(gymId, memberId), data)
}
