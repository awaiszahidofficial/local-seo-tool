import { describe, expect, it } from 'vitest'
import { getModule, isModuleId, MODULE_IDS, MODULES, modulePath } from '../lib/modules'
import { NAV_GROUPS } from '../lib/navigation'

describe('module map', () => {
  it('resolves every known module with matching id, name, summary, and features', () => {
    expect(MODULE_IDS).toHaveLength(9)
    for (const id of MODULE_IDS) {
      const module = getModule(id)
      expect(module?.id).toBe(id)
      expect(module?.name.length).toBeGreaterThan(0)
      expect(module?.summary.length).toBeGreaterThan(0)
      expect(module?.intendedFeatures.length).toBeGreaterThan(0)
    }
  })

  it('returns null for unknown, empty, and undefined identifiers', () => {
    expect(getModule('does-not-exist')).toBeNull()
    expect(getModule('')).toBeNull()
    expect(getModule(undefined)).toBeNull()
  })

  it('does not resolve inherited object properties', () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isModuleId(key)).toBe(false)
      expect(getModule(key)).toBeNull()
    }
  })

  it('builds module paths', () => {
    expect(modulePath('crawler')).toBe('/modules/crawler')
  })
})

describe('sidebar navigation', () => {
  const labels = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label))

  it('lists every required item in order', () => {
    expect(labels).toEqual([
      'Overview',
      'Projects',
      'Website Crawler',
      'Local Page Auditor',
      'Service-Area Coverage',
      'Google Business Profile Audit',
      'Google Search Console',
      'Business Listings',
      'Keyword Opportunities',
      'Recommendations',
      'Reports',
      'Settings',
    ])
  })

  it('links every module to its built page; nothing is left as planned', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items)
    expect(items.filter((item) => item.planned)).toEqual([])
    const expected: Record<string, string> = {
      'Website Crawler': '/crawler',
      'Local Page Auditor': '/page-auditor',
      'Service-Area Coverage': '/service-area',
      'Google Business Profile Audit': '/gbp-audit',
      'Google Search Console': '/search-console',
      'Business Listings': '/listings',
      'Keyword Opportunities': '/keywords',
      Recommendations: '/recommendations',
      Reports: '/reports',
    }
    for (const [label, to] of Object.entries(expected)) {
      expect(items.find((item) => item.label === label)).toMatchObject({ to, planned: false })
    }
    expect(Object.keys(expected)).toHaveLength(Object.keys(MODULES).length)
    expect(isModuleId('reports')).toBe(true)
  })
})
