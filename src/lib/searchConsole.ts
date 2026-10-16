import type { DateRange, GscPeriod, GscRow, GscTotals } from '../../supabase/functions/_shared/gsc.ts'
import { supabase } from './supabase'

/**
 * Browser side of the Google Search Console integration. Every call goes through the `gsc`
 * Edge Function, which holds the Google client secret and the user's tokens.
 */

export type GscResult<T> = { data: T; error: null; code: null } | { data: null; error: string; code: string | null }

export type GscStatus = { connected: boolean; email: string | null }
export type GscSite = { siteUrl: string; permissionLevel: string }
export type GscPerformance = {
  property: string
  ranges: { current: DateRange; previous: DateRange }
  totals: { current: GscTotals; previous: GscTotals }
  queries: { current: GscRow[]; previous: GscRow[] }
  pages: { current: GscRow[]; previous: GscRow[] }
  /** Per-day rows (key = YYYY-MM-DD). Missing when the gsc function predates the trend chart. */
  daily?: { current: GscRow[]; previous: GscRow[] }
}

const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'
const NOT_DEPLOYED =
  'The Search Console service is not available yet. Deploy the gsc function in Supabase (see the README), then try again.'
const GENERIC = 'Something went wrong. Please try again.'

async function readError(error: unknown): Promise<{ message: string; code: string | null }> {
  const err = typeof error === 'object' && error !== null ? (error as { name?: unknown; context?: unknown }) : {}
  if (err.name === 'FunctionsFetchError') return { message: NETWORK_ERROR, code: null }
  if (err.context instanceof Response) {
    const body: unknown = await err.context
      .clone()
      .json()
      .catch(() => null)
    const record = typeof body === 'object' && body !== null ? (body as { error?: unknown; code?: unknown }) : {}
    const code = typeof record.code === 'string' ? record.code : null
    if (typeof record.error === 'string' && record.error.length > 0 && record.error.length <= 400) {
      return { message: record.error, code }
    }
    if (err.context.status === 404) return { message: NOT_DEPLOYED, code: 'not_deployed' }
    if (err.context.status === 401) return { message: 'Your session has expired. Please sign in again.', code: null }
  }
  return { message: GENERIC, code: null }
}

async function call<T>(body: Record<string, unknown>, isValid: (data: unknown) => data is T): Promise<GscResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('gsc', { body })
    if (error) {
      const { message, code } = await readError(error)
      return { data: null, error: message, code }
    }
    if (!isValid(data)) return { data: null, error: GENERIC, code: null }
    return { data, error: null, code: null }
  } catch (error) {
    const { message, code } = await readError(error)
    return { data: null, error: message, code }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function getGscStatus(): Promise<GscResult<GscStatus>> {
  return call({ action: 'status' }, (data): data is GscStatus => isObject(data) && typeof data.connected === 'boolean')
}

export function disconnectGsc(): Promise<GscResult<{ connected: false }>> {
  return call({ action: 'disconnect' }, (data): data is { connected: false } => isObject(data) && data.connected === false)
}

export function listGscSites(): Promise<GscResult<{ sites: GscSite[] }>> {
  return call({ action: 'sites' }, (data): data is { sites: GscSite[] } => isObject(data) && Array.isArray(data.sites))
}

export function getGscPerformance(projectId: string, days: GscPeriod): Promise<GscResult<GscPerformance>> {
  return call(
    { action: 'performance', projectId, days },
    (data): data is GscPerformance => isObject(data) && isObject(data.totals) && isObject(data.queries) && isObject(data.pages),
  )
}

// ---- OAuth round trip ------------------------------------------------------------------------

const STATE_KEY = 'gsc-oauth-state'
const RETURN_KEY = 'gsc-oauth-return'

export function callbackUrl(origin: string = window.location.origin): string {
  return `${origin}/search-console/callback`
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Asks the server for Google's consent URL and remembers the anti-forgery state for the callback. */
export async function startGscConnect(returnTo: string): Promise<GscResult<{ url: string }>> {
  const state = randomState()
  try {
    sessionStorage.setItem(STATE_KEY, state)
    sessionStorage.setItem(RETURN_KEY, returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/search-console')
  } catch {
    return { data: null, error: 'Your browser blocked session storage, which is needed to connect Google.', code: null }
  }
  return call(
    { action: 'auth_url', redirectUri: callbackUrl(), state },
    (data): data is { url: string } => isObject(data) && typeof data.url === 'string' && data.url.startsWith('https://accounts.google.com/'),
  )
}

/** Where to go after the callback; only same-site paths are allowed. */
export function takeReturnPath(): string {
  try {
    const value = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    return value && value.startsWith('/') && !value.startsWith('//') ? value : '/search-console'
  } catch {
    return '/search-console'
  }
}

/** Checks the state Google sent back and exchanges the one-time code for a stored connection. */
export async function finishGscConnect(params: URLSearchParams): Promise<GscResult<GscStatus>> {
  let expected: string | null
  try {
    expected = sessionStorage.getItem(STATE_KEY)
    sessionStorage.removeItem(STATE_KEY)
  } catch {
    expected = null
  }
  const googleError = params.get('error')
  if (googleError) {
    return {
      data: null,
      error: googleError === 'access_denied' ? 'Google access was not granted.' : 'Google sign-in did not complete.',
      code: null,
    }
  }
  const state = params.get('state')
  const code = params.get('code')
  if (!expected || !state || state !== expected) {
    return { data: null, error: 'This sign-in link is not valid or has expired. Start again from Search Console.', code: null }
  }
  if (!code) return { data: null, error: 'Google did not return a sign-in code.', code: null }
  return call(
    { action: 'exchange', code, redirectUri: callbackUrl() },
    (data): data is GscStatus => isObject(data) && data.connected === true,
  )
}
