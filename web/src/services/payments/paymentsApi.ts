import type { ApiCaller } from '@/hooks/useApi'
import { invalidateCache } from '@/services/cache'
import type {
  DuesResponse,
  Payment,
  PaymentListResponse,
  PaymentMethod,
  RecordPaymentResponse,
} from '@/types/payment'

/** Payments endpoints (docs/API_DOCUMENTATION.md, Phase 7). */

export const PAYMENT_ID_PATTERN = /^PAY-[0-9a-f]{32}$/

export const paymentCacheKeys = {
  list: (gymId: string, rest: string) => `payments:list:${gymId}:${rest}`,
  dues: (gymId: string, rest: string) => `payments:dues:${gymId}:${rest}`,
  member: (gymId: string, memberId: string) => `payments:member:${gymId}/${memberId}`,
  receipt: (gymId: string, paymentId: string) => `payments:receipt:${gymId}/${paymentId}`,
}

/** After money changes, every view of balances and totals is stale. */
function invalidateMoney(gymId: string, memberId: string) {
  invalidateCache(
    `payments:list:${gymId}:`,
    `payments:dues:${gymId}:`,
    `payments:receipt:${gymId}/`,
    paymentCacheKeys.member(gymId, memberId),
    `memberships:member:${gymId}/${memberId}`,
    `memberships:list:${gymId}:`,
  )
}

export function listPayments(
  api: ApiCaller,
  gymId: string,
  query: {
    from?: string
    to?: string
    method?: PaymentMethod
    search?: string
    includeVoided?: boolean
    page?: number
    pageSize?: number
  },
  signal?: AbortSignal,
): Promise<PaymentListResponse> {
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '' && v !== false) body[k] = typeof v === 'string' ? v.trim() : v
  }
  return api<PaymentListResponse>('GET', `/gyms/${gymId}/payments`, body, signal)
}

export function listDues(
  api: ApiCaller,
  gymId: string,
  query: { search?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<DuesResponse> {
  const body: Record<string, unknown> = {}
  if (query.search?.trim()) body.search = query.search.trim()
  if (query.page) body.page = query.page
  if (query.pageSize) body.pageSize = query.pageSize
  return api<DuesResponse>('GET', `/gyms/${gymId}/dues`, body, signal)
}

export async function listMemberPayments(
  api: ApiCaller,
  gymId: string,
  memberId: string,
  signal?: AbortSignal,
): Promise<Payment[]> {
  const res = await api<{ payments: Payment[] }>(
    'GET',
    `/gyms/${gymId}/members/${memberId}/payments`,
    undefined,
    signal,
  )
  return res.payments
}

export async function getPayment(
  api: ApiCaller,
  gymId: string,
  paymentId: string,
  signal?: AbortSignal,
): Promise<Payment> {
  const res = await api<{ payment: Payment }>(
    'GET',
    `/gyms/${gymId}/payments/${paymentId}`,
    undefined,
    signal,
  )
  return res.payment
}

export interface PaymentInput {
  amount: number
  method: PaymentMethod
  paymentDate?: string
  reference?: string
  notes?: string
}

export async function recordPayment(
  api: ApiCaller,
  gymId: string,
  membershipId: string,
  memberId: string,
  input: PaymentInput,
): Promise<RecordPaymentResponse> {
  const body: Record<string, unknown> = { amount: input.amount, method: input.method }
  if (input.paymentDate) body.paymentDate = input.paymentDate
  if (input.reference?.trim()) body.reference = input.reference.trim()
  if (input.notes?.trim()) body.notes = input.notes.trim()
  const res = await api<RecordPaymentResponse>(
    'POST',
    `/gyms/${gymId}/memberships/${membershipId}/payments`,
    body,
  )
  invalidateMoney(gymId, memberId)
  return res
}

export async function voidPayment(
  api: ApiCaller,
  gymId: string,
  payment: Payment,
  reason: string,
): Promise<Payment> {
  const res = await api<{ payment: Payment }>(
    'POST',
    `/gyms/${gymId}/payments/${payment.paymentId}/void`,
    { reason: reason.trim() },
  )
  invalidateMoney(gymId, payment.memberId)
  return res.payment
}

/** For callers that change money through another endpoint (e.g. sale with payment). */
export { invalidateMoney }
