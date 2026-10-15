import { describe, expect, it } from 'vitest'
import { formatDate } from '../lib/format'

describe('formatDate', () => {
  it('formats an ISO timestamp as a short date', () => {
    expect(formatDate('2026-10-15T12:00:00Z', { timeZone: 'UTC' })).toBe('Oct 15, 2026')
    expect(formatDate('2026-01-05T00:00:00.000Z', { timeZone: 'UTC' })).toBe('Jan 5, 2026')
  })

  it('accepts Date objects', () => {
    expect(formatDate(new Date(Date.UTC(2026, 11, 31, 23, 0, 0)), { timeZone: 'UTC' })).toBe('Dec 31, 2026')
  })

  it('respects the requested time zone', () => {
    const instant = '2026-03-01T23:30:00Z'
    expect(formatDate(instant, { timeZone: 'UTC' })).toBe('Mar 1, 2026')
    expect(formatDate(instant, { timeZone: 'Asia/Karachi' })).toBe('Mar 2, 2026')
  })

  it('supports other locales', () => {
    expect(formatDate('2026-10-15T12:00:00Z', { timeZone: 'UTC', locale: 'en-GB' })).toBe('15 Oct 2026')
  })

  it('returns a dash for missing or invalid input', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('')).toBe('—')
    expect(formatDate('not a date')).toBe('—')
    expect(formatDate(new Date('invalid'))).toBe('—')
  })
})
