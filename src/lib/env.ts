export type AppEnv = {
  supabaseUrl: string
  supabasePublishableKey: string
}

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; errors: string[] }

const URL_VAR = 'VITE_SUPABASE_URL'
const KEY_VAR = 'VITE_SUPABASE_PUBLISHABLE_KEY'

const PLACEHOLDER_PATTERN = /your[-_]|<[^>]+>|changeme|xxxx/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function readString(raw: Record<string, unknown>, name: string): string {
  const value = raw[name]
  return typeof value === 'string' ? value.trim() : ''
}

/** Returns the `role` claim of a JWT-shaped key, or null if it is not a readable JWT. */
export function decodeJwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const payload: unknown = JSON.parse(atob(padded))
    if (typeof payload === 'object' && payload !== null && 'role' in payload) {
      const role = (payload as { role: unknown }).role
      return typeof role === 'string' ? role : null
    }
    return null
  } catch {
    return null
  }
}

function validateSupabaseUrl(value: string): string | null {
  if (!value) return `${URL_VAR} is missing.`
  if (PLACEHOLDER_PATTERN.test(value)) return `${URL_VAR} still contains a placeholder value.`
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return `${URL_VAR} is not a valid URL.`
  }
  const isLocal = LOCAL_HOSTS.has(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    return `${URL_VAR} must start with https:// (http:// is only allowed for localhost).`
  }
  return null
}

function validatePublishableKey(value: string): string | null {
  if (!value) return `${KEY_VAR} is missing.`
  if (PLACEHOLDER_PATTERN.test(value)) return `${KEY_VAR} still contains a placeholder value.`
  if (value.startsWith('sb_secret_') || decodeJwtRole(value) === 'service_role') {
    return `${KEY_VAR} looks like a secret/service-role key. Secret keys must never be used in the browser; use the publishable (or legacy anon) key instead.`
  }
  return null
}

/**
 * Validates the Vite environment. Error messages name the variable but never echo its value,
 * so a mistakenly pasted secret is not printed to the page.
 */
export function validateEnv(raw: Record<string, unknown>): EnvResult {
  const url = readString(raw, URL_VAR)
  const key = readString(raw, KEY_VAR)

  const errors = [validateSupabaseUrl(url), validatePublishableKey(key)].filter(
    (message): message is string => message !== null,
  )

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, env: { supabaseUrl: url, supabasePublishableKey: key } }
}

/** Reads and validates the runtime environment, throwing a readable error when invalid. */
export function getEnv(): AppEnv {
  const result = validateEnv(import.meta.env)
  if (!result.ok) {
    throw new Error(`Invalid environment configuration:\n- ${result.errors.join('\n- ')}`)
  }
  return result.env
}
