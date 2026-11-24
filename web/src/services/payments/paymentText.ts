import { formatDate } from '@/services/members/memberForm'
import type { Payment, PaymentMethod } from '@/types/payment'
import { formatMoney } from '@/utils/format'

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
}

export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]

/** Plain-text receipt for sharing (WhatsApp, SMS, email). */
export function receiptText(p: Payment): string {
  const lines = [
    `${p.gymName ?? 'Gym'} — Payment receipt ${p.receiptNo}`,
    `Member: ${p.member?.fullName ?? ''}`,
    `Amount: ${formatMoney(p.amount)} (${PAYMENT_METHOD_LABELS[p.method]})`,
    `Date: ${formatDate(p.paymentDate)}`,
  ]
  if (p.membership) {
    lines.push(
      `For: ${p.membership.planName}, ${formatDate(p.membership.startDate)} – ${formatDate(p.membership.endDate)}`,
    )
    if (p.membership.balanceDue !== undefined) {
      lines.push(
        p.membership.balanceDue > 0
          ? `Balance due: ${formatMoney(p.membership.balanceDue)}`
          : 'Fully paid. Thank you!',
      )
    }
  }
  if (p.reference) lines.push(`Ref: ${p.reference}`)
  if (p.status === 'VOIDED') lines.unshift('*** VOIDED ***')
  return lines.join('\n')
}

/**
 * WhatsApp "click to chat" link with the receipt text. Numbers without a
 * country code are assumed to be Indian (+91). Opened only when the user taps it.
 */
export function whatsappLink(phone: string | undefined, text: string): string {
  let digits = (phone ?? '').replace(/[^0-9]/g, '').replace(/^0+/, '')
  if (digits.length === 10) digits = `91${digits}`
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(text)}`
}
