import { describe, expect, it } from 'vitest'
import {
  analyzePage,
  findDuplicateIssues,
  ISSUE_CODES,
  ISSUE_META,
  isIssueCode,
  sortIssues,
  worstSeverity,
  type PageFacts,
} from '../../supabase/functions/_shared/issues.ts'

const healthy: PageFacts = {
  statusCode: 200,
  fetchFailed: false,
  title: 'Emergency Plumber in Austin TX | Acme Plumbing',
  metaDescription: 'Acme Plumbing provides 24/7 emergency plumbing repairs across Austin, Texas with upfront pricing and fast response.',
  h1Count: 1,
  wordCount: 500,
  canonicalUrl: 'https://acme.com/',
  robotsMeta: 'index, follow',
  responseTimeMs: 400,
}

describe('analyzePage', () => {
  it('reports nothing for a healthy page', () => {
    expect(analyzePage(healthy)).toEqual([])
  })

  it('short-circuits on fetch failures and HTTP errors', () => {
    expect(analyzePage({ ...healthy, fetchFailed: true })).toEqual(['fetch_error'])
    expect(analyzePage({ ...healthy, statusCode: 500 })).toEqual(['http_error'])
    expect(analyzePage({ ...healthy, statusCode: 404 })).toEqual(['http_error'])
  })

  it('checks title length boundaries', () => {
    expect(analyzePage({ ...healthy, title: null })).toContain('missing_title')
    expect(analyzePage({ ...healthy, title: '   ' })).toContain('missing_title')
    expect(analyzePage({ ...healthy, title: 'a'.repeat(29) })).toContain('title_too_short')
    expect(analyzePage({ ...healthy, title: 'a'.repeat(30) })).toEqual([])
    expect(analyzePage({ ...healthy, title: 'a'.repeat(60) })).toEqual([])
    expect(analyzePage({ ...healthy, title: 'a'.repeat(61) })).toContain('title_too_long')
  })

  it('checks meta description length boundaries', () => {
    expect(analyzePage({ ...healthy, metaDescription: null })).toContain('missing_meta_description')
    expect(analyzePage({ ...healthy, metaDescription: 'a'.repeat(69) })).toContain('meta_description_too_short')
    expect(analyzePage({ ...healthy, metaDescription: 'a'.repeat(70) })).toEqual([])
    expect(analyzePage({ ...healthy, metaDescription: 'a'.repeat(160) })).toEqual([])
    expect(analyzePage({ ...healthy, metaDescription: 'a'.repeat(161) })).toContain('meta_description_too_long')
  })

  it('checks headings, content, indexing, canonical and speed', () => {
    expect(analyzePage({ ...healthy, h1Count: 0 })).toContain('missing_h1')
    expect(analyzePage({ ...healthy, h1Count: 2 })).toContain('multiple_h1')
    expect(analyzePage({ ...healthy, wordCount: 299 })).toContain('thin_content')
    expect(analyzePage({ ...healthy, wordCount: 300 })).toEqual([])
    expect(analyzePage({ ...healthy, robotsMeta: 'NOINDEX,nofollow' })).toContain('noindex')
    expect(analyzePage({ ...healthy, canonicalUrl: null })).toContain('missing_canonical')
    expect(analyzePage({ ...healthy, responseTimeMs: 3001 })).toContain('slow_response')
    expect(analyzePage({ ...healthy, responseTimeMs: 3000 })).toEqual([])
  })
})

describe('findDuplicateIssues', () => {
  it('flags repeated titles and descriptions case-insensitively, never empty ones', () => {
    const result = findDuplicateIssues([
      { title: 'Plumber Austin', metaDescription: 'Same text' },
      { title: ' plumber austin ', metaDescription: 'SAME TEXT' },
      { title: 'Unique', metaDescription: null },
      { title: null, metaDescription: null },
      { title: '', metaDescription: '' },
    ])
    expect(result[0]).toEqual(['duplicate_title', 'duplicate_meta_description'])
    expect(result[1]).toEqual(['duplicate_title', 'duplicate_meta_description'])
    expect(result[2]).toEqual([])
    expect(result[3]).toEqual([])
    expect(result[4]).toEqual([])
  })
})

describe('issue metadata helpers', () => {
  it('has a label and severity for every code', () => {
    for (const code of ISSUE_CODES) {
      expect(ISSUE_META[code].label.length).toBeGreaterThan(5)
      expect(['error', 'warning', 'info']).toContain(ISSUE_META[code].severity)
    }
  })

  it('recognises only known codes', () => {
    expect(isIssueCode('missing_title')).toBe(true)
    expect(isIssueCode('toString')).toBe(false)
    expect(isIssueCode('nope')).toBe(false)
  })

  it('computes worst severity and sorts most severe first, ignoring unknown codes', () => {
    expect(worstSeverity([])).toBeNull()
    expect(worstSeverity(['missing_canonical'])).toBe('info')
    expect(worstSeverity(['missing_canonical', 'thin_content'])).toBe('warning')
    expect(worstSeverity(['thin_content', 'http_error', 'bogus'])).toBe('error')
    expect(sortIssues(['missing_canonical', 'bogus', 'missing_h1', 'thin_content'])).toEqual([
      'missing_h1',
      'thin_content',
      'missing_canonical',
    ])
  })
})
