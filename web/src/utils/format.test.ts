import { describe, expect, it } from 'vitest'

import { formatDuration, formatMoney, formatStay } from './format'

describe('formatStay', () => {
  it('shows hours and minutes', () => {
    expect(formatStay('2026-11-24T02:00:00Z', '2026-11-24T02:40:00Z')).toBe('40 min')
    expect(formatStay('2026-11-24T02:00:00Z', '2026-11-24T03:25:00Z')).toBe('1 h 25 min')
    expect(formatStay('2026-11-24T03:00:00Z', '2026-11-24T02:00:00Z')).toBe('0 min')
  })
})

describe('formatDuration', () => {
  it('uses friendly units when exact', () => {
    expect(formatDuration(1)).toBe('1 day')
    expect(formatDuration(7)).toBe('1 week')
    expect(formatDuration(14)).toBe('2 weeks')
    expect(formatDuration(30)).toBe('1 month')
    expect(formatDuration(90)).toBe('3 months')
    expect(formatDuration(365)).toBe('1 year')
    expect(formatDuration(730)).toBe('2 years')
  })
  it('falls back to days', () => {
    expect(formatDuration(45)).toBe('45 days')
    expect(formatDuration(31)).toBe('31 days')
    expect(formatDuration(400)).toBe('400 days')
  })
})

describe('formatMoney', () => {
  it('formats rupees with Indian grouping', () => {
    expect(formatMoney(1500)).toBe('₹1,500')
    expect(formatMoney(150000)).toBe('₹1,50,000')
    expect(formatMoney(1499.5)).toBe('₹1,499.50')
    expect(formatMoney(0)).toBe('₹0')
  })
})
