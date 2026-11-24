/**
 * Display formatting shared by screens.
 * Currency: Indian Rupee by default (the gym time zone is Asia/Kolkata); a
 * per-gym currency setting can replace this constant later.
 */
export const CURRENCY = 'INR'
const LOCALE = 'en-IN'

const wholeMoney = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0,
})
const exactMoney = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 1500 → "₹1,500"; 1499.5 → "₹1,499.50" (paise shown only when present). */
export function formatMoney(amount: number): string {
  return Number.isInteger(amount) ? wholeMoney.format(amount) : exactMoney.format(amount)
}

/** 30 → "1 month", 90 → "3 months", 365 → "1 year", 14 → "2 weeks", 45 → "45 days". */
export function formatDuration(days: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (days >= 365 && days % 365 === 0) return plural(days / 365, 'year')
  if (days >= 30 && days < 365 && days % 30 === 0) return plural(days / 30, 'month')
  if (days >= 7 && days < 28 && days % 7 === 0) return plural(days / 7, 'week')
  return plural(days, 'day')
}

/** "2026-11-24T02:12:00.000Z" → "7:42 am" in the viewer's time zone. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })
}

/** Time between two ISO timestamps as "1 h 25 min" / "40 min". */
export function formatStay(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}
