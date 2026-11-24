import { formatDate } from '@/services/members/memberForm'
import type { Membership } from '@/types/membership'

/** "12 days left", "Last day today", "Starts in 3 days", "Ended 24 Nov 2026". */
export function daysLeftText(m: Membership): string {
  if (m.state === 'CANCELLED') return 'Cancelled'
  if (m.state === 'EXPIRED') return `Ended ${formatDate(m.endDate)}`
  if (m.state === 'UPCOMING') {
    return m.daysLeft === 1 ? 'Starts tomorrow' : `Starts in ${m.daysLeft ?? 0} days`
  }
  if (m.daysLeft === 1) return 'Last day today'
  return `${m.daysLeft ?? 0} days left`
}

/** Fraction of a running membership already used (0–1). */
export function usedFraction(m: Membership): number {
  const total =
    (Date.parse(`${m.endDate}T00:00:00Z`) - Date.parse(`${m.startDate}T00:00:00Z`)) / 864e5 + 1
  if (m.state !== 'ACTIVE' && m.state !== 'EXPIRING') return m.state === 'EXPIRED' ? 1 : 0
  return Math.min(1, Math.max(0, (total - (m.daysLeft ?? 0)) / total))
}
