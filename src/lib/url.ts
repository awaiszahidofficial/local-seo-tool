export const WEBSITE_URL_MAX_LENGTH = 2048

export type UrlResult = { ok: true; url: string } | { ok: false; error: string }

const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const BLOCKED_SCHEME = /^(javascript|data|vbscript|blob|file|mailto|tel|sms|ftp|about|chrome):/i
// Dotted hostname whose last label is alphabetic (or punycode). Rejects IPs and bare hosts like "localhost".
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i

const UNSUPPORTED_PROTOCOL = 'Only http:// and https:// website URLs are supported.'
const INVALID_URL = 'Enter a valid website address, like https://example.com.'

function fail(error: string): UrlResult {
  return { ok: false, error }
}

/**
 * Validates and normalizes a website URL entered by a user.
 *
 * - Trims whitespace.
 * - A missing protocol is assumed to be https:// (the host, path, query, and port are never altered).
 * - An explicit http:// is preserved, never silently upgraded.
 * - Rejects unsupported protocols (javascript:, data:, ftp:, ...), embedded credentials,
 *   IP addresses, and hosts without a real domain (e.g. localhost).
 * - Lowercases the host and drops a bare trailing "/" when there is no path.
 */
export function normalizeWebsiteUrl(input: string): UrlResult {
  const trimmed = input.trim()
  if (!trimmed) return fail('Website URL is required.')
  if (trimmed.length > WEBSITE_URL_MAX_LENGTH) {
    return fail(`Website URL must be ${WEBSITE_URL_MAX_LENGTH} characters or fewer.`)
  }
  if (/\s/.test(trimmed)) return fail('Website URL cannot contain spaces.')

  let candidate = trimmed
  if (EXPLICIT_SCHEME.test(trimmed)) {
    const scheme = trimmed.slice(0, trimmed.indexOf(':')).toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') return fail(UNSUPPORTED_PROTOCOL)
  } else if (BLOCKED_SCHEME.test(trimmed)) {
    return fail(UNSUPPORTED_PROTOCOL)
  } else if (trimmed.startsWith('//')) {
    candidate = `https:${trimmed}`
  } else {
    candidate = `https://${trimmed}`
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return fail(INVALID_URL)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fail(UNSUPPORTED_PROTOCOL)
  if (parsed.username || parsed.password) {
    return fail('Website URL cannot include a username or password.')
  }
  if (!HOSTNAME.test(parsed.hostname)) return fail(INVALID_URL)

  const path = parsed.pathname === '/' ? '' : parsed.pathname
  return { ok: true, url: `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}` }
}

/** Returns an href that is safe to render in an anchor (http/https only), or null. */
export function getSafeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/**
 * Short, human-friendly form of a URL for tables and cards: no protocol, no leading "www.",
 * no trailing slash, truncated with an ellipsis when longer than `maxLength`.
 */
export function formatUrlForDisplay(url: string | null | undefined, maxLength = 48): string {
  const trimmed = url?.trim()
  if (!trimmed) return '—'

  let display: string
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    const host = parsed.host.replace(/^www\./i, '')
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')
    display = `${host}${path}${parsed.search}${parsed.hash}`
  } catch {
    display = trimmed
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/$/, '')
  }

  if (maxLength > 1 && display.length > maxLength) {
    return `${display.slice(0, maxLength - 1)}…`
  }
  return display
}
