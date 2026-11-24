import type { Member, MemberFormErrors, MemberFormValues } from '@/types/member'

/**
 * Pure helpers for the member form. They mirror the backend rules
 * (MemberService.gs / ValidationService.gs) so users get instant feedback;
 * the backend still validates everything.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export const EMPTY_MEMBER_FORM: MemberFormValues = {
  fullName: '',
  phone: '',
  email: '',
  gender: '',
  dateOfBirth: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  joinDate: '',
  notes: '',
  trainerId: '',
}

/** "+91 98765-43210" → "+919876543210" (same as the backend). */
export function normalizePhone(value: string): string {
  return value.trim().replace(/[\s\-().]/g, '')
}

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(normalizePhone(value))
}

/** A real calendar date in YYYY-MM-DD form between 1900 and 2200. */
export function isValidIsoDate(value: string): boolean {
  const m = DATE_PATTERN.exec(value)
  if (!m) return false
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (year < 1900 || year > 2200) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

/** Today as YYYY-MM-DD in the browser's local time zone. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function validateMemberForm(
  values: MemberFormValues,
  today: string = todayIso(),
): MemberFormErrors {
  const errors: MemberFormErrors = {}
  const name = values.fullName.trim()

  if (!name) errors.fullName = 'Full name is required.'
  else if (name.length < 2) errors.fullName = 'Enter at least 2 characters.'
  else if (name.length > 120) errors.fullName = 'Use at most 120 characters.'

  if (!values.phone.trim()) errors.phone = 'Phone number is required.'
  else if (!isValidPhone(values.phone))
    errors.phone = 'Enter 7–15 digits, optionally starting with +.'

  const email = values.email.trim()
  if (email && !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.'

  if (values.emergencyContactPhone.trim() && !isValidPhone(values.emergencyContactPhone)) {
    errors.emergencyContactPhone = 'Enter 7–15 digits, optionally starting with +.'
  }

  if (values.dateOfBirth) {
    if (!isValidIsoDate(values.dateOfBirth)) errors.dateOfBirth = 'Enter a valid date.'
    else if (values.dateOfBirth > today) errors.dateOfBirth = 'Cannot be in the future.'
  }

  if (values.joinDate) {
    if (!isValidIsoDate(values.joinDate)) errors.joinDate = 'Enter a valid date.'
    else if (values.joinDate > addDaysIso(today, 365)) {
      errors.joinDate = 'Cannot be more than a year ahead.'
    } else if (values.joinDate < '1990-01-01') errors.joinDate = 'Is too far in the past.'
  }

  if (
    !errors.dateOfBirth &&
    !errors.joinDate &&
    values.dateOfBirth &&
    values.joinDate &&
    values.dateOfBirth > values.joinDate
  ) {
    errors.dateOfBirth = 'Must be before the join date.'
  }

  if (values.address.length > 300) errors.address = 'Use at most 300 characters.'
  if (values.notes.length > 1000) errors.notes = 'Use at most 1000 characters.'
  if (values.emergencyContactName.length > 120) {
    errors.emergencyContactName = 'Use at most 120 characters.'
  }
  return errors
}

/** Body for POST /members: empty optional fields are omitted. */
export function toCreatePayload(values: MemberFormValues): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim()
    if (value) payload[key] = value
  }
  return payload
}

/**
 * Body for PATCH /members/:id: only changed fields. A cleared optional field is
 * sent as '' so the backend clears it.
 */
export function toUpdatePayload(
  original: MemberFormValues,
  values: MemberFormValues,
): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const key of Object.keys(values) as (keyof MemberFormValues)[]) {
    const next = values[key].trim()
    if (next !== original[key].trim()) payload[key] = next
  }
  return payload
}

export function memberToFormValues(member: Member): MemberFormValues {
  return {
    fullName: member.fullName,
    phone: member.phone,
    email: member.email ?? '',
    gender: member.gender ?? '',
    dateOfBirth: member.dateOfBirth ?? '',
    address: member.address ?? '',
    emergencyContactName: member.emergencyContactName ?? '',
    emergencyContactPhone: member.emergencyContactPhone ?? '',
    joinDate: member.joinDate,
    notes: member.notes ?? '',
    trainerId: member.trainerId ?? '',
  }
}

/** Initials for an avatar: "Ravi Kumar" → "RK". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return (
    letters
      .map((p) => p?.charAt(0) ?? '')
      .join('')
      .toUpperCase() || '?'
  )
}

/** "2026-11-24" → "24 Nov 2026" (dates are calendar dates, shown without time-zone shifts). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso || !isValidIsoDate(iso)) return '—'
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Age in whole years on `today`. */
export function ageOn(dateOfBirth: string | null, today: string = todayIso()): number | null {
  if (!dateOfBirth || !isValidIsoDate(dateOfBirth)) return null
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number]
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0)
}
