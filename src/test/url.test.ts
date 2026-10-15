import { describe, expect, it } from 'vitest'
import { formatUrlForDisplay, getSafeHttpUrl, normalizeWebsiteUrl, WEBSITE_URL_MAX_LENGTH } from '../lib/url'

function ok(input: string): string {
  const result = normalizeWebsiteUrl(input)
  if (!result.ok) throw new Error(`Expected "${input}" to be valid but got: ${result.error}`)
  return result.url
}

function errorFor(input: string): string {
  const result = normalizeWebsiteUrl(input)
  if (result.ok) throw new Error(`Expected "${input}" to be invalid but got: ${result.url}`)
  return result.error
}

describe('normalizeWebsiteUrl', () => {
  it('accepts full https and http URLs and preserves the scheme', () => {
    expect(ok('https://example.com')).toBe('https://example.com')
    expect(ok('http://example.com')).toBe('http://example.com')
  })

  it('assumes https:// when the protocol is missing, without changing anything else', () => {
    expect(ok('example.com')).toBe('https://example.com')
    expect(ok('www.example.com/services/plumbing?area=north#top')).toBe(
      'https://www.example.com/services/plumbing?area=north#top',
    )
    expect(ok('example.com:8080/path')).toBe('https://example.com:8080/path')
    expect(ok('//example.com/page')).toBe('https://example.com/page')
  })

  it('trims surrounding whitespace', () => {
    expect(ok('   https://example.com/about  ')).toBe('https://example.com/about')
  })

  it('lowercases the host but preserves path case', () => {
    expect(ok('HTTPS://Example.COM/About-Us')).toBe('https://example.com/About-Us')
  })

  it('drops a bare trailing slash only when there is no path', () => {
    expect(ok('https://example.com/')).toBe('https://example.com')
    expect(ok('https://example.com/services/')).toBe('https://example.com/services/')
  })

  it('accepts subdomains and international (punycode) domains', () => {
    expect(ok('https://shop.example.co.uk')).toBe('https://shop.example.co.uk')
    expect(ok('https://münchen.de')).toBe('https://xn--mnchen-3ya.de')
  })

  it('rejects an empty or whitespace-only value as required', () => {
    expect(errorFor('')).toBe('Website URL is required.')
    expect(errorFor('    ')).toBe('Website URL is required.')
  })

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'ftp://example.com',
    'file:///etc/passwd',
    'mailto:someone@example.com',
    'tel:+15555550100',
    'vbscript:msgbox(1)',
    'chrome://settings',
  ])('rejects unsupported protocol: %s', (input) => {
    expect(errorFor(input)).toBe('Only http:// and https:// website URLs are supported.')
  })

  it.each(['not a url', 'exa mple.com', 'https://exa mple.com'])('rejects URLs containing spaces: %s', (input) => {
    expect(errorFor(input)).toBe('Website URL cannot contain spaces.')
  })

  it.each([
    'localhost',
    'localhost:3000',
    'http://localhost:3000',
    'https://intranet',
    'http://192.168.0.1',
    'https://127.0.0.1',
    'https://example',
    'https://-bad-.com',
    'https://example..com',
    'https://example.com.',
    'https://',
    'justtext',
  ])('rejects hosts that are not a public domain: %s', (input) => {
    expect(errorFor(input)).toBe('Enter a valid website address, like https://example.com.')
  })

  it('rejects embedded credentials', () => {
    expect(errorFor('https://user:pass@example.com')).toBe('Website URL cannot include a username or password.')
    expect(errorFor('https://user@example.com')).toBe('Website URL cannot include a username or password.')
  })

  it('enforces the maximum length', () => {
    const longPath = 'a'.repeat(WEBSITE_URL_MAX_LENGTH)
    expect(errorFor(`https://example.com/${longPath}`)).toBe(
      `Website URL must be ${WEBSITE_URL_MAX_LENGTH} characters or fewer.`,
    )
    const withinLimit = `https://example.com/${'a'.repeat(100)}`
    expect(ok(withinLimit)).toBe(withinLimit)
  })
})

describe('getSafeHttpUrl', () => {
  it('returns an href for http and https URLs', () => {
    expect(getSafeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(getSafeHttpUrl('http://example.com')).toBe('http://example.com/')
  })

  it('returns null for dangerous, malformed, or missing values', () => {
    expect(getSafeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(getSafeHttpUrl('data:text/html,hi')).toBeNull()
    expect(getSafeHttpUrl('example.com')).toBeNull()
    expect(getSafeHttpUrl('')).toBeNull()
    expect(getSafeHttpUrl(null)).toBeNull()
    expect(getSafeHttpUrl(undefined)).toBeNull()
  })
})

describe('formatUrlForDisplay', () => {
  it('removes the protocol, leading www., and trailing slash', () => {
    expect(formatUrlForDisplay('https://www.example.com/')).toBe('example.com')
    expect(formatUrlForDisplay('http://example.com')).toBe('example.com')
  })

  it('keeps paths, ports, and query strings', () => {
    expect(formatUrlForDisplay('https://www.example.com/services/plumbing/')).toBe('example.com/services/plumbing')
    expect(formatUrlForDisplay('https://example.com:8443/a?b=1')).toBe('example.com:8443/a?b=1')
  })

  it('shows a dash for empty values', () => {
    expect(formatUrlForDisplay('')).toBe('—')
    expect(formatUrlForDisplay('   ')).toBe('—')
    expect(formatUrlForDisplay(null)).toBe('—')
    expect(formatUrlForDisplay(undefined)).toBe('—')
  })

  it('truncates long values with an ellipsis', () => {
    const result = formatUrlForDisplay('https://example.com/' + 'a'.repeat(100), 30)
    expect(result).toHaveLength(30)
    expect(result.endsWith('…')).toBe(true)
    expect(result.startsWith('example.com/aaa')).toBe(true)
  })

  it('does not truncate values within the limit', () => {
    expect(formatUrlForDisplay('https://example.com/short', 30)).toBe('example.com/short')
  })

  it('falls back gracefully for strings that are not parseable URLs', () => {
    expect(formatUrlForDisplay('https://')).toBe('')
    expect(formatUrlForDisplay('not a url/')).toBe('not a url')
  })
})
