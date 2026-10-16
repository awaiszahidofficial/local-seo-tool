import { describe, expect, it } from 'vitest'
import {
  buildAuthUrl,
  decryptToken,
  emailFromIdToken,
  encryptToken,
  isAllowedRedirect,
  isValidSiteUrl,
  isValidState,
  normalizeRows,
  normalizeTotals,
  parseAllowedRedirects,
  periodRanges,
} from '../../supabase/functions/_shared/gsc.ts'
import {
  compareTotals,
  expectedCtr,
  isLocalQuery,
  localTerms,
  lowCtr,
  mergePeriods,
  sortByClicks,
  strikingDistance,
  suggestProperty,
  summarizeLocal,
  topMovers,
} from '../lib/gscAnalysis'

const row = (key: string, clicks: number, impressions: number, position: number) => ({
  key,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
})

describe('OAuth helpers', () => {
  const allowed = parseAllowedRedirects(' https://app.example/search-console/callback ,http://localhost:5173/search-console/callback, javascript:x')

  it('parses the redirect allow-list and matches exactly', () => {
    expect(allowed).toEqual(['https://app.example/search-console/callback', 'http://localhost:5173/search-console/callback'])
    expect(isAllowedRedirect('https://app.example/search-console/callback', allowed)).toBe(true)
    expect(isAllowedRedirect('https://app.example/search-console/callback?x=1', allowed)).toBe(false)
    expect(isAllowedRedirect('https://evil.example/search-console/callback', allowed)).toBe(false)
    expect(isAllowedRedirect(42, allowed)).toBe(false)
  })

  it('validates state values', () => {
    expect(isValidState('a'.repeat(48))).toBe(true)
    expect(isValidState('short')).toBe(false)
    expect(isValidState('bad state with spaces!!')).toBe(false)
  })

  it('builds a consent URL asking for offline, read-only access', () => {
    const url = new URL(buildAuthUrl('client-123', 'https://app.example/search-console/callback', 's'.repeat(20)))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/webmasters.readonly')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/search-console/callback')
  })

  it('reads the email from an ID token', () => {
    const payload = btoa(JSON.stringify({ email: 'seo@example.com' })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    expect(emailFromIdToken(`header.${payload}.sig`)).toBe('seo@example.com')
    expect(emailFromIdToken('nope')).toBeNull()
    expect(emailFromIdToken(undefined)).toBeNull()
  })

  it('encrypts tokens so they round-trip only with the same secret', async () => {
    const stored = await encryptToken('1//refresh-token', 'secret-a')
    expect(stored.startsWith('v1.')).toBe(true)
    expect(stored).not.toContain('refresh-token')
    expect(await decryptToken(stored, 'secret-a')).toBe('1//refresh-token')
    await expect(decryptToken(stored, 'secret-b')).rejects.toBeDefined()
    expect(await encryptToken('x', 'secret-a')).not.toBe(await encryptToken('x', 'secret-a')) // random IV
  })
})

describe('properties, dates and rows', () => {
  it('accepts domain and URL-prefix properties only', () => {
    expect(isValidSiteUrl('sc-domain:rodeoblinds.com')).toBe(true)
    expect(isValidSiteUrl('https://www.rodeoblinds.com/')).toBe(true)
    expect(isValidSiteUrl('https://www.rodeoblinds.com')).toBe(false)
    expect(isValidSiteUrl('sc-domain:')).toBe(false)
    expect(isValidSiteUrl(null)).toBe(false)
  })

  it('builds two back-to-back periods ending 3 days ago', () => {
    const ranges = periodRanges(new Date('2026-10-17T12:00:00Z'), 28)
    expect(ranges.current).toEqual({ startDate: '2026-09-17', endDate: '2026-10-14' })
    expect(ranges.previous).toEqual({ startDate: '2026-08-20', endDate: '2026-09-16' })
  })

  it('normalizes API rows and totals defensively', () => {
    expect(normalizeRows({ rows: [{ keys: ['blinds austin'], clicks: 3, impressions: 40, ctr: 0.075, position: 6.2 }, 'junk'] })).toEqual([
      { key: 'blinds austin', clicks: 3, impressions: 40, ctr: 0.075, position: 6.2 },
    ])
    expect(normalizeRows(null)).toEqual([])
    expect(normalizeTotals({})).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 })
  })
})

describe('analysis', () => {
  const current = [row('blinds austin', 30, 600, 3.2), row('shutters near me', 10, 400, 8.4), row('roller shades', 5, 900, 12), row('new query', 2, 30, 15)]
  const previous = [row('blinds austin', 20, 500, 4.5), row('shutters near me', 15, 380, 7.0), row('roller shades', 5, 700, 14), row('lost query', 6, 50, 9)]
  const merged = mergePeriods(current, previous)

  it('merges both periods, including rows that disappeared', () => {
    expect(merged).toHaveLength(5)
    expect(merged.find((r) => r.key === 'blinds austin')).toMatchObject({ clickChange: 10, positionChange: 1.3, prevPosition: 4.5 })
    expect(merged.find((r) => r.key === 'new query')).toMatchObject({ prevClicks: 0, prevPosition: null, positionChange: null })
    expect(merged.find((r) => r.key === 'lost query')).toMatchObject({ clicks: 0, position: null, clickChange: -6 })
  })

  it('compares totals as percentages, CTR points and position change', () => {
    const change = compareTotals({ clicks: 120, impressions: 2000, ctr: 0.06, position: 9 }, { clicks: 100, impressions: 2500, ctr: 0.04, position: 10 })
    expect(change).toMatchObject({ clicksPct: 20, impressionsPct: -20, ctrPoints: 2, positionChange: 1 })
    expect(compareTotals({ clicks: 5, impressions: 5, ctr: 1, position: 1 }, { clicks: 0, impressions: 0, ctr: 0, position: 0 }).clicksPct).toBeNull()
  })

  it('finds local queries by service area or near me, as whole words', () => {
    const terms = localTerms({ location: 'Austin, TX', service_areas: ['Austin, TX', 'Round Rock, TX'] })
    expect(isLocalQuery('blinds austin', terms)).toBe(true)
    expect(isLocalQuery('shutters near me', terms)).toBe(true)
    expect(isLocalQuery('round rock shades', terms)).toBe(true)
    expect(isLocalQuery('austintatious decor', terms)).toBe(false)
    expect(isLocalQuery('roller shades', terms)).toBe(false)
    expect(localTerms({ location: null, service_areas: [] })).toEqual([])
    const local = merged.filter((r) => isLocalQuery(r.key, terms))
    expect(summarizeLocal(local, 47)).toEqual({ queries: 2, clicks: 40, impressions: 1000, shareOfClicks: 85.1 })
  })

  it('lists striking-distance queries (positions 4–20 with demand)', () => {
    expect(strikingDistance(merged).map((r) => r.key)).toEqual(['roller shades', 'shutters near me', 'new query'])
    expect(strikingDistance(merged, 100).map((r) => r.key)).toEqual(['roller shades', 'shutters near me'])
  })

  it('flags top-5 rankings with a weak click-through rate', () => {
    const rows = mergePeriods([row('blinds', 2, 500, 2.0), row('shades', 60, 500, 2.0)], [])
    expect(lowCtr(rows).map((r) => r.key)).toEqual(['blinds'])
    expect(expectedCtr(1)).toBeGreaterThan(expectedCtr(8))
  })

  it('ranks gainers and losers and sorts by clicks', () => {
    const { gainers, losers } = topMovers(merged)
    expect(gainers.map((r) => r.key)).toEqual(['blinds austin', 'new query'])
    expect(losers.map((r) => r.key)).toEqual(['lost query', 'shutters near me'])
    expect(sortByClicks(merged)[0]?.key).toBe('blinds austin')
  })

  it('suggests the property that matches the project website', () => {
    const sites = [{ siteUrl: 'https://www.other.com/' }, { siteUrl: 'https://www.rodeoblinds.com/' }, { siteUrl: 'sc-domain:rodeoblinds.com' }]
    expect(suggestProperty('https://rodeoblinds.com', sites)).toBe('sc-domain:rodeoblinds.com')
    expect(suggestProperty('https://www.rodeoblinds.com', sites.slice(0, 2))).toBe('https://www.rodeoblinds.com/')
    expect(suggestProperty('https://nomatch.com', sites)).toBeNull()
  })
})
