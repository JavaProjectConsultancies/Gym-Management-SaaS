import type { PageInfo } from './api'
import type { Membership } from './membership'

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER'
export type PaymentStatus = 'RECORDED' | 'VOIDED'

export interface Payment {
  paymentId: string
  /** Sequential per gym, e.g. "R-000042". */
  receiptNo: string
  memberId: string
  membershipId: string
  amount: number
  method: PaymentMethod
  /** YYYY-MM-DD */
  paymentDate: string
  reference: string | null
  notes: string | null
  status: PaymentStatus
  voidReason: string | null
  createdAt: string
  updatedAt: string
  member?: { memberId: string; fullName: string; phone: string }
  membership?: {
    membershipId: string
    planName: string
    startDate: string
    endDate: string
    price: number
    /** Present on the receipt endpoint. */
    balanceDue?: number
  }
  /** Present on the receipt endpoint. */
  gymName?: string
}

export interface PaymentListResponse extends PageInfo {
  payments: Payment[]
  from: string
  to: string
  totals: { count: number; amount: number; byMethod: Record<PaymentMethod, number> }
}

export interface DuesResponse extends PageInfo {
  dues: Membership[]
  totalDue: number
}

export interface RecordPaymentResponse {
  payment: Payment
  membership: Membership
}
