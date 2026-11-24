import { describe, expect, it } from 'vitest'

import type { Member } from '@/types/member'

import {
  addDaysIso,
  ageOn,
  EMPTY_MEMBER_FORM,
  formatDate,
  initials,
  isValidIsoDate,
  memberToFormValues,
  normalizePhone,
  toCreatePayload,
  toUpdatePayload,
  validateMemberForm,
} from './memberForm'

const TODAY = '2026-06-15'
const valid = { ...EMPTY_MEMBER_FORM, fullName: 'Ravi Kumar', phone: '+91 98765 43210' }

describe('normalizePhone (mirrors backend)', () => {
  it('strips separators but keeps + and leading zeros', () => {
    expect(normalizePhone(' +91 98765-43210 ')).toBe('+919876543210')
    expect(normalizePhone('(022) 2345.6789')).toBe('02223456789')
  })
})

describe('isValidIsoDate', () => {
  it('accepts real dates only', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2023-02-29')).toBe(false)
    expect(isValidIsoDate('2026-04-31')).toBe(false)
    expect(isValidIsoDate('15/06/2026')).toBe(false)
    expect(isValidIsoDate('1850-01-01')).toBe(false)
  })
})

describe('validateMemberForm', () => {
  it('passes a minimal valid member', () => {
    expect(validateMemberForm(valid, TODAY)).toEqual({})
  })

  it('requires name and phone', () => {
    const errors = validateMemberForm(EMPTY_MEMBER_FORM, TODAY)
    expect(errors.fullName).toBeDefined()
    expect(errors.phone).toBeDefined()
  })

  it('rejects short names, bad phones and bad emails', () => {
    expect(validateMemberForm({ ...valid, fullName: 'A' }, TODAY).fullName).toBeDefined()
    expect(validateMemberForm({ ...valid, phone: '12345' }, TODAY).phone).toBeDefined()
    expect(validateMemberForm({ ...valid, phone: '98765x43210' }, TODAY).phone).toBeDefined()
    expect(validateMemberForm({ ...valid, email: 'nope' }, TODAY).email).toBeDefined()
    expect(
      validateMemberForm({ ...valid, emergencyContactPhone: '1' }, TODAY).emergencyContactPhone,
    ).toBeDefined()
  })

  it('enforces date rules', () => {
    expect(validateMemberForm({ ...valid, dateOfBirth: '2026-06-16' }, TODAY).dateOfBirth).toBe(
      'Cannot be in the future.',
    )
    expect(validateMemberForm({ ...valid, joinDate: '2027-06-16' }, TODAY).joinDate).toBeDefined()
    expect(validateMemberForm({ ...valid, joinDate: '1989-12-31' }, TODAY).joinDate).toBeDefined()
    expect(
      validateMemberForm({ ...valid, dateOfBirth: '2026-03-01', joinDate: '2026-02-01' }, TODAY)
        .dateOfBirth,
    ).toBe('Must be before the join date.')
    expect(
      validateMemberForm({ ...valid, dateOfBirth: '1995-04-12', joinDate: TODAY }, TODAY),
    ).toEqual({})
  })
})

describe('payloads', () => {
  it('create payload omits empty optional fields and trims', () => {
    expect(toCreatePayload({ ...valid, email: '  ', notes: ' hi ' })).toEqual({
      fullName: 'Ravi Kumar',
      phone: '+91 98765 43210',
      notes: 'hi',
    })
  })

  it('update payload contains only changed fields; clearing sends ""', () => {
    const original = { ...valid, email: 'r@x.com', address: 'Old' }
    expect(toUpdatePayload(original, { ...original })).toEqual({})
    expect(toUpdatePayload(original, { ...original, email: '', address: 'New' })).toEqual({
      email: '',
      address: 'New',
    })
  })

  it('round-trips a member into form values', () => {
    const member: Member = {
      memberId: `MEM-${'a'.repeat(32)}`,
      fullName: 'Ravi',
      phone: '+919876543210',
      email: null,
      gender: 'MALE',
      dateOfBirth: null,
      address: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      joinDate: TODAY,
      status: 'ACTIVE',
      notes: null,
      createdAt: '',
      updatedAt: '',
      trainerId: null,
      trainerName: null,
    }
    const values = memberToFormValues(member)
    expect(values.email).toBe('')
    expect(values.gender).toBe('MALE')
    expect(toUpdatePayload(values, values)).toEqual({})
  })
})

describe('display helpers', () => {
  it('initials', () => {
    expect(initials('Ravi Kumar')).toBe('RK')
    expect(initials('  ravi  ')).toBe('R')
    expect(initials('Anna Maria de Souza')).toBe('AS')
    expect(initials('')).toBe('?')
  })

  it('formatDate shows calendar dates without time-zone shift', () => {
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('garbage')).toBe('—')
  })

  it('ageOn counts birthdays correctly', () => {
    expect(ageOn('2000-06-15', TODAY)).toBe(26)
    expect(ageOn('2000-06-16', TODAY)).toBe(25)
    expect(ageOn(null, TODAY)).toBeNull()
  })

  it('addDaysIso crosses months and years', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29')
  })
})
