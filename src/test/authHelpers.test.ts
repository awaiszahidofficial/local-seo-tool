import { describe, expect, it } from 'vitest'
import { isRecoveryUrl, safeRedirectPath } from '../lib/auth'
import { getAuthErrorMessage, getDatabaseErrorMessage } from '../lib/errors'

describe('isRecoveryUrl', () => {
  it('detects a recovery hash', () => {
    expect(isRecoveryUrl('#access_token=abc&refresh_token=def&type=recovery')).toBe(true)
    expect(isRecoveryUrl('type=recovery')).toBe(true)
  })

  it('ignores other hashes', () => {
    expect(isRecoveryUrl('')).toBe(false)
    expect(isRecoveryUrl('#access_token=abc&type=signup')).toBe(false)
    expect(isRecoveryUrl('#error=access_denied&error_code=otp_expired')).toBe(false)
  })
})

describe('safeRedirectPath', () => {
  it('allows in-app paths including query strings', () => {
    expect(safeRedirectPath('/projects')).toBe('/projects')
    expect(safeRedirectPath('/projects/new?x=1')).toBe('/projects/new?x=1')
  })

  it('falls back for external, protocol-relative, and malformed targets', () => {
    expect(safeRedirectPath('https://evil.example')).toBe('/')
    expect(safeRedirectPath('//evil.example')).toBe('/')
    expect(safeRedirectPath('/\\evil.example')).toBe('/')
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/')
    expect(safeRedirectPath(undefined)).toBe('/')
    expect(safeRedirectPath(42)).toBe('/')
  })

  it('never redirects back into auth pages', () => {
    expect(safeRedirectPath('/sign-in')).toBe('/')
    expect(safeRedirectPath('/sign-up?x=1')).toBe('/')
    expect(safeRedirectPath('/reset-password')).toBe('/')
    expect(safeRedirectPath('/sign-in-help')).toBe('/sign-in-help')
  })

  it('uses a custom fallback', () => {
    expect(safeRedirectPath('//evil.example', '/projects')).toBe('/projects')
  })
})

describe('getAuthErrorMessage', () => {
  it('maps known Supabase auth error codes and messages', () => {
    expect(getAuthErrorMessage({ code: 'invalid_credentials', message: 'x' })).toBe(
      'The email or password is incorrect.',
    )
    expect(getAuthErrorMessage({ message: 'Invalid login credentials' })).toBe('The email or password is incorrect.')
    expect(getAuthErrorMessage({ code: 'email_not_confirmed' })).toMatch(/confirm your email/i)
    expect(getAuthErrorMessage({ code: 'user_already_exists' })).toMatch(/already exists/i)
    expect(getAuthErrorMessage({ message: 'User already registered' })).toMatch(/already exists/i)
    expect(getAuthErrorMessage({ code: 'weak_password' })).toMatch(/too weak/i)
    expect(getAuthErrorMessage({ code: 'same_password' })).toMatch(/different/i)
    expect(getAuthErrorMessage({ code: 'over_email_send_rate_limit' })).toMatch(/too many attempts/i)
    expect(getAuthErrorMessage({ status: 429 })).toMatch(/too many attempts/i)
  })

  it('maps network failures', () => {
    expect(getAuthErrorMessage({ name: 'AuthRetryableFetchError', message: 'x' })).toMatch(/could not reach/i)
    expect(getAuthErrorMessage(new TypeError('Failed to fetch'))).toMatch(/could not reach/i)
  })

  it('never leaks raw error text for unknown errors', () => {
    expect(getAuthErrorMessage({ message: 'duplicate key value violates constraint users_pkey' })).toBe(
      'Something went wrong. Please try again.',
    )
    expect(getAuthErrorMessage(null)).toBe('Something went wrong. Please try again.')
    expect(getAuthErrorMessage('boom')).toBe('Something went wrong. Please try again.')
  })
})

describe('getDatabaseErrorMessage', () => {
  it('maps common Postgres and PostgREST errors', () => {
    expect(getDatabaseErrorMessage({ code: '42501' })).toMatch(/permission/i)
    expect(getDatabaseErrorMessage({ code: '23514' })).toMatch(/not allowed/i)
    expect(getDatabaseErrorMessage({ code: '23502' })).toMatch(/required value/i)
    expect(getDatabaseErrorMessage({ code: 'PGRST301' })).toMatch(/session has expired/i)
    expect(getDatabaseErrorMessage({ code: '42P01' })).toMatch(/migration/i)
    expect(getDatabaseErrorMessage({ message: 'TypeError: Failed to fetch' })).toMatch(/could not reach/i)
  })

  it('falls back to a generic message', () => {
    expect(getDatabaseErrorMessage({ code: 'XX000', message: 'internal detail' })).toBe(
      'Something went wrong. Please try again.',
    )
  })
})
