import { describe, expect, it } from 'vitest'
import { decodeJwtRole, validateEnv } from '../lib/env'

const URL_OK = 'https://abcdefghijklmnop.supabase.co'
const KEY_OK = 'sb_publishable_AbCdEf1234567890'

function jwt(payload: object): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

describe('validateEnv', () => {
  it('accepts a valid configuration and trims values', () => {
    const result = validateEnv({
      VITE_SUPABASE_URL: `  ${URL_OK}  `,
      VITE_SUPABASE_PUBLISHABLE_KEY: ` ${KEY_OK} `,
    })
    expect(result).toEqual({ ok: true, env: { supabaseUrl: URL_OK, supabasePublishableKey: KEY_OK } })
  })

  it('reports both variables when they are missing', () => {
    const result = validateEnv({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([
        'VITE_SUPABASE_URL is missing.',
        'VITE_SUPABASE_PUBLISHABLE_KEY is missing.',
      ])
    }
  })

  it('treats blank and non-string values as missing', () => {
    const result = validateEnv({ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_PUBLISHABLE_KEY: 42 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toHaveLength(2)
  })

  it('rejects an invalid URL', () => {
    const result = validateEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual(['VITE_SUPABASE_URL is not a valid URL.'])
  })

  it('requires https except for localhost', () => {
    const remoteHttp = validateEnv({
      VITE_SUPABASE_URL: 'http://abcdefghijklmnop.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK,
    })
    expect(remoteHttp.ok).toBe(false)

    const local = validateEnv({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK,
    })
    expect(local.ok).toBe(true)
  })

  it('rejects placeholder values', () => {
    const result = validateEnv({
      VITE_SUPABASE_URL: 'https://your-project-ref.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'your-publishable-key',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([
        'VITE_SUPABASE_URL still contains a placeholder value.',
        'VITE_SUPABASE_PUBLISHABLE_KEY still contains a placeholder value.',
      ])
    }
  })

  it('rejects secret keys without echoing them', () => {
    const secret = 'sb_secret_SuperSecretValue123'
    const result = validateEnv({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: secret })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/secret\/service-role key/)
      expect(result.errors.join(' ')).not.toContain(secret)
    }
  })

  it('rejects legacy service_role JWTs but accepts legacy anon JWTs', () => {
    const serviceRole = validateEnv({
      VITE_SUPABASE_URL: URL_OK,
      VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role' }),
    })
    expect(serviceRole.ok).toBe(false)

    const anon = validateEnv({
      VITE_SUPABASE_URL: URL_OK,
      VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon' }),
    })
    expect(anon.ok).toBe(true)
  })
})

describe('decodeJwtRole', () => {
  it('reads the role claim', () => {
    expect(decodeJwtRole(jwt({ role: 'anon' }))).toBe('anon')
    expect(decodeJwtRole(jwt({ role: 'service_role' }))).toBe('service_role')
  })

  it('returns null for non-JWT or malformed input', () => {
    expect(decodeJwtRole('sb_publishable_abc')).toBeNull()
    expect(decodeJwtRole('a.b.c')).toBeNull()
    expect(decodeJwtRole(jwt({ sub: 'no-role' }))).toBeNull()
    expect(decodeJwtRole(jwt({ role: 5 }))).toBeNull()
  })
})
