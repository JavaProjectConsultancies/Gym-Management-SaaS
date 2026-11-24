import { formatMoney } from '@/utils/format'

/** Validate an amount typed into a payment form. Returns an error message or null. */
export function validateAmount(raw: string, balanceDue: number): string | null {
  const text = raw.trim()
  if (text === '') return 'Enter the amount received.'
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) return 'Enter an amount above 0.'
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return 'Use at most 2 decimal places.'
  if (Math.round(value * 100) > Math.round(balanceDue * 100)) {
    return balanceDue > 0 ? `At most ${formatMoney(balanceDue)} is due.` : 'Nothing is due.'
  }
  return null
}
