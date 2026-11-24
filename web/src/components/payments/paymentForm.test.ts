import { describe, expect, it } from 'vitest'

import { receiptText, whatsappLink } from '@/services/payments/paymentText'
import type { Payment } from '@/types/payment'

import { validateAmount } from './paymentForm'

describe('validateAmount', () => {
  it('accepts full and part payments', () => {
    expect(validateAmount('1500', 1500)).toBeNull()
    expect(validateAmount('500.50', 1500)).toBeNull()
    expect(validateAmount('0.29', 0.29)).toBeNull()
  })
  it('rejects empty, zero, negative, too many decimals and overpayment', () => {
    expect(validateAmount('', 100)).toMatch(/Enter/)
    expect(validateAmount('0', 100)).toMatch(/above 0/)
    expect(validateAmount('-5', 100)).toMatch(/above 0/)
    expect(validateAmount('10.005', 100)).toMatch(/decimal/)
    expect(validateAmount('10.0001', 100)).toMatch(/decimal/)
    expect(validateAmount('100.01', 100)).toMatch(/At most/)
    expect(validateAmount('1', 0)).toBe('Nothing is due.')
  })
})

const payment: Payment = {
  paymentId: `PAY-${'a'.repeat(32)}`,
  receiptNo: 'R-000007',
  memberId: `MEM-${'b'.repeat(32)}`,
  membershipId: `MSP-${'c'.repeat(32)}`,
  amount: 1000,
  method: 'UPI',
  paymentDate: '2026-11-24',
  reference: 'UPI-1',
  notes: null,
  status: 'RECORDED',
  voidReason: null,
  createdAt: '',
  updatedAt: '',
  gymName: 'Gymora',
  member: { memberId: '', fullName: 'Ravi Kumar', phone: '+919876543210' },
  membership: {
    membershipId: '',
    planName: 'Monthly',
    startDate: '2026-11-24',
    endDate: '2026-12-23',
    price: 1500,
    balanceDue: 500,
  },
}

describe('receipt sharing', () => {
  it('builds a readable receipt', () => {
    const text = receiptText(payment)
    expect(text).toContain('Gymora — Payment receipt R-000007')
    expect(text).toContain('Amount: ₹1,000 (UPI)')
    expect(text).toContain('Balance due: ₹500')
    expect(receiptText({ ...payment, status: 'VOIDED' })).toMatch(/^\*\*\* VOIDED/)
  })
  it('makes WhatsApp links with +91 for 10-digit numbers', () => {
    expect(whatsappLink('98765 43210', 'hi')).toBe('https://wa.me/919876543210?text=hi')
    expect(whatsappLink('+919876543210', 'a b')).toBe('https://wa.me/919876543210?text=a%20b')
    expect(whatsappLink('09876543210', 'x')).toBe('https://wa.me/919876543210?text=x')
    expect(whatsappLink(undefined, 'x')).toBe('https://wa.me/?text=x')
  })
})
